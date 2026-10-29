import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { openFixtureRoots } from "./project-tree-helper.mjs";
const dir = await fs.realpath(
  await fs.mkdtemp(path.join(os.tmpdir(), "islet-clipboard-ui-")),
);
await fs.writeFile(path.join(dir, "paste.txt"), "original");
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.ISLET_CHROMIUM || chromium.executablePath(),
});
const page = await browser.newPage(),
  errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.route("**/host/request", (route) => {
  const { operation } = route.request().postDataJSON();
  if (operation === "settings.load")
    return route.fulfill({ json: { result: { keymap: "auto" } } });
  if (operation === "session.load")
    return route.fulfill({ json: { result: null } });
  return route.continue();
});
try {
  await openFixtureRoots(page);
  await page.goto("http://127.0.0.1:1420/?root=" + encodeURIComponent(dir));
  await page
    .locator(".tree-name")
    .getByText("paste.txt", { exact: true })
    .click();
  const content = page.locator(".cm-content");
  await expect(content).toContainText("original");
  const result = await content.evaluate((content) => {
    let reads = 0;
    Object.defineProperty(navigator.clipboard, "readText", {
      value: async () => {
        reads++;
        throw new DOMException(
          "Clipboard permission denied",
          "NotAllowedError",
        );
      },
    });
    const event = new KeyboardEvent("keydown", {
      key: "v",
      code: "KeyV",
      metaKey: /Mac/.test(navigator.platform),
      ctrlKey: !/Mac/.test(navigator.platform),
      bubbles: true,
      cancelable: true,
    });
    content.dispatchEvent(event);
    const data = new DataTransfer();
    data.setData("text/plain", "PASTED WITHOUT WEB PERMISSION");
    content.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      }),
    );
    return { prevented: event.defaultPrevented, reads };
  });
  assert.deepEqual(result, { prevented: false, reads: 0 });
  await expect(content).toContainText("PASTED WITHOUT WEB PERMISSION");
  await expect(page.locator(".error-banner")).toHaveCount(0);
  assert.deepEqual(errors, []);
  assert.equal(
    await fs.readFile(path.join(dir, "paste.txt"), "utf8"),
    "original",
  );
  console.log(
    "PASS native paste event with async web clipboard denied; no permission request, source file unchanged",
  );
} finally {
  await browser.close();
  await fs.rm(dir, { recursive: true, force: true });
}
