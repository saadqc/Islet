import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// SSH itself is exercised by test:ssh against disposable OpenSSH. This scenario
// checks the real production UI's restoration, reconnect controls and buffers.
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.ISLET_CHROMIUM || chromium.executablePath(),
});
const evidence = path.join(
  os.homedir(),
  "islet-ui-screens",
  "ssh-reconnect-20261029",
);
await fs.mkdir(evidence, { recursive: true });
const hostId = "ssh:fixture",
  calls = [],
  errors = [],
  attached = new Set();
const roots = ["backend", "terraform"].map((label) => ({
  id: label,
  hostId,
  path: "/project/" + label,
  label,
  state: "ready",
}));
const documentId = JSON.stringify([hostId, roots[0].path + "/notes.txt"]);
const snapshot = {
  id: "reconnect-fixture",
  name: "Reconnect fixture",
  roots,
  tabs: [documentId],
  active: documentId,
  documents: [
    {
      id: documentId,
      hostId,
      path: roots[0].path + "/notes.txt",
      text: "UNSAVED LOCAL BUFFER",
      savedText: "original",
      revision: "one",
      diskRevision: "one",
      dirty: true,
      saveState: "pending",
      version: 2,
    },
  ],
};
let connected = false,
  allowConnect = true,
  unavailablePath,
  revision = "one",
  sessions = new Map();
async function prepare(page) {
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.EventSource = class {
      constructor() {
        window.__sshEvents = this;
      }
      close() {}
    };
  });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname))
      return route.abort();
    if (url.pathname === "/")
      return route.fulfill({
        body: await fs.readFile("dist/index.html"),
        contentType: "text/html",
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
  await page.route("**/host/request", async (route) => {
    const { operation, payload = {} } = route.request().postDataJSON();
    calls.push({ operation, payload });
    let result = true;
    if (operation === "settings.load") result = {};
    else if (operation === "session.load")
      result = payload.key.startsWith("window:")
        ? { key: "reconnect-fixture" }
        : sessions.get(payload.key) || snapshot;
    else if (operation === "session.save")
      sessions.set(payload.key, payload.value);
    else if (
      ["session.list", "app.pendingRequests", "desktop.terminals"].includes(
        operation,
      )
    )
      result = [];
    else if (operation === "codespaces.settings")
      result = { enabled: false, savedForwards: [] };
    else if (operation === "remote.connect") {
      await new Promise((resolve) => setTimeout(resolve, 180));
      if (!allowConnect)
        return route.fulfill({
          json: {
            error: {
              code: "DISCONNECTED",
              message:
                "SSH authentication failed. Unlock your SSH agent or configure a key for this alias.",
            },
          },
        });
      connected = true;
      result = { hostId, state: "ready", generation: "fixture" };
    } else if (operation === "root.open") {
      assert.equal(connected, true, "Root reopened before SSH reconnected");
      if (payload.path === unavailablePath)
        return route.fulfill({
          json: {
            error: {
              code: "ENOENT",
              message: "This folder no longer exists on the remote host.",
            },
          },
        });
      attached.add(payload.path);
      result = { ...payload, state: "ready", connectionError: undefined };
    } else if (operation === "fs.list") {
      assert.ok(
        attached.has(payload.path),
        "Folder listing raced root attachment",
      );
      result = [
        {
          name: "notes.txt",
          path: payload.path + "/notes.txt",
          isFile: true,
          isDirectory: false,
        },
      ];
    } else if (operation === "file.read")
      result = {
        hostId,
        path: payload.path,
        text: revision === "one" ? "original" : "REMOTE CHANGE",
        revision,
      };
    else if (operation === "file.save" || operation === "fs.save")
      throw Error("Reconnect must never save unsaved edits");
    return route.fulfill({ json: { result } });
  });
}
const emit = (page, state, message) =>
  page.evaluate(
    ({ hostId, state, message }) => {
      window.__sshEvents.onmessage({
        data: JSON.stringify({
          event: "host-event",
          payload: {
            type: "connection",
            hostId,
            state,
            ...(message ? { error: { message } } : {}),
          },
        }),
      });
    },
    { hostId, state, message },
  );
const connects = () =>
  calls.filter((call) => call.operation === "remote.connect").length;
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  await prepare(page);
  await page.goto("http://127.0.0.1:1420/");
  await expect(
    page.locator(".tree-name").getByText("notes.txt", { exact: true }),
  ).toHaveCount(2);
  assert.equal(connects(), 1, "Restoring two roots should connect once");
  await expect(page.locator(".cm-content")).toContainText(
    "UNSAVED LOCAL BUFFER",
  );
  connected = false;
  attached.clear();
  allowConnect = false;
  await emit(page, "disconnected", "Connection lost after sleep.");
  await expect(page.getByRole("button", { name: "Reconnect SSH" })).toHaveCount(
    2,
  );
  const count = connects();
  await page.getByRole("button", { name: "Reconnect SSH" }).first().click();
  await expect(page.locator(".tree-error").first()).toContainText(
    "SSH authentication failed",
  );
  assert.equal(
    connects(),
    count + 1,
    "Retry must establish SSH, not merely relist files",
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  for (const width of [1280, 768]) {
    await page.setViewportSize({ width, height: 900 });
    const bounds = await page
      .locator(".tree-error span")
      .first()
      .evaluate((el) => ({
        text: el.getBoundingClientRect().right,
        sidebar: el.closest("aside").getBoundingClientRect().right,
      }));
    assert.ok(
      bounds.text < bounds.sidebar,
      "Reconnect error must wrap inside the sidebar",
    );
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: path.join(evidence, "connection-error.png") });
  allowConnect = true;
  await page.getByRole("button", { name: "Reconnect SSH" }).first().click();
  await expect(page.locator(".tree-error")).toHaveCount(0);
  await expect(
    page.locator(".tree-name").getByText("notes.txt", { exact: true }),
  ).toHaveCount(2);
  await expect(page.locator(".cm-content")).toContainText(
    "UNSAVED LOCAL BUFFER",
  );
  connected = false;
  attached.clear();
  revision = "two";
  await emit(page, "disconnected", "Connection lost after sleep.");
  const beforeFocus = connects();
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("focus"));
  });
  await expect(page.locator(".tree-error")).toHaveCount(0);
  await expect(
    page.locator(".tree-name").getByText("notes.txt", { exact: true }),
  ).toHaveCount(2);
  assert.equal(
    connects(),
    beforeFocus + 1,
    "Repeated window focus shares one reconnect",
  );
  await expect(page.locator(".cm-content")).toContainText(
    "UNSAVED LOCAL BUFFER",
  );
  await expect(page.locator(".conflict-banner")).toContainText(
    "Review before saving",
  );
  await page.screenshot({
    path: path.join(evidence, "reconnected-conflict-preserved.png"),
  });
  // Another window restores its roots when the shared connection comes back.
  const openedBefore = calls.filter((c) => c.operation === "root.open").length;
  await emit(page, "ready");
  await expect
    .poll(() => calls.filter((c) => c.operation === "root.open").length)
    .toBe(openedBefore + 2);
  await expect(
    page.locator(".tree-name").getByText("notes.txt", { exact: true }),
  ).toHaveCount(2);
  unavailablePath = roots[0].path;
  await emit(page, "ready");
  await expect(page.locator(".tree-error")).toContainText(
    "folder no longer exists",
  );
  await expect(
    page.locator(".tree-name").getByText("notes.txt", { exact: true }),
  ).toHaveCount(1);
  unavailablePath = undefined;
  await page.getByRole("button", { name: "Reconnect SSH" }).click();
  await expect(page.locator(".tree-error")).toHaveCount(0);
  await expect(
    page.locator(".tree-name").getByText("notes.txt", { exact: true }),
  ).toHaveCount(2);
  // Opening a new window also reconnects without requiring a tree interaction.
  const other = await browser.newPage();
  const beforeOpen = connects();
  await prepare(other);
  await other.goto("http://127.0.0.1:1420/");
  await expect(
    other.locator(".tree-name").getByText("notes.txt", { exact: true }),
  ).toHaveCount(2);
  assert.equal(connects(), beforeOpen + 1);
  assert.deepEqual(errors, []);
  console.log(
    "SSH reconnect UI passed: restore, retry, focus, shared transport, conflict and unsaved buffer preservation.",
  );
} finally {
  await browser.close();
}
