import { openFixtureRoots } from "./project-tree-helper.mjs";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

let temporary, browser, page, windowId;
try {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), "islet-interpreter-ui-"));
  const first = path.join(temporary, "first"),
    second = path.join(temporary, "second");
  await fs.mkdir(first);
  await fs.mkdir(second);
  await fs.writeFile(path.join(first, "first.py"), "value = 1\n");
  await fs.writeFile(path.join(second, "second.py"), "value = 2\n");
  const interpreters = [];
  for (const name of ["environment-one", "environment-two"]) {
    const environment = path.join(temporary, name);
    execFileSync(process.env.ISLET_PYTHON || "python3", [
      "-m",
      "venv",
      "--without-pip",
      environment,
    ]);
    interpreters.push(path.join(environment, "bin/python"));
  }
  const manifest = path.join(temporary, "fixture.islet-workspace");
  await fs.writeFile(
    manifest,
    JSON.stringify({
      schemaVersion: 1,
      id: "interpreter-ui",
      name: "Interpreter fixture",
      roots: [
        {
          id: "first-ui",
          hostId: "local",
          path: first,
          label: "First",
          interpreter: interpreters[0],
        },
        {
          id: "second-ui",
          hostId: "local",
          path: second,
          label: "Second",
          interpreter: interpreters[1],
        },
      ],
    }),
  );
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.ISLET_CHROMIUM || chromium.executablePath(),
  });
  page = await browser.newPage();
  const sessions = new Map(),
    starts = [],
    stops = [],
    configurations = [],
    errors = [];
  let initial = true;
  const wait = async (predicate, label) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const value = predicate();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw Error("Timed out waiting for " + label);
  };
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/host/request", async (route) => {
    const { operation, payload } = route.request().postDataJSON();
    if (operation === "app.registerWindow") windowId = payload.windowId;
    if (operation === "settings.load") {
      await route.fulfill({
        json: { result: { interpreter: "/legacy-global-value-not-a-project" } },
      });
      return;
    }
    if (operation === "settings.save" || operation === "session.register") {
      await route.fulfill({ json: { result: true } });
      return;
    }
    if (operation === "session.list") {
      await route.fulfill({ json: { result: [] } });
      return;
    }
    if (operation === "session.save") {
      sessions.set(payload.key, structuredClone(payload.value));
      await route.fulfill({ json: { result: true } });
      return;
    }
    if (operation === "session.load") {
      await route.fulfill({
        json: { result: sessions.get(payload.key) || null },
      });
      return;
    }
    if (operation === "app.pendingRequests") {
      const result = initial
        ? [
            {
              operation: "open",
              workspace: manifest,
              requestId: crypto.randomUUID(),
            },
          ]
        : [];
      initial = false;
      await route.fulfill({ json: { result } });
      return;
    }
    if (operation === "lsp.stop") stops.push(payload.sessionId);
    if (
      operation === "lsp.send" &&
      payload.message.method === "workspace/didChangeConfiguration"
    )
      configurations.push({
        sessionId: payload.sessionId,
        settings: payload.message.params.settings,
      });
    if (operation === "lsp.start") {
      const response = await route.fetch(),
        body = await response.json();
      starts.push({ payload, result: body.result });
      await route.fulfill({ response });
      return;
    }
    await route.continue();
  });
  const open = async (name) => {
    await page.locator(".tree-name").getByText(name, { exact: true }).click();
    await page.locator(".tab.active").filter({ hasText: name }).waitFor();
    await page.locator(".cm-content").waitFor();
  };
  const settings = () =>
    page.locator('.statusbar button[title="Language settings"]').click();
  const selected = () =>
    page.getByLabel("Python interpreter for current project", { exact: true });
  const close = () =>
    page.getByRole("button", { name: "Close dialog", exact: true }).click();
  const snapshot = () =>
    [...sessions.values()].find((value) =>
      value?.roots?.some((root) => root.id === "first-ui"),
    );
  await openFixtureRoots(page);
  await page.goto("http://127.0.0.1:1420/");
  await open("first.py");
  const firstSession = await wait(
    () =>
      starts.find((start) => start.payload.root.id === "first-ui")?.result
        ?.sessionId,
    "first Python service",
  );
  await settings();
  await expect(selected()).toHaveValue(interpreters[0]);
  await close();
  await open("second.py");
  const secondSession = await wait(
    () =>
      starts.find((start) => start.payload.root.id === "second-ui")?.result
        ?.sessionId,
    "second Python service",
  );
  await settings();
  await expect(selected()).toHaveValue(interpreters[1]);
  await close();
  await open("first.py");
  await settings();
  await expect(selected()).toHaveValue(interpreters[0]);
  await selected().fill(interpreters[1]);
  await page
    .getByRole("button", {
      name: "Apply Interpreter and Restart Intelligence",
      exact: true,
    })
    .click();
  const updated = await wait(
    () =>
      starts.find(
        (start) =>
          start.payload.root.id === "first-ui" &&
          start.payload.interpreter === interpreters[1],
      )?.result?.sessionId,
    "replacement interpreter session",
  );
  await wait(
    () =>
      configurations.some(
        (config) =>
          config.sessionId === updated &&
          config.settings.python?.pythonPath === interpreters[1],
      ),
    "new interpreter initialization",
  );
  assert.ok(stops.includes(firstSession));
  assert.ok(!stops.includes(secondSession));
  assert.equal(
    starts.filter((start) => start.payload.root.id === "second-ui").length,
    1,
  );
  await close();
  await page.waitForFunction(
    (expected) =>
      document
        .querySelector(".statusbar button")
        ?.textContent.includes(expected),
    interpreters[1],
  );
  await wait(
    () =>
      snapshot()?.roots.find((root) => root.id === "first-ui")?.interpreter ===
      interpreters[1],
    "persisted updated root",
  );
  await settings();
  await expect(selected()).toHaveValue(interpreters[1]);
  await selected().fill("");
  await page
    .getByRole("button", {
      name: "Apply Interpreter and Restart Intelligence",
      exact: true,
    })
    .click();
  await wait(
    () =>
      snapshot()?.roots.find((root) => root.id === "first-ui")?.interpreter ===
      "",
    "persisted explicit auto reset",
  );
  assert.equal(
    snapshot().roots.find((root) => root.id === "second-ui").interpreter,
    interpreters[1],
  );
  await close();
  await page.waitForFunction(() =>
    document
      .querySelector(".statusbar button")
      ?.textContent.includes("auto-detect"),
  );
  await open("second.py");
  await settings();
  await expect(selected()).toHaveValue(interpreters[1]);
  await close();
  assert.deepEqual(errors, []);
  console.log(
    "PASS current-root interpreter settings/status, real session restart, independent second root, persistence and auto reset",
  );
} finally {
  if (windowId && page)
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
  if (browser) await browser.close();
  if (temporary) await fs.rm(temporary, { recursive: true, force: true });
}
