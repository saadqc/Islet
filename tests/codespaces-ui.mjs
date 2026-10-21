import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

// All cloud operations in this browser scenario are mocked. The backend suite
// separately exercises the adapter against an isolated, disposable SSH server.
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.ISLET_CHROMIUM || chromium.executablePath(),
  });
  const page = await browser.newPage();
  await page.clock.install();
  const calls = [],
    errors = [],
    roots = [],
    sessions = new Map();
  let settings = { enabled: false, ghPath: "", savedForwards: [] },
    clean = false,
    connected = false,
    state = "Available",
    forwards = [],
    restoreConflict = false;
  const id = "sample-space-123",
    hostId = "codespace:" + id;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/host/request", async (route) => {
    const { operation, payload = {} } = route.request().postDataJSON();
    calls.push({ operation, payload });
    let result = true;
    if (operation === "settings.load") result = {};
    else if (operation === "session.load")
      result = sessions.get(payload.key) || null;
    else if (operation === "session.save")
      sessions.set(payload.key, payload.value);
    else if (
      operation === "session.list" ||
      operation === "app.pendingRequests" ||
      operation === "desktop.terminals"
    )
      result = [];
    else if (operation === "root.open") {
      result = {
        ...payload,
        id: payload.hostId + payload.path,
        label: payload.path.split("/").pop(),
        state: "ready",
      };
      roots.push(result);
    } else if (operation === "fs.list")
      result = payload.browse
        ? [
            {
              path: "/workspaces/sample/subfolder",
              name: "subfolder",
              isDirectory: true,
            },
          ]
        : [];
    else if (operation === "codespaces.settings") result = settings;
    else if (operation === "codespaces.configure") {
      settings = { ...settings, ...payload };
      if (!settings.enabled) {
        connected = false;
        forwards = [];
      }
      result = settings;
    } else if (operation.startsWith("codespaces.")) {
      assert.equal(
        settings.enabled,
        true,
        "Disabled plugin made a cloud operation",
      );
      const action = operation.slice(11);
      if (action === "status")
        result = {
          enabled: true,
          available: true,
          authenticated: true,
          ghPath: "gh",
          loginGuidance: null,
        };
      else if (action === "list")
        result = {
          complete: true,
          items: [
            {
              id,
              hostId,
              displayName: "Sample workspace",
              repository: "example/sample",
              state,
              editorState: connected ? "connected" : "disconnected",
            },
          ],
        };
      else if (action === "forward.list")
        result = { items: forwards, savedForwards: settings.savedForwards };
      else if (action === "discover")
        result = {
          hostId,
          folders: [{ path: "/workspaces/sample", name: "sample" }],
          defaultFolder: "/workspaces/sample",
        };
      else if (action === "connect") {
        if (!payload.approve)
          result = {
            hostId,
            state: "setup-needed",
            probe: {
              os: "Linux",
              arch: "arm64",
              helperInstalled: false,
              cachePath: "~/.cache/islet/remote/<version>",
            },
          };
        else {
          connected = true;
          result = { hostId, state: "ready" };
        }
      } else if (action === "safety")
        result = {
          id,
          hostId,
          token: "fixture-safety",
          expiresAt: Date.now() + 30000,
          clean,
          git: {
            state: clean ? "clean" : "dirty",
            hasUncommittedChanges: !clean,
            hasUnpushedChanges: false,
          },
          buffers: {
            state: clean ? "clean" : "dirty",
            dirtyCount: clean ? 0 : 1,
            pendingTransactions: 0,
            missingWindows: [],
          },
        };
      else if (action === "stop" || action === "delete") {
        assert.equal(payload.confirmId, id);
        assert.equal(payload.safetyToken, "fixture-safety");
        assert.equal(clean, true);
        connected = false;
        state = "Shutdown";
      } else if (action === "start") state = "Available";
      else if (action === "sshCommand")
        result = { command: "gh codespace ssh -c " + id };
      else if (action === "create") assert.equal(payload.confirmCreate, true);
      else if (action === "forward.start") {
        const mapping = {
          ...payload,
          forwardId: "forward-fixture",
          state: "running",
          enabled: true,
          expiresAt: Date.now() + payload.expiresInMinutes * 60000,
        };
        forwards = [mapping];
        if (payload.save) settings.savedForwards = [mapping];
        result = mapping;
      } else if (action === "forward.stop") forwards = [];
      else if (action === "forward.restore") {
        assert.equal(payload.confirm, true);
        result = {
          items: [
            {
              ok: !restoreConflict,
              id,
              localPort: 3100,
              ...(restoreConflict
                ? { error: { message: "Local port is already in use" } }
                : {}),
            },
          ],
        };
      } else if (action === "forward.configure") {
        settings.savedForwards = settings.savedForwards.map((item) =>
          item.id === payload.id && item.localPort === payload.localPort
            ? { ...item, enabled: payload.enabled }
            : item,
        );
        result = settings;
      } else if (action === "forward.forget") settings.savedForwards = [];
      else throw Error("Unexpected Codespaces operation: " + action);
    }
    await route.fulfill({ json: { result } });
  });
  const close = () =>
    page.getByRole("button", { name: "Close dialog", exact: true }).click();
  const openSettings = () => page.locator('button[title="Settings"]').click();
  const count = (operation) =>
    calls.filter((call) => call.operation === operation).length;
  await page.goto("http://127.0.0.1:1420/?root=/fixture/local");
  await page
    .locator(".tree-name")
    .getByText("local", { exact: true })
    .waitFor();
  await openSettings();
  const toggle = page.getByRole("checkbox", {
    name: "GitHub Codespaces",
    exact: true,
  });
  assert.equal(await toggle.isChecked(), false);
  assert.equal(
    await page.getByRole("button", { name: "Manage Codespaces…" }).isDisabled(),
    true,
  );
  await page.clock.fastForward(30000);
  assert.equal(
    calls.filter(
      (call) =>
        call.operation.startsWith("codespaces.") &&
        call.operation !== "codespaces.settings",
    ).length,
    0,
  );
  await toggle.click();
  await expect(toggle).toBeChecked();
  await page.getByRole("button", { name: "Manage Codespaces…" }).click();
  await page
    .getByText("GitHub: Available · Editor: disconnected", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Discover Workspace Folder" }).click();
  await expect(
    page.getByLabel("Absolute folder path", { exact: true }),
  ).toHaveValue("/workspaces/sample");
  await page.getByRole("button", { name: "Add Folder to Workspace" }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "allow versioned helper setup" })
    .waitFor();
  assert.equal(roots.filter((root) => root.hostId === hostId).length, 0);
  await page
    .getByRole("checkbox", {
      name: "Allow versioned helper setup on this Codespace",
    })
    .check();
  await page.getByRole("button", { name: "Add Folder to Workspace" }).click();
  await page
    .getByText("Folder added to this workspace.", { exact: true })
    .waitFor();
  assert.ok(roots.some((root) => root.hostId === "local"));
  assert.ok(
    roots.some(
      (root) => root.hostId === hostId && root.path === "/workspaces/sample",
    ),
  );
  await page
    .getByRole("button", { name: "Browse Folders", exact: true })
    .click();
  await page
    .getByRole("button", { name: "subfolder /workspaces/sample/subfolder" })
    .click();
  await expect(
    page.getByLabel("Absolute folder path", { exact: true }),
  ).toHaveValue("/workspaces/sample/subfolder");
  await page.getByRole("button", { name: "Stop…", exact: true }).click();
  await page.getByText(/Resolve unsaved, uncommitted or unpushed/).waitFor();
  await page.getByLabel("Type the exact Codespace ID").fill(id);
  assert.equal(
    await page
      .getByRole("button", { name: "Stop Codespace", exact: true })
      .isDisabled(),
    true,
  );
  clean = true;
  await page.getByRole("button", { name: "Recheck Safety" }).click();
  await page.getByLabel("Type the exact Codespace ID").fill(id + "wrong");
  assert.equal(
    await page
      .getByRole("button", { name: "Stop Codespace", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByLabel("Type the exact Codespace ID").fill(id);
  await page
    .getByRole("button", { name: "Stop Codespace", exact: true })
    .click();
  await page.getByText("Codespace stopped.", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Start Codespace", exact: true })
    .click();
  await page
    .getByText("GitHub: Available · Editor: disconnected", { exact: true })
    .waitFor();
  await page.getByLabel("Forward type").selectOption("ssh");
  await page.getByLabel("Local port", { exact: true }).fill("3100");
  await page.getByLabel("Remote port", { exact: true }).fill("8080");
  await page.getByLabel("Expires after (minutes)").fill("5");
  await page
    .getByLabel("Destination host inside Codespace")
    .fill("service.internal");
  await page
    .getByRole("checkbox", {
      name: "Save mapping for explicit restoration later",
    })
    .check();
  await page.getByRole("button", { name: "Start Local Forward" }).click();
  await page
    .getByRole("button", { name: "Stop Forward", exact: true })
    .waitFor();
  const mapping = calls.find(
    (call) => call.operation === "codespaces.forward.start",
  ).payload;
  assert.deepEqual(mapping, {
    id,
    mode: "ssh",
    localPort: 3100,
    remotePort: 8080,
    remoteHost: "service.internal",
    expiresInMinutes: 5,
    save: true,
  });
  await page.getByRole("button", { name: "Stop Forward", exact: true }).click();
  const enabledMapping = page.getByRole("checkbox", {
    name: `Enable saved mapping ${id} localhost:3100`,
  });
  await enabledMapping.click();
  await expect(enabledMapping).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Restore Enabled Mappings" }),
  ).toBeDisabled();
  await enabledMapping.click();
  await expect(enabledMapping).toBeChecked();
  restoreConflict = true;
  await page.getByRole("button", { name: "Restore Enabled Mappings" }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Local port is already in use" })
    .waitFor();
  await page.getByRole("button", { name: "Forget Saved Mapping" }).click();
  await page
    .getByRole("button", { name: "Create Codespace…", exact: true })
    .click();
  await page.getByLabel("Repository", { exact: true }).fill("example/sample");
  assert.equal(
    await page
      .getByRole("button", { name: "Create Codespace", exact: true })
      .isDisabled(),
    true,
  );
  await page
    .getByRole("checkbox", {
      name: "Create a new Codespace using my GitHub account’s billing",
    })
    .check();
  await page
    .getByRole("button", { name: "Create Codespace", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Create Codespace", exact: true })
    .waitFor({ state: "hidden" });
  assert.ok(
    (await page.getByRole("listitem").boundingBox()).height > 40,
    "Codespace status row must remain visible in the long manager",
  );
  await page.locator(".codespaces-panel").evaluate((element) => {
    element.scrollTop = 0;
  });
  await fs.mkdir("design/validation", { recursive: true });
  await page.screenshot({ path: "design/validation/codespaces-manager.png" });
  await close();
  await openSettings();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  const cloudCount = calls.filter((call) =>
    call.operation.startsWith("codespaces."),
  ).length;
  await page.clock.fastForward(45000);
  assert.equal(
    calls.filter((call) => call.operation.startsWith("codespaces.")).length,
    cloudCount,
  );
  assert.equal(count("codespaces.stop"), 1);
  assert.equal(count("codespaces.delete"), 0);
  await close();
  await page.reload();
  await openSettings();
  assert.equal(await toggle.isChecked(), false);
  assert.deepEqual(errors, []);
  console.log(
    "PASS Codespaces UI: default-off/persisted disable, helper consent, mixed roots/browse, exact-ID dirty safety, create consent, owned advanced forwards, partial restore errors and no disabled polling (mock cloud)",
  );
} finally {
  await browser?.close();
}
