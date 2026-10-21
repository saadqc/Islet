import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import readline from "node:readline";

async function fixture(t, remote = false) {
  const directory = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "islet-host-lifetime-")),
  );
  const child = spawn(
    process.execPath,
    [path.resolve("remote-helper/host.mjs"), ...(remote ? ["--remote"] : [])],
    {
      env: { ...process.env, ISLET_DATA_DIR: path.join(directory, "data") },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let stderr = "",
    next = 0;
  const pending = new Map();
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.stderr.on("data", (data) => (stderr += data));
  // Disconnects reject pending requests below; never leak a stream error.
  child.stdin.on("error", () => {});
  const reader = readline.createInterface({ input: child.stdout });
  reader.on("line", (line) => {
    const message = JSON.parse(line);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    clearTimeout(waiter.timer);
    message.error
      ? waiter.reject(message.error)
      : waiter.resolve(message.result);
  });
  child.on("exit", () => {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("Helper exited: " + stderr));
    }
    pending.clear();
  });
  t.after(async () => {
    child.kill("SIGCONT");
    child.stdin.end();
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    await exited;
    clearTimeout(timer);
    reader.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  const request = (operation, payload = {}) => {
    const id = ++next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("Helper did not answer " + operation + ": " + stderr));
      }, 5000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, operation, payload }) + "\n");
    });
  };
  assert.equal(await request("ping"), true);
  return { directory, child, request, exited };
}

test(
  "local helper survives a suspended heartbeat lease; remote orphan still expires",
  {
    timeout: 150000,
    skip: process.platform === "win32" && "POSIX suspend signals required",
  },
  async (t) => {
    const local = await fixture(t);
    const remote = await fixture(t, true);
    const file = path.join(local.directory, "main.py");
    await fs.writeFile(file, "value = 1\n");
    const root = await local.request("root.open", {
      path: local.directory,
      clientId: "sleep-window",
    });
    const before = await local.request("file.read", { path: file });
    // Recovery buffers and workspace ownership must survive, too.
    const recovery = {
      roots: [root],
      documents: [{ path: file, text: "value = 2\n", dirty: true }],
    };
    await local.request("session.save", { key: "sleep", value: recovery });
    local.child.kill("SIGSTOP");
    try {
      // Longer than the real two-minute lease, with no heartbeat from the parent.
      await new Promise((resolve) => setTimeout(resolve, 125000));
    } finally {
      local.child.kill("SIGCONT");
    }
    // Let overdue timers run before sending anything that could renew a lease.
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(local.child.exitCode, null, "local helper exited on resume");
    assert.equal(await local.request("ping"), true);
    assert.equal(
      (await local.request("file.read", { path: file })).revision,
      before.revision,
    );
    assert.deepEqual(
      await local.request("session.load", { key: "sleep" }),
      recovery,
    );
    assert.equal(await fs.readFile(file, "utf8"), "value = 1\n");
    await local.request("file.save", {
      path: file,
      text: "value = 2\n",
      expectedRevision: before.revision,
    });
    assert.equal(await fs.readFile(file, "utf8"), "value = 2\n");
    assert.equal(
      remote.child.exitCode,
      0,
      "remote helper must retain orphan cleanup lease",
    );
    assert.ok(
      (await local.request("fs.list", { path: local.directory })).length,
    );
  },
);

test(
  "closing the parent input pipe promptly cleans up the local helper",
  { timeout: 10000 },
  async (t) => {
    const local = await fixture(t);
    local.child.stdin.end();
    await local.exited;
    assert.equal(local.child.exitCode, 0);
  },
);
