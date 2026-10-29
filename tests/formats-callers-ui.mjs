import { openFixtureRoots } from "./project-tree-helper.mjs";
import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
let browser, fixture;
const errors = [];
const saved = new Map();
let preferences = {};
try {
  fixture = await fs.mkdtemp(path.join(os.tmpdir(), "islet-formats-ui-"));
  const files = {
    "sample.json": '{ "json": true, "other": "json", "number": 42 }\n',
    "config.yaml": 'name: "islet"\nenabled: true\n',
    "config.toml": '[project]\nname = "islet"\n',
    "script.sh": '#!/bin/bash\nif true; then echo "ready"; fi\n',
    "schema.xml": '<project name="islet"><item>value</item></project>\n',
    "query.sql": "SELECT name FROM projects WHERE id = 2;\n",
    "config.ini": "[settings]\nname=islet\n# settings\n",
    Dockerfile: 'FROM node:24\nWORKDIR /app\nRUN echo "ready"\n',
    "requirements.txt": "fastapi>=0.1\n-r requirements-dev.txt\n# libraries\n",
    "navigation.py":
      "def caller():\n    return target()\n\n" +
      Array.from({ length: 150 }, (_, i) => `# filler ${i}`).join("\n") +
      "\n\ndef target():\n    return 1\n\ndef grandparent():\n    return caller()\n",
  };
  for (const [name, text] of Object.entries(files))
    await fs.writeFile(path.join(fixture, name), text);
  await fs.copyFile(
    "src-tauri/icons/128x128.png",
    path.join(fixture, "preview.png"),
  );
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.ISLET_CHROMIUM || chromium.executablePath(),
  });
  const page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  const jpeg = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 24;
    const context = canvas.getContext("2d");
    context.fillStyle = "#56a8f5";
    context.fillRect(0, 0, 32, 24);
    return canvas.toDataURL("image/jpeg").split(",")[1];
  });
  await fs.writeFile(
    path.join(fixture, "preview.jpeg"),
    Buffer.from(jpeg, "base64"),
  );

  await page.route("**/host/request", async (route) => {
    const { operation, payload = {} } = route.request().postDataJSON();
    if (operation === "settings.load")
      return route.fulfill({ json: { result: preferences } });
    if (operation === "settings.save") {
      preferences = payload.value;
      return route.fulfill({ json: { result: true } });
    }
    if (operation === "session.load")
      return route.fulfill({
        json: { result: saved.get(payload.key) || null },
      });
    if (operation === "session.save") {
      saved.set(payload.key, payload.value);
      return route.fulfill({ json: { result: true } });
    }
    if (operation === "session.list" || operation === "app.pendingRequests")
      return route.fulfill({ json: { result: [] } });
    await route.continue();
  });
  const open = async (name) => {
    await page.locator(".tree-name").getByText(name, { exact: true }).click();
    await expect(page.locator(".tab.active")).toContainText(name);
  };
  await openFixtureRoots(page);
  await page.goto("http://127.0.0.1:1420/?root=" + encodeURIComponent(fixture));
  for (const [name, label] of [
    ["sample.json", "JSON"],
    ["config.yaml", "YAML"],
    ["config.toml", "TOML"],
    ["script.sh", "Shell"],
    ["schema.xml", "XML"],
    ["query.sql", "SQL"],
    ["config.ini", "INI"],
    ["Dockerfile", "Dockerfile"],
    ["requirements.txt", "Requirements"],
  ]) {
    await open(name);
    await expect(page.locator(".file-format")).toHaveText(label);
    await expect
      .poll(() => page.locator(".cm-line span[class]").count())
      .toBeGreaterThan(1);
  }
  await open("sample.json");
  await page
    .locator(".cm-line")
    .first()
    .getByText('"json"', { exact: true })
    .first()
    .dblclick();
  await expect(page.locator(".cm-selectionBackground").first()).toBeVisible();
  assert.equal(
    await page
      .locator(".cm-selectionBackground")
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgb(33, 66, 131)",
  );
  assert.match(
    await page
      .locator(".cm-activeLine")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    /^rgba/,
  );
  await page.screenshot({
    path: "design/validation/formats-selection-dark.png",
  });
  // A pinned image is a separate read-only tab, without a CodeMirror binary buffer.
  await open("preview.png");
  await expect(page.getByRole("img", { name: "preview.png" })).toBeVisible();
  await expect(page.locator(".image-toolbar")).toContainText("128 × 128");
  assert.equal(await page.locator(".cm-editor").count(), 0);
  await page.getByLabel("Image zoom").selectOption("2");
  assert.equal(
    await page
      .getByRole("img", { name: "preview.png" })
      .evaluate((el) => Math.round(el.getBoundingClientRect().width)),
    256,
  );
  await page.screenshot({ path: "design/validation/image-preview.png" });
  await open("preview.jpeg");
  await expect(page.getByRole("img", { name: "preview.jpeg" })).toBeVisible();
  await expect(page.locator(".image-toolbar")).toContainText("32 × 24");
  await open("navigation.py");
  const symbol = page
    .locator(".cm-line")
    .filter({ hasText: "return target()" })
    .locator(".cm-sem-function")
    .filter({ hasText: "target" });
  await expect(symbol).toBeVisible();
  await symbol.hover();
  await page.keyboard.down("Control");
  await expect
    .poll(() => symbol.evaluate((el) => getComputedStyle(el).cursor))
    .toBe("pointer");
  await symbol.click();
  await page.keyboard.up("Control");
  const declaration = page
    .locator(".cm-line")
    .filter({ hasText: "def target():" });
  await expect(declaration).toBeVisible();
  await expect
    .poll(async () => {
      const line = await declaration.boundingBox(),
        scroll = await page.locator(".cm-scroller").boundingBox();
      const offset = line && scroll ? line.y - scroll.y : null;
      return offset !== null && offset > 60 && offset < 125;
    })
    .toBe(true);
  await page
    .getByRole("button", { name: "Toggle caller panel", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Function callers" }),
  ).toBeVisible();
  await expect(page.locator(".caller-target")).toContainText("target");
  await expect(
    page.locator(".caller-name").getByText("caller", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.locator(".caller-name").getByText("grandparent", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "design/validation/callers-dark.png" });
  await page
    .locator(".caller-row")
    .filter({ hasText: "caller" })
    .first()
    .click();
  await expect(
    page.locator(".cm-line").filter({ hasText: "def caller():" }),
  ).toBeVisible();
  await expect.poll(() => preferences.callerPanel).toBe(true);
  await page.getByRole("button", { name: "Hide callers" }).click();
  await expect(
    page.getByRole("region", { name: "Function callers" }),
  ).toHaveCount(0);
  await expect.poll(() => preferences.callerPanel).toBe(false);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Appearance").selectOption("light");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await open("sample.json");
  await page
    .locator(".cm-line")
    .first()
    .getByText('"json"', { exact: true })
    .first()
    .dblclick();
  await expect
    .poll(() =>
      page
        .locator(".cm-selectionBackground")
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    )
    .toBe("rgb(166, 210, 255)");
  await page.screenshot({
    path: "design/validation/formats-selection-light.png",
  });
  assert.deepEqual(errors, []);
  console.log(
    "Formats, image previews, selection themes, modifier cursor, definition buffer and real caller navigation passed.",
  );
} finally {
  await browser?.close();
  if (fixture) await fs.rm(fixture, { recursive: true, force: true });
}
