import { openFixtureRoots } from "./project-tree-helper.mjs";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const fixture = await fs.realpath(
  await fs.mkdtemp(path.join(os.tmpdir(), "islet-updates-ui-")),
);
await fs.writeFile(path.join(fixture, "review.txt"), "review\n");
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.ISLET_CHROMIUM || chromium.executablePath(),
});
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [],
  calls = [];
page.on("pageerror", (error) => errors.push(error.message));
let state = {
  phase: "idle",
  currentVersion: "0.1.2",
  downloaded: 0,
  supported: true,
  preferences: { autoCheck: true, autoDownload: true },
  releasesUrl: "https://github.com/saadqc/Islet/releases",
};
let available = false,
  ack,
  requestId = 0,
  saved = 0;
await page.addInitScript(() => {
  window.EventSource = class {
    constructor() {
      window.__updaterEvents = this;
    }
    close() {}
  };
});
const emit = async (name, payload) =>
  page.evaluate(
    ({ name, payload }) => {
      window.__updaterEvents.onmessage({
        data: JSON.stringify({ event: name, payload }),
      });
    },
    { name, payload },
  );
const status = async (patch) => {
  state = { ...state, ...patch };
  await emit("updater-status", state);
};
await page.route("**/host/request", async (route) => {
  const { operation, payload = {} } = route.request().postDataJSON();
  calls.push(operation);
  let result;
  if (operation === "settings.load") result = {};
  else if (operation === "settings.save") result = true;
  else if (/^(session|recovery)\.(load|save|list|register)$/.test(operation)) {
    if (operation === "session.save") saved++;
    result = operation.endsWith(".list") ? [] : null;
  } else if (operation === "desktop.terminals") result = [];
  else if (operation === "updater.status") result = state;
  else if (operation === "updater.configure") {
    state = { ...state, preferences: payload };
    result = state;
  } else if (operation === "updater.check") {
    state = {
      ...state,
      phase: available ? "available" : "current",
      ...(available
        ? { version: "0.2.0", notes: "Navigation improvements and fixes." }
        : {}),
    };
    result = state;
  } else if (operation === "updater.download") {
    state = { ...state, phase: "downloading", downloaded: 50, total: 100 };
    result = state;
  } else if (operation === "updater.install") {
    const current = ++requestId;
    const reply = new Promise((resolve) => {
      ack = resolve;
    });
    await status({ phase: "preparing", error: undefined });
    await emit("updater-prepare", { requestId: current });
    const clean = await reply;
    await emit("updater-abort", { requestId: current });
    if (!clean) {
      await status({
        phase: "ready",
        error: "Save changes in every workspace before updating.",
      });
      await route.fulfill({
        status: 400,
        json: { error: { message: state.error } },
      });
      return;
    }
    await status({ phase: "installing" });
    result = state;
  } else if (operation === "updater.acknowledge") {
    ack(payload.clean);
    result = state;
  } else return route.continue();
  await route.fulfill({ json: { result } });
});
try {
  await openFixtureRoots(page);
  await page.goto("http://127.0.0.1:1420/?root=" + encodeURIComponent(fixture));
  await page
    .locator(".tree-name")
    .getByText("review.txt", { exact: true })
    .click();
  await page.locator(".cm-content").waitFor();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  const evidence = path.join(
    os.homedir(),
    "islet-ui-screens",
    "checkboxes-20261029",
  );
  await fs.mkdir(evidence, { recursive: true });
  for (const theme of ["light", "dark"]) {
    await settings.getByLabel("Appearance").selectOption(theme);
    for (const width of [1440, 1024, 768]) {
      await page.setViewportSize({ width, height: 900 });
      const rows = await settings
        .locator(".check-label")
        .evaluateAll((labels) =>
          labels.map((label) => {
            const box = label
              .querySelector('input[type="checkbox"]')
              .getBoundingClientRect();
            const text = [...label.childNodes].find(
              (node) =>
                node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
            );
            const range = document.createRange();
            range.selectNodeContents(text);
            const line = range.getClientRects()[0];
            return {
              inline:
                box.right <= line.left &&
                Math.abs(box.y + box.height / 2 - (line.y + line.height / 2)) <
                  4,
              width: box.width,
            };
          }),
        );
      assert.ok(
        rows.length >= 3 && rows.every((row) => row.inline && row.width >= 13),
        JSON.stringify(rows),
      );
      await settings
        .locator(".update-settings")
        .screenshot({ path: path.join(evidence, `${theme}-${width}.png`) });
    }
  }
  await settings
    .getByRole("button", { name: "Check for Updates", exact: true })
    .click();
  await expect(settings.getByRole("status")).toHaveText("You’re up to date.");
  await settings.getByLabel("Automatically download updates").uncheck();
  assert.equal(state.preferences.autoDownload, false);
  available = true;
  await settings
    .getByRole("button", { name: "Check for Updates", exact: true })
    .click();
  await expect(settings.getByRole("status")).toHaveText(
    "Islet 0.2.0 is available.",
  );
  await settings.getByRole("button", { name: "Update…", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Update Islet",
    exact: true,
  });
  await dialog.getByRole("button", { name: "Update", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText(
    "Downloading update… 50%",
  );
  assert.equal(calls.includes("updater.install"), false);
  await status({ phase: "ready", downloaded: 100 });
  await expect(
    dialog.getByRole("button", { name: "Restart and Update" }),
  ).toBeVisible();
  await fs.mkdir("design/validation", { recursive: true });
  await page.screenshot({ path: "design/validation/updater-ready.png" });
  await dialog.getByRole("button", { name: "Later", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  assert.equal(calls.includes("updater.install"), false);
  await page.locator(".cm-content").click();
  await page.keyboard.type("unsaved edit");
  await page
    .getByRole("button", { name: "Restart to Update…", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Restart and Update" }).click();
  await expect(dialog.getByRole("status")).toHaveText(
    "Save changes in every workspace before updating.",
  );
  await expect(page.locator(".update-freeze")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Later", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("unsaved edit");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+s");
  await expect(page.locator(".dirty-dot")).toHaveCount(0);
  const savedBeforeRestart = saved;
  await page
    .getByRole("button", { name: "Restart to Update…", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Restart and Update" }).click();
  await expect(dialog.getByRole("status")).toHaveText("Installing update…");
  assert.ok(
    saved > savedBeforeRestart,
    "Recovery must flush before clean restart acknowledgement",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS updater UI: check/no-update, preferences, update/progress, verified restart prompt, Later, dirty rejection, recovery flush and explicit clean restart (mock updater)",
  );
} finally {
  await browser.close();
  await fs.rm(fixture, { recursive: true, force: true });
}
