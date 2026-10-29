import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const temp = await fs.realpath(
  await fs.mkdtemp(path.join(os.tmpdir(), "islet-projects-ui-")),
);
const names = [
  "Atlas API",
  "Web frontend",
  "Documentation",
  "terraform",
  "Data tools",
  "Worker",
];
for (const name of names) {
  await fs.mkdir(path.join(temp, name));
  await fs.writeFile(path.join(temp, name, "notes.txt"), "Project fixture");
}
const evidence = path.join(
  os.homedir(),
  "islet-ui-screens",
  "projects-20261029",
);
await fs.mkdir(evidence, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.ISLET_CHROMIUM || chromium.executablePath(),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [],
  actions = [],
  sessions = new Map();
let preferences = {},
  windowId;
page.on("pageerror", (error) => errors.push(error.message));
await page.route("**/host/request", async (route) => {
  const { operation, payload = {} } = route.request().postDataJSON();
  if (operation === "app.registerWindow") windowId = payload.windowId;
  let result;
  if (operation === "session.load") result = sessions.get(payload.key) || null;
  else if (operation === "session.save") {
    sessions.set(payload.key, payload.value);
    result = true;
  } else if (operation === "settings.load") result = preferences;
  else if (operation === "settings.save") {
    preferences = payload.value;
    result = true;
  } else if (operation === "app.newWindow") {
    actions.push(operation);
    result = { windowId: "new-empty-workspace" };
  } else return route.continue();
  return route.fulfill({ json: { result } });
});
try {
  for (const name of names)
    await page.request.post("http://127.0.0.1:1420/host/request", {
      data: {
        operation: "recents.record",
        payload: {
          path: path.join(temp, name),
          kind: "folder",
          hostId: "local",
        },
      },
    });
  await page.goto("http://127.0.0.1:1420/");
  await expect(
    page.getByRole("heading", { name: "Welcome to Islet" }),
  ).toBeVisible();
  const list = page.getByRole("region", { name: "Recent projects" });
  await expect(list.getByRole("button").first()).toContainText("Worker");
  await expect(page.locator('.tree-row[data-root="true"]')).toHaveCount(0);
  for (const width of [1440, 1024, 768]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: path.join(evidence, "welcome-" + width + ".png"),
    });
  }
  await list.getByRole("button").first().click();
  const root = page.locator('.tree-row[data-root="true"]');
  await expect(root).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.locator(".tree-name").getByText("notes.txt", { exact: true }),
  ).toHaveCount(0);
  await root.locator(".tree-chevron").click();
  await expect(
    page.locator(".tree-name").getByText("notes.txt", { exact: true }),
  ).toBeVisible();
  await page.reload();
  // Reload without restoring session: this fixture root is supplied explicitly.
  await page.goto(
    "http://127.0.0.1:1420/?root=" +
      encodeURIComponent(path.join(temp, "Worker")),
  );
  await expect(page.locator('.tree-row[data-root="true"]')).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await page
    .getByRole("button", { name: "New Workspace", exact: true })
    .click();
  assert.equal(actions.at(-1), "app.newWindow");
  await page
    .getByRole("button", { name: /Worker|Workspace/ })
    .first()
    .click();
  await expect(
    page.getByRole("menuitem", { name: "New Workspace", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: /Open Recent: Worker/ }).first(),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  assert.deepEqual(errors, []);
  assert.ok(windowId);
  console.log(
    "PASS recent-project start screen, real folder reopen, default collapse, persisted expansion, New Workspace and recent menu",
  );
} finally {
  await browser.close();
  await fs.rm(temp, { recursive: true, force: true });
}
