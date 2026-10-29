import { openFixtureRoots } from "./project-tree-helper.mjs";
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const fixture = await fs.realpath(
  await fs.mkdtemp(path.join(os.tmpdir(), "islet-sidebar-ui-")),
);
const longName =
  "a_very_long_filename_that_must_remain_fully_visible_when_horizontally_scrolled.txt";
await fs.writeFile(path.join(fixture, longName), "sidebar fixture\n");
const folder = path.join(fixture, "folder with spaces");
await fs.mkdir(folder);
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.ISLET_CHROMIUM || chromium.executablePath(),
});
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const actions = [],
  errors = [];
let preferences = {},
  windowId;
page.on("pageerror", (e) => errors.push(e.message));
await page.route("**/host/request", async (route) => {
  const { operation, payload } = route.request().postDataJSON();
  if (operation === "app.registerWindow") windowId = payload.windowId;
  let result;
  if (operation === "settings.load") result = preferences;
  else if (operation === "settings.save") {
    preferences = payload.value;
    result = true;
  } else if (/^(session|recovery)\.(load|save|list|register)$/.test(operation))
    result = operation.endsWith(".list") ? [] : null;
  else if (operation === "desktop.terminals")
    result = [
      {
        id: "system",
        name: "System terminal",
        path: "/Applications/Terminal.app",
        available: true,
      },
      { id: "marinashell", name: "MarinaShell", path: "", available: false },
    ];
  else if (operation.startsWith("desktop.")) {
    actions.push({ operation, payload });
    result = true;
  } else return route.continue();
  await route.fulfill({ json: { result } });
});
try {
  await openFixtureRoots(page);
  await page.goto("http://127.0.0.1:1420/?root=" + encodeURIComponent(fixture));
  const file = page.locator(".tree-name").getByText(longName, { exact: true });
  await file.waitFor();
  const metrics = await page.locator(".tree").evaluate((tree) => ({
    scroll: tree.scrollWidth,
    client: tree.clientWidth,
    overflow: getComputedStyle(tree).overflowX,
    truncated: getComputedStyle(tree.querySelector(".tree-name")).textOverflow,
  }));
  assert.ok(metrics.scroll > metrics.client + 150, JSON.stringify(metrics));
  assert.equal(metrics.overflow, "auto");
  assert.equal(metrics.truncated, "clip");
  await page.locator(".tree").evaluate((tree) => {
    tree.scrollLeft = tree.scrollWidth;
  });
  assert.ok(
    (await page.locator(".tree").evaluate((tree) => tree.scrollLeft)) > 100,
  );
  const separator = page.getByRole("separator", {
    name: "Resize Project sidebar",
  });
  const original = await page
    .locator(".project-island")
    .evaluate((e) => e.getBoundingClientRect().width);
  await separator.focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await page
      .locator(".project-island")
      .evaluate((e) => e.getBoundingClientRect().width),
    original + 20,
  );
  const handle = await separator.boundingBox();
  await page.mouse.move(handle.x + 2, handle.y + 100);
  await page.mouse.down();
  await page.mouse.move(handle.x + 92, handle.y + 100);
  await page.mouse.up();
  const resized = await page
    .locator(".project-island")
    .evaluate((e) => e.getBoundingClientRect().width);
  assert.ok(resized > original + 70);
  await page.getByRole("button", { name: "Collapse Project sidebar" }).click();
  assert.equal(await page.locator(".project-island").count(), 0);
  await page.reload();
  await page.getByRole("button", { name: "Toggle Project tree" }).waitFor();
  assert.equal(await page.locator(".project-island").count(), 0);
  await page.getByRole("button", { name: "Toggle Project tree" }).click();
  await file.waitFor();
  assert.equal(
    await page
      .locator(".project-island")
      .evaluate((e) => e.getBoundingClientRect().width),
    resized,
  );
  await file.click({ button: "right" });
  await page
    .getByRole("menuitem", {
      name: /Reveal in Finder|Show in Explorer|Show in File Manager/,
    })
    .click();
  assert.deepEqual(actions.at(-1), {
    operation: "desktop.reveal",
    payload: { hostId: "local", path: path.join(fixture, longName) },
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByLabel("Default terminal", { exact: true })
    .selectOption("marinashell");
  await page
    .getByLabel("Terminal application path", { exact: true })
    .fill("/Applications/MarinaShell.app");
  await page
    .getByLabel("Terminal application path", { exact: true })
    .press("Enter");
  await page.waitForFunction(
    () =>
      document.querySelector('select[aria-label="Default terminal"]')?.value ===
      "marinashell",
  );
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.waitForTimeout(300);
  await page
    .locator(".tree-name")
    .getByText("folder with spaces", { exact: true })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Open in Terminal", exact: true })
    .click();
  await page.waitForTimeout(100);
  assert.deepEqual(actions.at(-1), {
    operation: "desktop.openTerminal",
    payload: {
      hostId: "local",
      path: folder,
      terminal: { id: "marinashell", path: "/Applications/MarinaShell.app" },
    },
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  assert.equal(
    await page.getByLabel("Default terminal", { exact: true }).inputValue(),
    "marinashell",
  );
  assert.equal(
    await page
      .getByLabel("Terminal application path", { exact: true })
      .inputValue(),
    "/Applications/MarinaShell.app",
  );
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await fs.mkdir("design/validation", { recursive: true });
  await page.screenshot({ path: "design/validation/sidebar-terminal.png" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: full filenames/scroll, pointer/keyboard resize, persistent collapse/width, reveal payload, terminal preference and folder handoff",
  );
} finally {
  if (windowId)
    await page
      .evaluate(async (windowId) => {
        await fetch("/host/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operation: "app.unregisterWindow",
            payload: { windowId },
          }),
        });
      }, windowId)
      .catch(() => {});
  await browser.close();
  await fs.rm(fixture, { recursive: true, force: true });
}
