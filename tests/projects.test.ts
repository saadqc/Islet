import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Host } from "../remote-helper/host.mjs";
import { LanguageManager } from "../src/languages/client";
import { windowTitle } from "../src/workspaces/recents";

test("recent projects persist, deduplicate by host and type, serialize concurrent updates and exclude credentials", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "islet-recents-"));
  const host = new Host({ cli: false, dataDir });
  try {
    await Promise.all(
      Array.from({ length: 24 }, (_, i) =>
        host.request("recents.record", {
          kind: "folder",
          hostId: "local",
          path: "/fixture/" + i,
          password: "never-save",
          privateKey: "never-save",
        }),
      ),
    );
    assert.equal((await host.request("recents.list")).length, 20);
    await host.request("recents.record", {
      kind: "folder",
      hostId: "ssh:fixture",
      path: "/fixture/23",
    });
    await host.request("recents.record", {
      kind: "workspace",
      path: "/fixture/23",
    });
    await host.request("recents.record", {
      kind: "folder",
      hostId: "local",
      path: "/fixture/23/../23",
    });
    const entries = await host.request("recents.list");
    assert.equal(
      entries.filter((e: any) => e.path === "/fixture/23").length,
      3,
    );
    assert.equal(entries[0].hostId, "local");
    assert.ok(!JSON.stringify(entries).includes("never-save"));
    assert.equal(
      (await host.request("recents.get", { id: entries[0].id })).id,
      entries[0].id,
    );
    const other = new Host({ cli: false, dataDir });
    try {
      assert.deepEqual(await other.request("recents.list"), entries);
    } finally {
      await other.close();
    }
    await assert.rejects(host.request("recents.record", { path: "relative" }));
  } finally {
    await host.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("restored SSH editors wait for root attachment before starting scoped language services", async () => {
  const calls: any[] = [];
  const manager = new LanguageManager(async (operation, payload) => {
    calls.push({ operation, payload });
    throw Error("READY_ROOT_REACHED");
  });
  const root = {
    id: "external-manifest-id",
    hostId: "ssh:fixture",
    path: "/srv/project",
    label: "Remote",
    state: "connecting",
  };
  for (const state of ["connecting", "disconnected", "unavailable"]) {
    assert.equal(await manager.ensure({ ...root, state }), undefined);
  }
  assert.deepEqual(calls, []);
  await assert.rejects(
    manager.ensure({ ...root, state: "ready" }),
    /READY_ROOT_REACHED/,
  );
  assert.equal(calls[0].operation, "lsp.start");
  await manager.close();
});

test("Dock window titles use the first folder basename without its full path", () => {
  assert.equal(
    windowTitle(
      [
        {
          id: "a",
          hostId: "ssh:fixture",
          path: "/private/project/backend/",
          label: "Custom label",
        },
      ],
      "Team workspace",
    ),
    "backend",
  );
  assert.equal(windowTitle([], "Workspace"), "Islet");
});
