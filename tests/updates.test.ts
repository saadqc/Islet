import test from "node:test";
import assert from "node:assert/strict";
import {
  UpdateClient,
  initialUpdateState,
  restartBlocked,
  updateLabel,
} from "../src/updates/client";
import {
  request,
  setTransport,
  setRestartPending,
  waitForRequests,
} from "../src/core/bridge";

test("update errors preserve verified readiness and can be retried", async () => {
  let calls = 0;
  const client = new UpdateClient(async () => {
    if (++calls === 1) throw Error("A workspace contains unsaved edits.");
    return {
      ...initialUpdateState,
      phase: "installing",
      supported: true,
    } as any;
  });
  client.accept({
    ...initialUpdateState,
    phase: "ready",
    version: "0.2.0",
    supported: true,
  });
  await client.action("install");
  assert.equal(client.state.phase, "ready");
  assert.match(updateLabel(client.state), /unsaved/);
  await client.action("install");
  assert.equal(client.state.phase, "installing");
  assert.equal(client.state.error, undefined);
});

test("restart guards dirty, uncertain and in-flight writes across documents", () => {
  assert.equal(
    restartBlocked([{ dirty: false, saveState: "saved" }], false),
    false,
  );
  for (const doc of [
    { dirty: true, saveState: "pending" },
    { dirty: false, saveState: "uncertain" },
    { dirty: false, saveState: "conflicted" },
    { dirty: false, saveState: "saved", pendingSaveText: "" },
  ])
    assert.equal(restartBlocked([doc], false), true);
  assert.equal(restartBlocked([], true), true);
});

test("restart freezes new host requests and drains in-flight operations before persistence", async () => {
  let finish!: (value: unknown) => void;
  setTransport(async (operation) =>
    operation === "file.read"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : (true as any),
  );
  const loading = request("file.read");
  setRestartPending(true);
  let drained = false;
  const waiting = waitForRequests().then(() => {
    drained = true;
  });
  await assert.rejects(() => request("file.save"), /preparing to restart/);
  assert.equal(await request("session.save"), true);
  assert.equal(await request("updater.acknowledge"), true);
  assert.equal(drained, false);
  finish({ text: "original" });
  await loading;
  await waiting;
  assert.equal(drained, true);
  setRestartPending(false);
  assert.equal(await request("file.save"), true);
});

test("available, downloading and verified updates have distinct readable states", () => {
  assert.match(
    updateLabel({ ...initialUpdateState, phase: "current" }),
    /up to date/,
  );
  assert.match(
    updateLabel({
      ...initialUpdateState,
      phase: "available",
      version: "0.2.0",
    }),
    /0.2.0.*available/,
  );
  assert.match(
    updateLabel({
      ...initialUpdateState,
      phase: "downloading",
      downloaded: 10,
      total: 20,
    }),
    /50%/,
  );
  assert.match(
    updateLabel({ ...initialUpdateState, phase: "ready", version: "0.2.0" }),
    /downloaded and verified/,
  );
});
