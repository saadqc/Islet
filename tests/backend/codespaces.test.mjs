import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { Host } from "../../remote-helper/host.mjs";
import { Codespaces, codespaceId } from "../../remote-helper/codespaces.mjs";

const exec = promisify(execFile),
  id = "example-workspace-123",
  provider = "codespace:" + id;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function freePort() {
  const server = net.createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  return port;
}
function child() {
  const proc = new EventEmitter();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.stdin = new PassThrough();
  proc.exitCode = null;
  proc.kill = (signal) => {
    if (proc.exitCode !== null) return false;
    proc.exitCode = signal || "SIGTERM";
    queueMicrotask(() => proc.emit("close", 1));
    return true;
  };
  return proc;
}
async function fixture(t, options = {}) {
  const dir = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "islet-codespaces-")),
    ),
    calls = [],
    events = [];
  const ghPath = path.join(dir, "gh");
  await fs.writeFile(ghPath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const state = {
    value: {
      name: id,
      display_name: "Example workspace",
      repository: { full_name: "example/project" },
      state: "Available",
      git_status: {
        has_uncommitted_changes: false,
        has_unpushed_changes: false,
      },
      recent_folders: ["/workspaces/project"],
    },
    reports: {},
  };
  let host;
  host = new Host({
    dataDir: path.join(dir, "app-data"),
    cli: false,
    codespacesOptions: {
      bufferTimeout: 40,
      readyTimeout: 500,
      ...options,
      spawnProcess:
        options.spawnProcess ||
        ((executable, args, config) => {
          calls.push({ executable, args, config });
          const proc = child();
          queueMicrotask(() => {
            if (options.respond) {
              options.respond(proc, args, state);
              return;
            }
            let value = args.includes("--slurp")
              ? [{ codespaces: [state.value] }]
              : state.value;
            if (args[0] === "auth") value = "";
            proc.stdout.end(
              typeof value === "string" ? value : JSON.stringify(value),
            );
            proc.exitCode = 0;
            proc.emit("close", 0);
          });
          return proc;
        }),
    },
    emit: (name, payload) => {
      events.push({ name, payload });
      if (payload.type === "codespaces-buffer-check")
        for (const [windowId, report] of Object.entries(state.reports))
          queueMicrotask(() =>
            host
              .request("codespaces.buffers", {
                requestId: payload.requestId,
                windowId,
                ...report,
              })
              .catch(() => {}),
          );
    },
  });
  await host.codespaces.ready;
  t.after(async () => {
    await host.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  return {
    dir,
    ghPath,
    host,
    calls,
    events,
    state,
    enable: () =>
      host.request("codespaces.configure", { enabled: true, ghPath }),
  };
}
test("Codespaces is default-off with no CLI, timer, connection or automatic saved-forward restoration", async (t) => {
  const { host, calls, ghPath, events } = await fixture(t);
  assert.deepEqual(await host.request("codespaces.settings"), {
    enabled: false,
    ghPath: "",
    savedForwards: [],
  });
  assert.equal(
    (await host.request("codespaces.status", { refreshAuth: true })).enabled,
    false,
  );
  await host.request("codespaces.configure", { ghPath });
  for (const operation of [
    "list",
    "create",
    "safety",
    "forward.list",
    "sshCommand",
  ])
    await assert.rejects(host.request("codespaces." + operation, { id }), {
      code: "CODESPACES_DISABLED",
    });
  await assert.rejects(
    host.request("root.open", {
      hostId: provider,
      path: "/workspaces/project",
    }),
    { code: "CODESPACES_DISABLED" },
  );
  assert.equal(calls.length, 0);
  assert.equal(host.connections.size, 0);
  assert.equal(host.codespaces.forwards.size, 0);
  assert.ok(events.some((e) => e.payload.type === "codespaces-settings"));
  const remote = await fixture(t, { allowEnable: false });
  await remote.host.engine.saveState("plugins", "codespaces", {
    enabled: true,
    ghPath: remote.ghPath,
    savedForwards: [],
  });
  await assert.rejects(remote.enable(), { code: "CODESPACES_DISABLED" });
  assert.equal(remote.calls.length, 0);
});
test("settings persist only whitelisted plugin fields; list/status use bounded argument-array gh and preserve host IDs", async (t) => {
  const { host, calls, ghPath, state, enable } = await fixture(t);
  await enable();
  await host.request("codespaces.configure", {
    token: "never-store",
    repository: "never-store",
  });
  const saved = await host.engine.loadState("plugins", "codespaces");
  assert.equal(JSON.stringify(saved).includes("never-store"), false);
  const status = await host.request("codespaces.status", { refreshAuth: true });
  assert.equal(status.available, true);
  assert.equal(status.authenticated, true);
  assert.equal(status.ghPath, ghPath);
  const result = await host.request("codespaces.list");
  assert.equal(result.complete, true);
  assert.equal(result.items[0].hostId, provider);
  assert.equal(result.items[0].repository, "example/project");
  assert.equal(result.items[0].git.state, "clean");
  assert.deepEqual(calls.at(-1).args, [
    "api",
    "user/codespaces?per_page=100",
    "--paginate",
    "--slurp",
  ]);
  const command = await host.request("codespaces.sshCommand", { id });
  assert.deepEqual(command.argv, ["codespace", "ssh", "--codespace", id]);
  assert.equal(calls.length, 2);
  const folderCommand = await host.request("codespaces.sshCommand", {
    id,
    path: "/workspaces/project's folder",
  });
  assert.deepEqual(folderCommand.argv.slice(0, 6), [
    "codespace",
    "ssh",
    "--codespace",
    id,
    "--",
    "-t",
  ]);
  assert.match(folderCommand.argv.at(-1), /^cd -- '/);
  assert.ok(folderCommand.argv.at(-1).includes("project'\\''s folder"));
  assert.equal(calls.length, 2);
  await assert.rejects(
    host.request("codespaces.sshCommand", { id, path: "relative" }),
    { code: "INVALID_PATH" },
  );
  await assert.rejects(
    host.request("codespaces.sshCommand", { id, path: "/bad\0folder" }),
    { code: "INVALID_PATH" },
  );
  for (const invalid of [
    "--all",
    "../other",
    "name;touch file",
    "",
    "name\0other",
  ])
    assert.throws(() => codespaceId(invalid));
  state.value.git_status = {};
  assert.equal(
    (await host.request("codespaces.list")).items[0].git.state,
    "unknown",
  );
});
test("create/start are explicit, single-ID operations and never use interactive or shell execution", async (t) => {
  const { host, calls, enable } = await fixture(t);
  await enable();
  await assert.rejects(
    host.request("codespaces.create", { repo: "example/project" }),
    { code: "CODESPACE_CONFIRMATION_REQUIRED" },
  );
  await assert.rejects(
    host.request("codespaces.create", {
      repo: "../project",
      confirmCreate: true,
    }),
    { code: "INVALID_REPOSITORY" },
  );
  await host.request("codespaces.create", {
    repo: "example/project",
    branch: "feature/quoted branch",
    displayName: "Example",
    confirmCreate: true,
  });
  assert.ok(calls.at(-1).args.includes("ref=feature/quoted branch"));
  assert.equal(calls.at(-1).config.shell, undefined);
  await assert.rejects(
    host.request("codespaces.start", { id, confirmId: "different" }),
    { code: "CODESPACE_CONFIRMATION_REQUIRED" },
  );
  await host.request("codespaces.start", { id, confirmId: id });
  assert.deepEqual(calls.at(-1).args, [
    "api",
    "--method",
    "POST",
    `user/codespaces/${id}/start`,
  ]);
});
test("lifecycle checks all windows, exact IDs, fresh Git status, unknown data and one-use safety tokens", async (t) => {
  const { host, calls, state, enable } = await fixture(t);
  await enable();
  await host.request("app.registerWindow", { windowId: "one" });
  await host.request("app.registerWindow", { windowId: "two" });
  state.reports = { one: { dirtyCount: 0 }, two: { dirtyCount: 1 } };
  let safety = await host.request("codespaces.safety", { id });
  assert.equal(safety.clean, false);
  assert.equal(safety.buffers.dirtyCount, 1);
  await assert.rejects(
    host.request("codespaces.delete", {
      id,
      confirmId: id,
      safetyToken: safety.token,
    }),
    { code: "CODESPACE_SAFETY_REQUIRED" },
  );
  delete state.reports.two;
  safety = await host.request("codespaces.safety", { id });
  assert.equal(safety.buffers.state, "unknown");
  assert.deepEqual(safety.buffers.missingWindows, ["two"]);
  state.reports.two = { dirtyCount: 0, pendingTransactions: 1 };
  safety = await host.request("codespaces.safety", { id });
  assert.equal(safety.clean, false);
  state.reports.two = { dirtyCount: 0 };
  safety = await host.request("codespaces.safety", { id });
  assert.equal(safety.clean, true);
  await assert.rejects(
    host.request("codespaces.stop", {
      id,
      confirmId: "wrong",
      safetyToken: safety.token,
    }),
    { code: "CODESPACE_CONFIRMATION_REQUIRED" },
  );
  state.value.git_status.has_unpushed_changes = true;
  await assert.rejects(
    host.request("codespaces.stop", {
      id,
      confirmId: id,
      safetyToken: safety.token,
    }),
    { code: "CODESPACE_UNSAFE" },
  );
  assert.equal(
    calls.some(
      (c) =>
        c.args[0] === "codespace" && ["stop", "delete"].includes(c.args[1]),
    ),
    false,
  );
  state.value.git_status.has_unpushed_changes = false;
  safety = await host.request("codespaces.safety", { id });
  await host.request("codespaces.stop", {
    id,
    confirmId: id,
    safetyToken: safety.token,
  });
  assert.deepEqual(calls.at(-1).args, ["codespace", "stop", "--codespace", id]);
  await assert.rejects(
    host.request("codespaces.delete", {
      id,
      confirmId: id,
      safetyToken: safety.token,
    }),
    { code: "CODESPACE_SAFETY_REQUIRED" },
  );
  state.value.git_status = {};
  assert.equal(
    (await host.request("codespaces.safety", { id })).git.state,
    "unknown",
  );
});
test("stopped Codespaces are never auto-started for discovery, helper setup or a restored root", async (t) => {
  const { host, calls, state, enable } = await fixture(t);
  await enable();
  state.value.state = "Shutdown";
  assert.equal(
    (await host.request("codespaces.discover", { id })).defaultFolder,
    "/workspaces/project",
  );
  await assert.rejects(host.request("remote.probe", { hostId: provider }), {
    code: "CODESPACE_NOT_RUNNING",
  });
  await assert.rejects(
    host.request("root.open", {
      hostId: provider,
      path: "/workspaces/project",
    }),
    { code: "CODESPACE_NOT_RUNNING" },
  );
  assert.ok(calls.every((c) => c.args[0] === "api"));
});
test("GH failures are typed and never echo authentication secrets", async (t) => {
  const f = await fixture(t, {
    respond: (proc) => {
      proc.stderr.end("token ghp_example_secret 401 auth failed");
      proc.emit("close", 1);
    },
  });
  await f.enable();
  await assert.rejects(
    f.host.request("codespaces.list"),
    (error) =>
      error.code === "GH_AUTH_REQUIRED" &&
      !JSON.stringify(error).includes("ghp_example_secret") &&
      !error.message.includes("ghp_example_secret"),
  );
  assert.equal(
    (await f.host.request("codespaces.status", { refreshAuth: true }))
      .authenticated,
    false,
  );
});
test("bounded GH requests time out and disable cancels in-flight owned requests", async (t) => {
  const f = await fixture(t, { respond: () => {} });
  await f.enable();
  await assert.rejects(f.host.codespaces.run(["api", "fixture"], 20), {
    code: "GH_TIMEOUT",
  });
  const pending = f.host.request("codespaces.list");
  const rejected = assert.rejects(pending, { code: "CODESPACES_DISABLED" });
  for (let n = 0; n < 20 && !f.calls.length; n++) await pause(5);
  await pause(5);
  await f.host.request("codespaces.configure", { enabled: false });
  await rejected;
  assert.equal(f.host.codespaces.children.size, 0);
});
test("Codespace SSH failures never expose raw GH stderr or credentials", async (t) => {
  const f = await fixture(t, {
    respond: (proc, args, state) => {
      if (args[0] === "api") {
        proc.stdout.end(JSON.stringify(state.value));
        proc.emit("close", 0);
      } else {
        proc.stderr.end("authentication token ghp_example_secret failed");
        proc.emit("exit", 1);
        proc.emit("close", 1);
      }
    },
  });
  await f.enable();
  await assert.rejects(
    f.host.request("remote.probe", { hostId: provider }),
    (error) =>
      error.code === "GH_AUTH_REQUIRED" &&
      !error.message.includes("ghp_example_secret") &&
      error.details === undefined,
  );
});
test("owned forwards reject busy ports, expire and restore only after explicit approval; disable keeps remote cloud state untouched", async (t) => {
  const servers = [];
  const f = await fixture(t, {
    respond: (proc, args, state) => {
      if (args[0] === "api") {
        proc.stdout.end(JSON.stringify(state.value));
        proc.emit("close", 0);
        return;
      }
      const server = net.createServer((socket) => {
        socket.on("error", () => {});
        socket.end("forwarded");
      });
      servers.push(server);
      const localPort =
        args[1] === "ports"
          ? Number(args[3].split(":")[1])
          : Number(args.at(-1).split(":")[1]);
      proc.kill = () => {
        server.close();
        queueMicrotask(() => proc.emit("close", 1));
        return true;
      };
      server.listen(localPort, "127.0.0.1");
    },
  });
  t.after(() => {
    for (const server of servers) server.close();
  });
  await f.enable();
  const busy = net.createServer();
  await new Promise((r) => busy.listen(0, "127.0.0.1", r));
  t.after(() => busy.close());
  await assert.rejects(
    f.host.request("codespaces.forward.start", {
      id,
      localPort: busy.address().port,
      remotePort: 3000,
    }),
    { code: "PORT_IN_USE" },
  );
  assert.equal(busy.listening, true);
  const localPort = await freePort();
  const forward = await f.host.request("codespaces.forward.start", {
    id,
    localPort,
    remotePort: 3000,
    expiresInMinutes: 1,
    save: true,
  });
  assert.equal(forward.state, "ready");
  assert.equal(forward.enabled, true);
  assert.equal(
    (await f.host.request("codespaces.settings")).savedForwards[0].enabled,
    true,
  );
  assert.deepEqual(f.calls.at(-1).args, [
    "codespace",
    "ports",
    "forward",
    `3000:${localPort}`,
    "--codespace",
    id,
  ]);
  await assert.rejects(f.host.request("codespaces.forward.restore"), {
    code: "FORWARD_RESTORE_CONFIRMATION_REQUIRED",
  });
  f.host.codespaces.forwards.get(forward.forwardId).timer._onTimeout();
  await pause(10);
  assert.equal(f.host.codespaces.forwards.size, 0);
  const restored = await f.host.request("codespaces.forward.restore", {
    confirm: true,
  });
  assert.equal(restored.items[0].ok, true);
  await f.host.request("codespaces.configure", { enabled: false });
  await pause(10);
  assert.equal(f.host.codespaces.forwards.size, 0);
  assert.equal(f.host.connections.size, 0);
  assert.equal(
    f.calls.some((c) => ["stop", "delete"].includes(c.args[1])),
    false,
  );
  const callCount = f.calls.length;
  await f.host.request("codespaces.status", { refreshAuth: true });
  assert.equal(f.calls.length, callCount);
  assert.equal(
    (await f.host.request("codespaces.settings")).savedForwards.length,
    1,
  );
});
test("saved forward restore honors explicit enabled flags and treats legacy mappings as disabled", async (t) => {
  const f = await fixture(t);
  await f.enable();
  const savedForwards = [
    { id, mode: "simple", localPort: 31001, remotePort: 3000, enabled: true },
    { id, mode: "simple", localPort: 31002, remotePort: 3001, enabled: false },
    { id, mode: "simple", localPort: 31003, remotePort: 3002 },
  ];
  await f.host.engine.saveState("plugins", "codespaces", {
    enabled: true,
    ghPath: f.ghPath,
    savedForwards,
  });
  const previous = f.host.codespaces;
  await previous.close();
  f.host.codespaces = new Codespaces(f.host, {
    spawnProcess: previous.spawnProcess,
  });
  await f.host.codespaces.ready;
  const settings = await f.host.request("codespaces.settings");
  assert.deepEqual(
    settings.savedForwards.map((f) => f.enabled),
    [true, false, false],
  );
  assert.equal(f.calls.length, 0);
  const restored = [];
  f.host.codespaces.startForward = async (mapping, options) => {
    assert.equal(options.restoring, true);
    restored.push(mapping.localPort);
    return { ...mapping, forwardId: "fixture" };
  };
  assert.equal(
    (await f.host.request("codespaces.forward.restore", { confirm: true }))
      .items.length,
    1,
  );
  assert.deepEqual(restored, [31001]);
  const changed = await f.host.request("codespaces.forward.configure", {
    id,
    localPort: 31001,
    enabled: false,
  });
  assert.equal(changed.savedForwards[0].enabled, false);
  assert.equal(
    (await f.host.request("codespaces.forward.restore", { confirm: true }))
      .items.length,
    0,
  );
  assert.deepEqual(restored, [31001]);
  await f.host.request("codespaces.forward.configure", {
    id,
    localPort: 31003,
    enabled: true,
  });
  await f.host.request("codespaces.forward.restore", { confirm: true });
  assert.deepEqual(restored, [31001, 31003]);
  const persisted = await f.host.engine.loadState("plugins", "codespaces");
  assert.deepEqual(
    persisted.savedForwards.map((f) => f.enabled),
    [false, false, true],
  );
  assert.ok(
    f.events.some(
      (e) =>
        e.payload.type === "codespaces-settings" &&
        e.payload.settings.savedForwards[2]?.enabled === true,
    ),
  );
  for (const enabled of [undefined, null, "false", 0, 1])
    await assert.rejects(
      f.host.request("codespaces.forward.configure", {
        id,
        localPort: 31003,
        enabled,
      }),
      { code: "INVALID_FORWARD" },
    );
  assert.throws(
    () => f.host.codespaces.mapping({ ...savedForwards[0], enabled: "true" }),
    { code: "INVALID_FORWARD" },
  );
  await assert.rejects(
    f.host.request("codespaces.forward.configure", {
      id,
      localPort: 31004,
      enabled: true,
    }),
    { code: "FORWARD_NOT_FOUND" },
  );
  assert.equal(f.calls.length, 0);
});
test("disabling a saved forward during restore prevents its owned process from starting", async (t) => {
  const f = await fixture(t);
  await f.enable();
  const localPort = await freePort();
  f.host.codespaces.settings.savedForwards = [
    f.host.codespaces.mapping({
      id,
      localPort,
      remotePort: 3000,
      enabled: true,
    }),
  ];
  let release, entered;
  const inspected = new Promise((resolve) => (entered = resolve));
  f.host.codespaces.ensureTransport = async () => {
    entered();
    await new Promise((resolve) => (release = resolve));
  };
  const restoring = f.host.request("codespaces.forward.restore", {
    confirm: true,
  });
  await inspected;
  await f.host.request("codespaces.forward.configure", {
    id,
    localPort,
    enabled: false,
  });
  release();
  const result = await restoring;
  assert.equal(result.items[0].ok, false);
  assert.equal(result.items[0].error.code, "FORWARD_DISABLED");
  assert.equal(f.calls.length, 0);
  assert.equal(f.host.codespaces.forwards.size, 0);
});
test(
  "gh SSH adapter uses isolated real OpenSSH for files, language services, reconnect and both forwarding modes",
  { timeout: 60000 },
  async (t) => {
    try {
      await fs.access("/usr/sbin/sshd");
    } catch {
      t.skip("This host has no local sshd; mock provider tests still run.");
      return;
    }
    const dir = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "islet-codespaces-ssh-")),
    );
    let daemon, host;
    t.after(async () => {
      if (host) await host.close();
      if (daemon) {
        daemon.kill("SIGTERM");
        await new Promise((resolve) => {
          if (daemon.exitCode !== null) return resolve();
          daemon.once("exit", resolve);
        });
      }
      await fs.rm(dir, { recursive: true, force: true });
    });
    const sshPort = await freePort();
    for (const name of ["host-key", "client-key"])
      await exec("/usr/bin/ssh-keygen", [
        "-q",
        "-t",
        "ed25519",
        "-N",
        "",
        "-f",
        path.join(dir, name),
      ]);
    await fs.copyFile(
      path.join(dir, "client-key.pub"),
      path.join(dir, "authorized_keys"),
    );
    const user = os.userInfo().username;
    await fs.writeFile(
      path.join(dir, "sshd_config"),
      `Port ${sshPort}\nListenAddress 127.0.0.1\nHostKey ${dir}/host-key\nPidFile ${dir}/sshd.pid\nAuthorizedKeysFile ${dir}/authorized_keys\nStrictModes no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nUsePAM no\nAllowUsers ${user}\nLogLevel ERROR\n`,
    );
    let sshError = "";
    daemon = spawn(
      "/usr/sbin/sshd",
      ["-D", "-e", "-f", path.join(dir, "sshd_config")],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    daemon.stderr.on("data", (data) => (sshError += data));
    for (let n = 0; n < 30; n++) {
      if (daemon.exitCode !== null)
        throw new Error("Isolated SSH server could not start: " + sshError);
      try {
        await new Promise((resolve, reject) => {
          const socket = net.connect(sshPort, "127.0.0.1", () => {
            socket.destroy();
            resolve();
          });
          socket.once("error", reject);
        });
        break;
      } catch {
        await pause(50);
      }
    }
    const pub = (
      await fs.readFile(path.join(dir, "host-key.pub"), "utf8")
    ).trim();
    await fs.writeFile(
      path.join(dir, "known_hosts"),
      `[127.0.0.1]:${sshPort} ${pub}\n`,
    );
    const config = path.join(dir, "ssh_config");
    await fs.writeFile(
      config,
      `Host isolated\n HostName 127.0.0.1\n Port ${sshPort}\n User ${user}\n IdentityFile ${dir}/client-key\n IdentitiesOnly yes\n UserKnownHostsFile ${dir}/known_hosts\n StrictHostKeyChecking yes\n`,
    );
    const ghPath = path.join(dir, "gh"),
      project = path.join(dir, "project with spaces"),
      helper = path.resolve(import.meta.dirname, "../../remote-helper");
    await fs.mkdir(project);
    const view = {
      name: id,
      state: "Available",
      repository: { full_name: "example/project" },
      git_status: {
        has_uncommitted_changes: false,
        has_unpushed_changes: false,
      },
      recent_folders: [project],
    };
    const fake = `#!${process.execPath}\nimport {spawn} from 'node:child_process';\nconst args=process.argv.slice(2);\nif(args[0]==='api'){console.log(JSON.stringify(${JSON.stringify(view)}));process.exit(0);}\nif(args[0]!=='codespace'||!['ssh','ports'].includes(args[1]))throw new Error('Real cloud lifecycle commands forbidden in fixture');\nlet ssh=[];\nif(args[1]==='ports'){const [remote,local]=args[3].split(':');ssh=['-N','-T','-o','ExitOnForwardFailure=yes','-L','127.0.0.1:'+local+':127.0.0.1:'+remote,'isolated'];}\nelse{ssh=args.slice(args.indexOf('--')+1);if(ssh.includes('-N'))ssh.push('isolated');else{const command=ssh.pop();ssh.push('isolated',"ISLET_DATA_DIR="+${JSON.stringify("'" + path.join(dir, "remote-data").replace(/'/g, "'\\''") + "'")}+' '+command);}}\nconst child=spawn('/usr/bin/ssh',['-F',${JSON.stringify(config)},...ssh],{stdio:'inherit'});child.on('exit',(code)=>process.exit(code??1));\n`;
    await fs.writeFile(ghPath, fake, { mode: 0o755 });
    host = new Host({ dataDir: path.join(dir, "local-data"), cli: false });
    await host.request("codespaces.configure", { enabled: true, ghPath });
    assert.equal(
      (
        await host.request("codespaces.connect", {
          id,
          helperPath: helper,
          systemNode: process.execPath,
        })
      ).state,
      "ready",
    );
    const remote = await host.request("root.open", {
      hostId: provider,
      path: project,
      clientId: "fixture",
    });
    const local = await host.request("root.open", {
      hostId: "local",
      path: project,
      clientId: "fixture",
    });
    assert.notEqual(remote.id, local.id);
    const file = path.join(project, "main.py");
    await fs.writeFile(file, "def greeting():\n    return 'needle'\n");
    const read = await host.request("fs.read", {
      hostId: provider,
      path: file,
    });
    await host.request("fs.save", {
      hostId: provider,
      path: file,
      text: read.text + "answer = greeting()\n",
      expectedRevision: read.revision,
    });
    const search = await host.request("search.start", {
      roots: [remote, local],
      query: "needle",
      requestId: "codespace-local-search",
    });
    assert.equal(search.complete, true);
    assert.deepEqual(
      new Set(search.results.map((r) => r.hostId)),
      new Set([provider, "local"]),
    );
    const language = await host.request("lsp.start", {
      root: remote,
      language: "python",
      clientId: "fixture",
    });
    const initialized = await host.request("lsp.request", {
      sessionId: language.sessionId,
      method: "initialize",
      params: {
        processId: null,
        rootUri: pathToFileURL(project).href,
        capabilities: {},
        workspaceFolders: [
          { uri: pathToFileURL(project).href, name: "Example" },
        ],
      },
    });
    assert.ok(initialized.capabilities.definitionProvider);
    await host.request("lsp.stop", { sessionId: language.sessionId });
    await host.request("remote.disconnect", { hostId: provider });
    await host.request("root.open", {
      hostId: provider,
      path: project,
      clientId: "fixture",
    });
    assert.equal(
      (
        await host.request("fs.read", { hostId: provider, path: file })
      ).text.includes("answer"),
      true,
    );
    const echo = net.createServer((socket) => {
      socket.on("error", () => {});
      socket.on("data", (data) => socket.write(data));
    });
    await new Promise((r) => echo.listen(0, "127.0.0.1", r));
    t.after(() => echo.close());
    for (const mode of ["simple", "ssh"]) {
      const localPort = await freePort();
      const forward = await host.request("codespaces.forward.start", {
        id,
        mode,
        localPort,
        remoteHost: "127.0.0.1",
        remotePort: echo.address().port,
        expiresInMinutes: 1,
      });
      assert.equal(forward.state, "ready");
      const text = await new Promise((resolve, reject) => {
        const socket = net.connect(localPort, "127.0.0.1", () =>
          socket.write("actual SSH forwarding"),
        );
        socket.once("data", (data) => {
          socket.destroy();
          resolve(data.toString());
        });
        socket.once("error", reject);
        socket.setTimeout(3000, () => {
          socket.destroy();
          reject(new Error("Forward echo timed out"));
        });
      });
      assert.equal(text, "actual SSH forwarding");
      await host.request("codespaces.forward.stop", {
        forwardId: forward.forwardId,
      });
    }
    await host.request("codespaces.configure", { enabled: false });
    assert.equal(host.connections.size, 0);
    assert.equal(host.codespaces.forwards.size, 0);
  },
);
