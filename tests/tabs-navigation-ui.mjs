import { openFixtureRoots } from "./project-tree-helper.mjs";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let fixture, browser, page, windowId;
const errors = [];
const snapshots = new Map();
try {
  fixture = await fs.mkdtemp(path.join(os.tmpdir(), "islet-tabs-ui-"));
  await fs.writeFile(
    path.join(fixture, "chooser-a.txt"),
    "First chosen file\n",
  );
  await fs.writeFile(
    path.join(fixture, "chooser-b.txt"),
    "Second chosen file\n",
  );
  await fs.writeFile(
    path.join(fixture, "other.txt"),
    "Another persistent tab\n",
  );
  await fs.writeFile(
    path.join(fixture, "navigation.py"),
    "def alpha():\n    return omega()\n\nresult = alpha()\n" +
      Array.from({ length: 160 }, (_, i) => "# filler " + i).join("\n") +
      "\n\ndef omega():\n    return alpha()\n",
  );
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.ISLET_CHROMIUM || chromium.executablePath(),
  });
  page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on("pageerror", (error) => errors.push(error.message));
  let choices = 0;
  await page.route("**/host/request", async (route) => {
    const { operation, payload = {} } = route.request().postDataJSON();
    if (operation === "app.registerWindow") windowId = payload.windowId;
    if (operation === "dialog.open") {
      assert.equal(payload.multiple, true);
      return route.fulfill({
        json: {
          result:
            choices++ === 0
              ? [
                  path.join(fixture, "chooser-a.txt"),
                  path.join(fixture, "chooser-b.txt"),
                ]
              : path.join(fixture, "other.txt"),
        },
      });
    }
    if (operation === "session.load")
      return route.fulfill({
        json: { result: snapshots.get(payload.key) || null },
      });
    if (operation === "session.save") {
      snapshots.set(payload.key, payload.value);
      return route.fulfill({ json: { result: true } });
    }
    if (operation === "settings.load")
      return route.fulfill({ json: { result: {} } });
    if (operation === "session.list" || operation === "app.pendingRequests")
      return route.fulfill({ json: { result: [] } });
    await route.continue();
  });
  const open = async (name) => {
    await page.locator(".tree-name").getByText(name, { exact: true }).click();
    await page.locator(".tab.active").filter({ hasText: name }).waitFor();
  };
  const tab = (name) => page.locator(".tab").filter({ hasText: name });
  const state = () =>
    [...snapshots.values()].find((value) =>
      value?.documents?.some((document) =>
        document.path.endsWith("/navigation.py"),
      ),
    );
  const caret = () =>
    page
      .locator(".statusbar > span")
      .allTextContents()
      .then((values) => values.find((value) => /^\d+:\d+$/.test(value)));
  async function ctrlClick(line, token) {
    const element = page
      .locator(".cm-line")
      .filter({ hasText: line })
      .locator(".cm-sem-function")
      .filter({ hasText: token });
    await element.waitFor();
    await page.keyboard.down("Control");
    try {
      await element.click();
    } finally {
      await page.keyboard.up("Control");
    }
  }
  await openFixtureRoots(page);
  await page.goto("http://127.0.0.1:1420/?root=" + encodeURIComponent(fixture));
  await open("other.txt");
  await open("navigation.py");
  await expect(page.locator(".tab")).toHaveCount(2);
  assert.equal(await page.locator(".preview-tab").count(), 0);
  await tab("navigation.py").dragTo(tab("other.txt"));
  await expect(page.locator(".tabs .tab").first()).toContainText(
    "navigation.py",
  );
  await tab("navigation.py").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Pin Tab", exact: true }).click();
  await expect(tab("navigation.py").locator("svg.lucide-pin")).toBeVisible();
  await tab("navigation.py").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Unpin Tab", exact: true }).click();
  assert.equal(await tab("navigation.py").locator("svg.lucide-pin").count(), 0);
  await tab("navigation.py").dblclick();
  await expect(tab("navigation.py").locator("svg.lucide-pin")).toBeVisible();
  await ctrlClick("return omega()", "omega");
  assert.equal(
    await page.getByRole("menu").count(),
    0,
    "Control-click must not also open the macOS context menu",
  );
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".statusbar > span")].some(
      (element) => element.textContent === "166:5",
    ),
  );
  await page.waitForFunction(
    () => document.querySelector(".cm-scroller").scrollTop > 1000,
  );
  await expect(
    page.locator(".cm-line").filter({ hasText: "def omega():" }),
  ).toBeVisible();
  const targetScroll = await page
    .locator(".cm-scroller")
    .evaluate((element) => element.scrollTop);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".statusbar > span")].some((element) =>
      /^2:/.test(element.textContent),
    ),
  );
  assert.equal(
    await page.locator(".cm-scroller").evaluate((element) => element.scrollTop),
    0,
  );
  await page.getByRole("button", { name: "Forward", exact: true }).click();
  await expect.poll(() => state()?.history?.index).toBe(1);
  await page.waitForFunction(
    (expected) =>
      Math.abs(document.querySelector(".cm-scroller").scrollTop - expected) <
        1 &&
      [...document.querySelectorAll(".statusbar > span")].some(
        (element) => element.textContent === "166:5",
      ),
    targetScroll,
  );
  assert.equal(await caret(), "166:5");
  await ctrlClick("return alpha()", "alpha");
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".statusbar > span")].some(
      (element) => element.textContent === "1:5",
    ),
  );
  await ctrlClick("return omega()", "omega");
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".statusbar > span")].some(
      (element) => element.textContent === "166:5",
    ),
  );
  await page.waitForTimeout(300);
  const history = state().history.entries;
  const destinations = history.filter(
    (entry) =>
      entry.path.endsWith("/navigation.py") &&
      entry.head === history.at(-1).head,
  );
  assert.equal(
    destinations.length,
    1,
    "Repeated function B must occur once in navigation history",
  );
  const identities = history.map((entry) =>
    JSON.stringify([entry.documentId, entry.mode, entry.anchor, entry.head]),
  );
  assert.equal(new Set(identities).size, identities.length);
  assert.equal(await page.locator(".tab").count(), 2);
  await page.locator(".workspace-switch").click();
  await page.getByRole("menuitem", { name: "Open File…", exact: true }).click();
  await expect(page.locator(".tab")).toHaveCount(4);
  await expect(page.locator(".tab.active")).toContainText("chooser-b.txt");
  await page.locator(".workspace-switch").click();
  await page.getByRole("menuitem", { name: "Open File…", exact: true }).click();
  await expect(page.locator(".tab.active")).toContainText("other.txt");
  assert.equal(await page.locator(".tab").count(), 4);
  assert.deepEqual(errors, []);
  console.log(
    "PASS persistent multi-file tabs, drag reorder, pin/unpin, real same-file Ctrl-click reveal, exact Back/Forward viewport and unique repeated semantic destinations",
  );
} catch (error) {
  console.error("Browser errors", errors);
  if (page) {
    console.error("Alerts", await page.getByRole("alert").allTextContents());
    await fs.mkdir("design/validation", { recursive: true });
    await page.screenshot({
      path: "design/validation/tabs-navigation-failure.png",
    });
  }
  throw error;
} finally {
  if (page && windowId)
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
  await browser?.close();
  if (fixture) await fs.rm(fixture, { recursive: true, force: true });
}
