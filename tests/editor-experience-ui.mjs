import { openFixtureRoots } from "./project-tree-helper.mjs";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const root = await fs.realpath(
  await fs.mkdtemp(path.join(os.tmpdir(), "islet-editor-experience-")),
);
const evidence = path.join(
  os.homedir(),
  "islet-ui-screens",
  "editor-experience-20261029",
);
await fs.mkdir(evidence, { recursive: true });
await fs.writeFile(
  path.join(root, "a.py"),
  'def describe(name: str) -> str:\n    """**Rich documentation**\n\n    A string with &nbsp; spacing.\n\n' +
    Array.from(
      { length: 65 },
      (_, i) => "    Paragraph " + i + " documents a useful operation.\n\n",
    ).join("") +
    '    """\n    return name\n\nresult = describe("hello")\nmessage = "known string"\nencoded = message.encode()\nmissing_symbol\n',
);
await fs.writeFile(path.join(root, "b.txt"), "alpha beta alpha\n");
await fs.writeFile(path.join(root, "c.txt"), "third editor\n");
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.ISLET_CHROMIUM || chromium.executablePath(),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await context.newPage(),
  errors = [],
  sessions = new Map();
let preferences = { keymap: "windows" },
  windowId;
page.on("pageerror", (e) => {
  errors.push(e.message);
  console.error("PAGE", e.message);
});
await page.route("**/host/request", async (route) => {
  const { operation, payload = {} } = route.request().postDataJSON();
  if (operation === "app.registerWindow") windowId = payload.windowId;
  if (operation === "settings.load")
    return route.fulfill({ json: { result: preferences } });
  if (operation === "settings.save") {
    preferences = payload.value;
    return route.fulfill({ json: { result: true } });
  }
  if (operation === "session.load")
    return route.fulfill({
      json: { result: sessions.get(payload.key) || null },
    });
  if (operation === "session.save") {
    sessions.set(payload.key, payload.value);
    return route.fulfill({ json: { result: true } });
  }
  if (operation === "session.list" || operation === "app.pendingRequests")
    return route.fulfill({ json: { result: [] } });
  return route.continue();
});
await page.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) return route.abort();
  if (url.pathname === "/")
    return route.fulfill({
      body: await fs.readFile("dist/index.html"),
      contentType: "text/html",
      headers: {
        "content-security-policy":
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'",
      },
    });
  if (url.pathname.startsWith("/assets/"))
    return route.fulfill({
      body: await fs.readFile(
        path.join("dist/assets", path.basename(url.pathname)),
      ),
      contentType: url.pathname.endsWith(".css")
        ? "text/css"
        : url.pathname.endsWith(".js")
          ? "application/javascript"
          : "font/woff2",
    });
  return route.fallback();
});
const editor = () => page.locator(".cm-content");
async function open(name) {
  await page.locator(".tree-name").getByText(name, { exact: true }).click();
  await expect(page.locator(".tab.active")).toContainText(name);
}
async function point(line, token) {
  return page
    .locator(".cm-line")
    .filter({ hasText: line })
    .last()
    .evaluate((el, token) => {
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node; (node = walk.nextNode());) {
        const start = node.textContent.indexOf(token);
        if (start < 0) continue;
        const range = document.createRange();
        range.setStart(node, start + Math.floor(token.length / 2));
        range.setEnd(node, start + Math.floor(token.length / 2) + 1);
        const r = range.getBoundingClientRect();
        return { x: r.left + 2, y: r.top + r.height / 2 };
      }
      throw Error("Token not rendered: " + token);
    }, token);
}
try {
  await openFixtureRoots(page);
  await page.goto("http://127.0.0.1:1420/?root=" + encodeURIComponent(root));
  await open("b.txt");
  await open("c.txt");
  await editor().click();
  await page.keyboard.down("Control");
  await page.keyboard.press("Tab");
  await expect(page.locator(".tab.active")).toContainText("b.txt");
  await expect(
    page.getByRole("listbox", { name: "Recent editors" }),
  ).toBeVisible();
  await page.screenshot({ path: path.join(evidence, "switcher.png") });
  await page.keyboard.up("Control");
  await expect(
    page.getByRole("listbox", { name: "Recent editors" }),
  ).toHaveCount(0);
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.locator(".tab.active")).toContainText("c.txt");
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(page.locator(".tab.active")).toContainText("b.txt");
  await page.keyboard.press("Control+f");
  const find = page.getByRole("textbox", { name: "Find in file", exact: true }),
    results = page.getByLabel("File search results");
  await expect(find).toBeFocused();
  await find.fill("alpha");
  await expect(results).toHaveText("1 of 2");
  await page.keyboard.press("Enter");
  await expect(results).toHaveText("2 of 2");
  await page.keyboard.press("Shift+Enter");
  await expect(results).toHaveText("1 of 2");
  await page.keyboard.press("Control+r");
  const replace = page
    .locator(".file-search-dock")
    .getByRole("textbox", { name: "Replace with", exact: true });
  await expect(replace).toBeVisible();
  await replace.fill("delta");
  await page
    .locator(".file-search-dock")
    .getByRole("button", { name: "Replace all", exact: true })
    .click();
  await expect(editor()).toContainText("delta beta delta");
  await expect(results).toHaveText("No results");
  const dock = await page.locator(".file-search-dock").boundingBox(),
    code = await page.locator(".cm-content").boundingBox();
  assert.ok(dock.y > code.y);
  for (const width of [1440, 1280, 1024, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await page.screenshot({
      path: path.join(evidence, `search-dock-${width}.png`),
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await find.focus();
  await page.keyboard.press("Control+s");
  await expect(page.locator(".dirty-dot")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator(".file-search-dock")).toHaveCount(0);
  // Clipboard shortcuts in a workspace search dialog must affect its input only.
  await editor().click();
  await page.keyboard.press("Control+Shift+f");
  const dialog = page.getByRole("dialog", {
    name: "Find in Files",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  const query = dialog.getByLabel("Search text", { exact: true });
  await query.fill("copied query");
  await query.selectText();
  await page.keyboard.press("ControlOrMeta+c");
  const dest = dialog.getByLabel("File mask", { exact: true });
  await dest.focus();
  await page.keyboard.press("ControlOrMeta+v");
  await expect(dest).toHaveValue("copied query");
  await expect(editor()).toContainText("delta beta delta");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await expect(dest).toHaveValue("");
  await expect(editor()).toContainText("delta beta delta");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Keyboard shortcuts…", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Filter shortcuts" })
    .fill("Next Editor Tab");
  const binding = page.getByRole("textbox", {
    name: "Next Editor Tab shortcut",
  });
  await binding.pressSequentially("Ctrl-PageDown");
  await binding.blur();
  await page.screenshot({ path: path.join(evidence, "keymap-settings.png") });
  await page.getByRole("button", { name: "Close dialog" }).click();
  await editor().click();
  await page.keyboard.press("Control+PageDown");
  await expect(page.locator(".tab.active")).toContainText("c.txt");
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(page.locator(".tab.active")).toContainText("b.txt");
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.locator(".tab.active")).toContainText("b.txt");
  // Read the real Python language-service signature, render Markdown, constrain a long docstring.
  await open("a.py");
  await page.waitForFunction(
    () => document.querySelectorAll(".cm-sem-function").length > 0,
  );
  await editor().click();
  await page.keyboard.press("ControlOrMeta+End");
  let at = await point("result = describe", "describe");
  await page.mouse.move(at.x, at.y);
  const hover = page.locator(".islet-lsp-tip");
  await expect(hover).toBeVisible({ timeout: 20000 });
  await expect(hover.locator("pre code")).toContainText("str");
  await expect(hover).toContainText("Rich documentation");
  await expect(hover.locator("hr")).toHaveCount(1);
  await expect(hover).not.toContainText("```");
  await expect(hover).not.toContainText("&nbsp;");
  const dimensions = await hover.evaluate((el) => ({
    height: el.clientHeight,
    scroll: el.scrollHeight,
  }));
  assert.ok(dimensions.height <= 480 && dimensions.scroll > dimensions.height);
  await hover.hover();
  await page.mouse.wheel(0, 240);
  await expect
    .poll(() => hover.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  await page.screenshot({ path: path.join(evidence, "hover-dark.png") });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("combobox")
    .filter({ has: page.locator('option[value="light"]') })
    .selectOption("light");
  await page.getByRole("button", { name: "Close dialog" }).click();
  at = await point("result = describe", "describe");
  await page.mouse.move(at.x, at.y);
  await expect(hover).toBeVisible();
  await page.screenshot({ path: path.join(evidence, "hover-light.png") });
  await page.mouse.move(10, 10);
  at = await point("missing_symbol", "missing_symbol");
  await page.keyboard.down("Control");
  await page.mouse.click(at.x, at.y);
  await page.keyboard.up("Control");
  await expect(
    page.getByText("No reference found", { exact: true }),
  ).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.screenshot({ path: path.join(evidence, "no-reference.png") });
  assert.deepEqual(errors, []);
  console.log(
    "PASS configurable tab switching, bottom Find/Replace, dialog clipboard, safe Markdown hover and no-result tooltip",
  );
} catch (e) {
  await page.screenshot({ path: path.join(evidence, "failure.png") });
  console.error("PAGE ERRORS", errors);
  throw e;
} finally {
  if (windowId)
    await page
      .evaluate(
        async (windowId) =>
          fetch("/host/request", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              operation: "app.unregisterWindow",
              payload: { windowId },
            }),
          }),
        windowId,
      )
      .catch(() => {});
  await browser.close();
  await fs.rm(root, { recursive: true, force: true });
}
