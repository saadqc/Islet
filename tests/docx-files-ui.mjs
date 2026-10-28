import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";

const fixture = await fs.realpath(
  await fs.mkdtemp(path.join(os.tmpdir(), "islet-docx-files-ui-")),
);
const evidence = path.join(
  os.homedir(),
  "islet-ui-screens",
  "offline-docx-files-20261029",
);
await fs.mkdir(evidence, { recursive: true });
await fs.mkdir(path.join(fixture, "nested"));
await fs.writeFile(path.join(fixture, "nested", "inside.txt"), "nested file\n");
await fs.writeFile(
  path.join(fixture, "data.csv"),
  "\uFEFFid;name;amount\r\n0012;Original;12\r\n0000;Other;7\r\n",
);
await fs.writeFile(path.join(fixture, "notes.txt"), "text still works\n");
for (const type of ["xls", "xlsx"]) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      ["Code", "Amount"],
      ["0007", 12.5],
    ]),
    "First",
  );
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([["Unchanged", true]]),
    "Second",
  );
  await fs.writeFile(
    path.join(fixture, "book." + type),
    XLSX.write(book, { bookType: type, type: "buffer" }),
  );
}
await fs.copyFile("src/docx/blank.docx", path.join(fixture, "document.docx"));
await fs.writeFile(path.join(fixture, "legacy.doc"), "legacy");
const outside = await fs.realpath(
  await fs.mkdtemp(path.join(os.tmpdir(), "islet-open-file-")),
);
await fs.writeFile(
  path.join(outside, "selected.txt"),
  "opened the selected file",
);
await fs.copyFile("src/docx/blank.docx", path.join(outside, "selected.docx"));
let preferences = {},
  browser;
const saved = new Map(),
  errors = [],
  external = [];
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.ISLET_CHROMIUM || chromium.executablePath(),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.error("PAGE", e.message);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error("BROWSER", msg.text());
  });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
      external.push(url.href);
      return route.abort();
    }
    if (url.pathname === "/host/request") {
      const { operation, payload = {} } = route.request().postDataJSON();
      let result;
      if (operation === "dialog.open")
        result = path.join(outside, "selected.docx");
      else if (operation === "settings.load") result = preferences;
      else if (operation === "settings.save") {
        preferences = payload.value;
        result = true;
      } else if (operation === "session.load")
        result = saved.get(payload.key) || null;
      else if (operation === "session.save") {
        saved.set(payload.key, payload.value);
        result = true;
      } else if (
        operation === "session.list" ||
        operation === "app.pendingRequests"
      )
        result = [];
      else if (operation === "session.register") result = true;
      else return route.continue();
      return route.fulfill({ json: { result } });
    }
    if (url.pathname.startsWith("/assets/")) {
      const filename = path.basename(url.pathname);
      return route.fulfill({
        body: await fs.readFile(path.join("dist/assets", filename)),
        contentType: filename.endsWith(".css")
          ? "text/css"
          : filename.endsWith(".js")
            ? "application/javascript"
            : "font/woff2",
      });
    }
    if (url.pathname === "/") {
      return route.fulfill({
        body: await fs.readFile("dist/index.html", "utf8"),
        contentType: "text/html",
        headers: {
          "content-security-policy":
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'",
        },
      });
    }
    return route.continue();
  });
  const tree = (name) =>
    page.locator(".tree-name").getByText(name, { exact: true });
  const open = async (name) => {
    await tree(name).click();
    await expect(page.locator(".tab.active")).toContainText(name);
  };
  const cell = (x, y) =>
    page.locator(`.jss_worksheet tbody td[data-x="${x}"][data-y="${y}"]`);
  const edit = async (x, y, value) => {
    await cell(x, y).dblclick();
    const input = cell(x, y).locator("input, textarea");
    await expect(input).toBeVisible();
    await input.fill(value);
    await page.keyboard.press("Enter");
    await expect(cell(x, y)).toHaveText(value);
  };
  const create = async (directory, name) => {
    await page
      .getByRole("button", {
        name: directory ? "New Folder" : "New File",
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog", {
      name: directory ? "New Folder" : "New File",
      exact: true,
    });
    await dialog
      .getByLabel(directory ? "Folder name" : "File name", { exact: true })
      .fill(name);
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  };
  await page.goto("http://127.0.0.1:1420/?root=" + encodeURIComponent(fixture));
  await tree("data.csv").waitFor();
  await open("document.docx");
  await expect(page.locator('.docx-editor[data-ready="true"]')).toBeVisible({
    timeout: 60000,
  });
  await fs.writeFile(
    path.join(evidence, "docx1-dom.html"),
    await page.content(),
  );
  await page.screenshot({ path: path.join(evidence, "docx1-open.png") });
  const body = page.locator(".docx-editor .superdoc-page").first();
  const zoomValue = page.getByRole("button", {
    name: "Reset document zoom to 100%",
  });
  const pageWidth = async () => (await body.boundingBox()).width;
  const originalWidth = await pageWidth();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(zoomValue).toHaveText("110%");
  await expect.poll(pageWidth).toBeGreaterThan(originalWidth + 40);
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  await expect(zoomValue).toHaveText("100%");
  await page.getByRole("slider", { name: "Document zoom" }).focus();
  await page.keyboard.press("End");
  await expect(zoomValue).toHaveText("400%");
  await expect(
    page.getByRole("button", { name: "Zoom in", exact: true }),
  ).toBeDisabled();
  await zoomValue.click();
  await expect(zoomValue).toHaveText("100%");
  await page.keyboard.press("ControlOrMeta+=");
  await expect(zoomValue).toHaveText("110%");
  await page.keyboard.press("ControlOrMeta+-");
  await expect(zoomValue).toHaveText("100%");
  await page.keyboard.press("ControlOrMeta+=");
  await page.keyboard.press("ControlOrMeta+0");
  await expect(zoomValue).toHaveText("100%");
  await page.setViewportSize({ width: 768, height: 900 });
  await page.getByRole("button", { name: "Fit document to width" }).click();
  await expect(
    page.getByRole("button", { name: "Fit document to width" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(async () => (await body.boundingBox()).width)
    .toBeLessThan(470);
  await page.screenshot({ path: path.join(evidence, "zoom-fit-768.png") });
  await expect(page.locator(".changes-bar")).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect.poll(pageWidth).toBeGreaterThan(700);
  await page.screenshot({ path: path.join(evidence, "zoom-fit-1280.png") });
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  const rememberedZoom = await zoomValue.innerText();
  await open("notes.txt");
  await open("document.docx");
  await expect(page.locator('.docx-editor[data-ready="true"]')).toBeVisible({
    timeout: 30000,
  });
  await expect(zoomValue).toHaveText(rememberedZoom);
  await zoomValue.click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator(".changes-bar")).toHaveCount(0);
  await body.click({ position: { x: 110, y: 105 } });
  await page.keyboard.type(
    "Offline DOCX editing works. FindMe findme FindMe.",
    { delay: 50 },
  );
  await page.waitForTimeout(2000);
  await expect(page.locator(".tab.active")).toContainText("document.docx");
  await page.screenshot({ path: path.join(evidence, "after-type.png") });
  await page.keyboard.press("ControlOrMeta+s");
  await expect
    .poll(
      async () =>
        (await fs.readFile(path.join(fixture, "document.docx"))).length,
    )
    .not.toBe((await fs.stat("src/docx/blank.docx")).size);
  await expect(page.locator(".changes-bar")).toHaveCount(0);
  await page.screenshot({ path: path.join(evidence, "docx-edited-1440.png") });
  for (const width of [1280, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await page.screenshot({
      path: path.join(evidence, `docx-icons-${width}.png`),
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await fs.copyFile(
    path.join(fixture, "document.docx"),
    path.join(evidence, "saved.docx"),
  );
  await open("notes.txt");
  await open("document.docx");
  await expect(page.locator('.docx-editor[data-ready="true"]')).toBeVisible({
    timeout: 60000,
  });
  await expect(page.locator(".docx-editor")).toContainText(
    "Offline DOCX editing works.",
  );
  // Search uses native document ranges, is view-only until replacement, and
  // does not trigger browser Find/Reload on either platform's shortcuts.
  await page.keyboard.press("Control+f");
  const find = page.getByRole("textbox", {
    name: "Find in document",
    exact: true,
  });
  const results = page.getByLabel("Document search results");
  await expect(find).toBeFocused();
  await find.fill("FindMe");
  await expect(results).toHaveText("1 of 3");
  await page.keyboard.press("Enter");
  await expect(results).toHaveText("2 of 3");
  await expect(find).toBeFocused();
  await page.keyboard.press("Shift+Enter");
  await expect(results).toHaveText("1 of 3");
  await page.getByRole("checkbox", { name: "Match case" }).check();
  await expect(results).toHaveText("1 of 2");
  await expect(page.locator(".changes-bar")).toHaveCount(0);
  await page.keyboard.press("Meta+r");
  const replace = page.getByRole("textbox", {
    name: "Replace with",
    exact: true,
  });
  await expect(replace).toBeVisible();
  await replace.fill("Found");
  await page
    .locator(".docx-search")
    .getByRole("button", { name: "Replace", exact: true })
    .click();
  await expect(results).toHaveText("1 of 1");
  await page
    .locator(".docx-search")
    .getByRole("button", { name: "Replace all", exact: true })
    .click();
  await expect(results).toHaveText("No results");
  await expect(page.locator(".docx-canvas")).toContainText(
    "Found findme Found.",
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(results).toHaveText("1 of 1");
  await expect(page.locator(".docx-canvas")).toContainText(
    "Found findme FindMe.",
  );
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(results).toHaveText("No results");
  await find.fill("Found");
  await expect(results).toHaveText("1 of 2");
  for (const width of [1440, 1280, 1024, 768]) {
    await page.setViewportSize({ width, height: 900 });
    // Let the vendor toolbar finish its debounced responsive measurement.
    await page.waitForTimeout(350);
    await page.screenshot({
      path: path.join(evidence, `docx-search-${width}.png`),
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.keyboard.press("Escape");
  await expect(page.locator(".docx-search")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.locator(".changes-bar")).toHaveCount(0);
  await open("notes.txt");
  await open("document.docx");
  await expect(page.locator('.docx-editor[data-ready="true"]')).toBeVisible({
    timeout: 30000,
  });
  await expect(page.locator(".docx-canvas")).toContainText(
    "Found findme Found.",
  );
  await page.keyboard.press("Control+r");
  await expect(replace).toBeVisible();
  await page.keyboard.press("Meta+f");
  await expect(find).toBeFocused();
  await expect(replace).toHaveCount(0);
  await find.fill("not present in this document");
  await expect(results).toHaveText("No results");
  await page.keyboard.press("Escape");
  let recoveryBefore;
  await expect
    .poll(() => {
      const clean = [...saved.values()]
        .flatMap((value) => value?.documents || [])
        .find(
          (doc) =>
            doc.path === path.join(fixture, "document.docx") && !doc.dirty,
        );
      if (clean) recoveryBefore = clean.text;
      return !!clean;
    })
    .toBe(true);
  await page
    .locator(".docx-editor .superdoc-page")
    .first()
    .click({ position: { x: 110, y: 105 } });
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" Recovery proof.");
  await expect
    .poll(() =>
      [...saved.values()].some((value) =>
        value?.documents?.some(
          (doc) =>
            doc.path === path.join(fixture, "document.docx") &&
            doc.dirty &&
            doc.text !== doc.savedText &&
            doc.text !== recoveryBefore,
        ),
      ),
    )
    .toBe(true);
  await page.reload();
  await expect(page.locator('.docx-editor[data-ready="true"]')).toBeVisible({
    timeout: 30000,
  });
  await expect(page.locator(".docx-editor")).toContainText("Recovery proof.");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.locator(".changes-bar")).toHaveCount(0);
  // Open File opens a standalone DOCX without adding its parent to the project.
  await page.locator(".workspace-switch").click();
  await page.getByRole("menuitem", { name: "Open File…", exact: true }).click();
  await expect(page.locator(".tab.active")).toContainText("selected.docx");
  await expect(page.locator('.docx-editor[data-ready="true"]')).toBeVisible({
    timeout: 30000,
  });
  await expect(tree(path.basename(outside))).toHaveCount(0);
  await expect(tree("selected.txt")).toHaveCount(0);
  const original = await fs.readFile(path.join(outside, "selected.docx"));
  await page
    .locator(".docx-editor .superdoc-page")
    .first()
    .click({ position: { x: 110, y: 105 } });
  await page.keyboard.type("Standalone DOCX without a parent project", {
    delay: 25,
  });
  await expect(page.locator(".docx-editor")).toContainText(
    "Standalone DOCX without a parent project",
  );
  await expect(page.locator(".changes-bar")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+s");
  await expect
    .poll(async () =>
      (await fs.readFile(path.join(outside, "selected.docx"))).equals(original),
    )
    .toBe(false);
  await expect(page.locator(".changes-bar")).toHaveCount(0);
  await expect
    .poll(() =>
      [...saved.values()].some(
        (value) =>
          value?.documents?.some(
            (doc) =>
              doc.id === value.active &&
              doc.path === path.join(outside, "selected.docx") &&
              !doc.dirty,
          ) && !value.roots?.some((root) => root.path === outside),
      ),
    )
    .toBe(true);
  await page.reload();
  await expect(page.locator('.docx-editor[data-ready="true"]')).toBeVisible({
    timeout: 30000,
  });
  await expect(page.locator(".docx-editor")).toContainText(
    "Standalone DOCX without a parent project",
  );
  await expect(tree(path.basename(outside))).toHaveCount(0);
  // Internal drag onto a folder copies; onto the editor opens the source.
  await tree("notes.txt").locator("..").dragTo(tree("nested").locator(".."));
  await expect
    .poll(() =>
      fs
        .readFile(path.join(fixture, "nested/notes.txt"), "utf8")
        .catch(() => null),
    )
    .toBe("text still works\n");
  await tree("notes.txt")
    .locator("..")
    .dragTo(page.locator(".editor-island"), {
      targetPosition: { x: 300, y: 100 },
    });
  await expect(page.locator(".tab.active")).toContainText("notes.txt");
  // A new DOCX is a valid local blank file, not an empty text placeholder.
  await create(false, "new-document.docx");
  await expect(page.locator('.docx-editor[data-ready="true"]')).toBeVisible({
    timeout: 30000,
  });
  assert.equal(
    (await fs.readFile(path.join(fixture, "new-document.docx")))
      .subarray(0, 2)
      .toString(),
    "PK",
  );
  await tree("legacy.doc").click();
  await expect(page.getByRole("alert")).toContainText(
    "Legacy .doc files are not supported",
  );
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  console.log(
    "DOCX offline edit/save/reopen, creation, Open File and drag/drop passed",
  );
} finally {
  await browser?.close();
  await fs.rm(fixture, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
}
