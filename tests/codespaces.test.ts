import test from "node:test";
import assert from "node:assert/strict";
import { CodespacesClient } from "../src/plugins/codespaces/client";
import type { Request } from "../src/core/bridge";

test("Codespaces stays inert by default and after persisted disable", async () => {
  const calls: string[] = [];
  const client = new CodespacesClient((async (operation: string) => {
    calls.push(operation);
    return { enabled: false, ghPath: "", savedForwards: [] };
  }) as Request);
  assert.deepEqual(calls, []);
  await client.load();
  for (const work of [
    () => client.status(),
    () => client.list(),
    () => client.discover("fixture"),
    () => client.connect("fixture"),
    () => client.forwards(),
    () => client.start("fixture"),
  ]) {
    await assert.rejects(work, /Enable GitHub Codespaces/);
  }
  assert.deepEqual(calls, ["codespaces.settings"]);
});

test("disabling immediately revokes renderer requests and stale in-flight results", async () => {
  let resolveList!: (value: unknown) => void;
  let resolveDisable!: (value: unknown) => void;
  const calls: string[] = [];
  const client = new CodespacesClient((async (operation: string) => {
    calls.push(operation);
    if (operation === "codespaces.list")
      return new Promise((resolve) => {
        resolveList = resolve;
      });
    if (operation === "codespaces.configure")
      return new Promise((resolve) => {
        resolveDisable = resolve;
      });
    throw Error("Unexpected operation");
  }) as Request);
  client.accept({ enabled: true, ghPath: "", savedForwards: [] });
  const listing = client.list();
  const disable = client.configure({ enabled: false });
  assert.equal(client.settings.enabled, false);
  await assert.rejects(() => client.status(), /Enable GitHub Codespaces/);
  resolveList({ items: [], complete: true });
  await assert.rejects(listing, /settings changed/);
  resolveDisable({ enabled: false, ghPath: "", savedForwards: [] });
  await disable;
  assert.deepEqual(calls, ["codespaces.list", "codespaces.configure"]);
});

test("lifecycle IDs and saved forwarding restoration require explicit intent", async () => {
  const calls: { operation: string; payload: any }[] = [];
  const client = new CodespacesClient((async (
    operation: string,
    payload: any,
  ) => {
    calls.push({ operation, payload });
    return { items: [] };
  }) as Request);
  client.accept({
    enabled: true,
    ghPath: "",
    savedForwards: [
      { id: "fixture", mode: "simple", localPort: 3000, remotePort: 3000 },
    ],
  });
  assert.deepEqual(calls, []);
  assert.throws(
    () => client.lifecycle("delete", "fixture", "fixture ", "safe-token"),
    /exact Codespace ID/,
  );
  assert.deepEqual(calls, []);
  await client.lifecycle("stop", "fixture", "fixture", "safe-token");
  await client.restoreForwards();
  assert.deepEqual(calls, [
    {
      operation: "codespaces.stop",
      payload: {
        id: "fixture",
        confirmId: "fixture",
        safetyToken: "safe-token",
      },
    },
    { operation: "codespaces.forward.restore", payload: { confirm: true } },
  ]);
});
