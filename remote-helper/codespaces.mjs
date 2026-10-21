import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import net from "node:net";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

const fail = (code, message) => {
  throw Object.assign(new Error(message), { code });
};
export function codespaceId(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9-]{0,119}$/.test(value)
  )
    fail("INVALID_CODESPACE", "Select an exact Codespace ID.");
  return value;
}
const hostId = (id) => "codespace:" + codespaceId(id);
const quote = (value) => "'" + String(value).replace(/'/g, "'\\''") + "'";
export function codespaceTransportError(stderr) {
  return /auth|login|token|401|403/i.test(stderr)
    ? {
        code: "GH_AUTH_REQUIRED",
        message: "Sign in with gh auth login and authorize Codespaces access.",
      }
    : {
        code: "CODESPACE_SSH_FAILED",
        message:
          "Codespace SSH failed. Check that it is running and its devcontainer provides an SSH server.",
      };
}
const port = (value) => {
  if (
    !Number.isInteger(Number(value)) ||
    Number(value) < 1 ||
    Number(value) > 65535
  )
    fail("INVALID_PORT", "Ports must be integers from 1 through 65535.");
  return Number(value);
};
function gitState(status) {
  const dirty =
    status?.hasUncommittedChanges ?? status?.has_uncommitted_changes;
  const unpushed = status?.hasUnpushedChanges ?? status?.has_unpushed_changes;
  return {
    state:
      dirty === true || unpushed === true
        ? "dirty"
        : dirty === false && unpushed === false
          ? "clean"
          : "unknown",
    hasUncommittedChanges: typeof dirty === "boolean" ? dirty : null,
    hasUnpushedChanges: typeof unpushed === "boolean" ? unpushed : null,
  };
}
function item(value, connections) {
  const id = codespaceId(value.name || value.id);
  return {
    id,
    hostId: hostId(id),
    displayName: String(value.displayName || value.display_name || id),
    repository: String(
      value.repository?.fullName || value.repository?.full_name || "",
    ),
    state: String(value.state || "Unknown"),
    git: gitState(value.gitStatus || value.git_status),
    editorState: connections.has(hostId(id)) ? "connected" : "disconnected",
  };
}
export class Codespaces {
  constructor(
    host,
    {
      spawnProcess = spawn,
      bufferTimeout = 3000,
      readyTimeout = 10000,
      allowEnable = true,
    } = {},
  ) {
    this.host = host;
    this.allowEnable = allowEnable;
    this.spawnProcess = spawnProcess;
    this.bufferTimeout = bufferTimeout;
    this.readyTimeout = readyTimeout;
    this.settings = { enabled: false, ghPath: "", savedForwards: [] };
    this.children = new Set();
    this.forwards = new Map();
    this.bufferChecks = new Map();
    this.snapshots = new Map();
    this.epoch = 0;
    this.settingsQueue = Promise.resolve();
    this.ready = this.load().catch(() => {
      this.settings = { enabled: false, ghPath: "", savedForwards: [] };
      this.loadError =
        "Codespaces settings could not be read. The plugin remains disabled.";
    });
  }
  async load() {
    if (!this.allowEnable) return;
    const saved = await this.host.engine.loadState("plugins", "codespaces");
    if (saved)
      this.settings = {
        enabled: saved.enabled === true,
        ghPath: typeof saved.ghPath === "string" ? saved.ghPath : "",
        savedForwards: Array.isArray(saved.savedForwards)
          ? saved.savedForwards.map((f) => this.mapping(f))
          : [],
      };
  }
  assertEnabled() {
    if (!this.settings.enabled)
      fail(
        "CODESPACES_DISABLED",
        "Enable the Codespaces plugin in Settings first.",
      );
  }
  async enabled() {
    await this.ready;
    this.assertEnabled();
  }
  async save() {
    await this.host.engine.saveState("plugins", "codespaces", this.settings);
  }
  async gh() {
    await this.enabled();
    if (this.executable) return this.executable;
    const candidates = this.settings.ghPath
      ? [this.settings.ghPath]
      : [
          ...(process.env.PATH || "")
            .split(path.delimiter)
            .filter(Boolean)
            .map((p) => path.join(p, "gh")),
          "/opt/homebrew/bin/gh",
          "/usr/local/bin/gh",
          "/usr/bin/gh",
        ];
    for (const candidate of candidates) {
      if (!path.isAbsolute(candidate) || candidate.includes("\0")) continue;
      try {
        if (!(await fs.stat(candidate)).isFile()) continue;
        await fs.access(candidate, fsSync.constants.X_OK);
        this.assertEnabled();
        return (this.executable = candidate);
      } catch {}
    }
    fail(
      "GH_NOT_FOUND",
      "Install GitHub CLI, or choose its executable in Codespaces Settings.",
    );
  }
  environment() {
    return {
      ...process.env,
      GH_PROMPT_DISABLED: "1",
      GH_HOST: "github.com",
      GH_PAGER: "cat",
      PAGER: "cat",
      GH_BROWSER: "false",
      GH_NO_UPDATE_NOTIFIER: "1",
    };
  }
  own(child) {
    if (process.platform !== "win32" && Number.isInteger(child.pid)) {
      const kill = child.kill.bind(child);
      child.kill = (signal = "SIGTERM") => {
        try {
          process.kill(-child.pid, signal);
          return true;
        } catch {
          return kill(signal);
        }
      };
    }
    this.children.add(child);
    child.once("close", () => this.children.delete(child));
    child.once("error", () => this.children.delete(child));
    return child;
  }
  async run(args, timeout = 30000) {
    const executable = await this.gh();
    this.assertEnabled();
    return new Promise((resolve, reject) => {
      const child = this.own(
        this.spawnProcess(executable, args, {
          detached: process.platform !== "win32",
          stdio: ["ignore", "pipe", "pipe"],
          env: this.environment(),
        }),
      );
      let stdout = "",
        stderr = "",
        settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        error ? reject(error) : resolve(value);
      };
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        const force = setTimeout(() => child.kill("SIGKILL"), 1000);
        force.unref();
        finish(
          Object.assign(new Error("GitHub CLI request timed out."), {
            code: "GH_TIMEOUT",
          }),
        );
      }, timeout);
      child.stdout?.on("data", (data) => {
        stdout += data;
        if (Buffer.byteLength(stdout) > 4 * 1024 * 1024) {
          child.kill();
          finish(
            Object.assign(
              new Error(
                "GitHub CLI response exceeded its limit; no partial result was used.",
              ),
              { code: "GH_RESPONSE_LIMIT" },
            ),
          );
        }
      });
      child.stderr?.on("data", (data) => {
        stderr = (stderr + data).slice(-8000);
      });
      child.once("error", () =>
        finish(
          Object.assign(new Error("Could not launch GitHub CLI."), {
            code: "GH_NOT_FOUND",
          }),
        ),
      );
      child.once("close", (code) => {
        if (!this.settings.enabled)
          return finish(
            Object.assign(new Error("Codespaces plugin was disabled."), {
              code: "CODESPACES_DISABLED",
            }),
          );
        if (code !== 0)
          return finish(
            Object.assign(
              new Error(
                /auth|login|token|401|403/i.test(stderr)
                  ? "Sign in with gh auth login and authorize Codespaces access."
                  : "GitHub CLI request failed. Check access, availability and the selected Codespace.",
              ),
              {
                code: /auth|login|token|401|403/i.test(stderr)
                  ? "GH_AUTH_REQUIRED"
                  : "GH_REQUEST_FAILED",
              },
            ),
          );
        finish(null, stdout);
      });
    });
  }
  async json(args, timeout) {
    const text = await this.run(args, timeout);
    try {
      return JSON.parse(text);
    } catch {
      fail("GH_INVALID_RESPONSE", "GitHub CLI returned an invalid response.");
    }
  }
  async view(id) {
    const exactId = codespaceId(id);
    const value = await this.json(["api", "user/codespaces/" + exactId]);
    if (value?.name !== exactId)
      fail(
        "GH_INVALID_RESPONSE",
        "GitHub returned a different Codespace identity.",
      );
    return value;
  }
  async ensureTransport(id) {
    await this.enabled();
    const value = await this.view(id);
    if (String(value.state).toLowerCase() !== "available")
      fail(
        "CODESPACE_NOT_RUNNING",
        "Start this Codespace explicitly before connecting. Inspection does not start stopped Codespaces.",
      );
    await this.gh();
  }
  config(p) {
    this.assertEnabled();
    const id = codespaceId(
      p.codespaceId || String(p.hostId || "").slice("codespace:".length),
    );
    return {
      hostId: hostId(id),
      target: id,
      codespaceId: id,
      ghPath: this.executable,
      helperPath: p.helperPath,
      systemNode: p.systemNode,
      interactive: false,
    };
  }
  spawnSsh(config, command, options = {}) {
    this.assertEnabled();
    const args = [
      "codespace",
      "ssh",
      "--codespace",
      codespaceId(config.codespaceId),
      "--",
      "-T",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "-o",
      "ServerAliveInterval=10",
      "-o",
      "ServerAliveCountMax=2",
      command,
    ];
    return this.own(
      this.spawnProcess(config.ghPath || this.executable, args, {
        ...options,
        detached: process.platform !== "win32",
        env: this.environment(),
      }),
    );
  }
  async configure(p) {
    await this.ready;
    if (!this.allowEnable)
      fail(
        "CODESPACES_DISABLED",
        "Codespaces is a desktop plugin and cannot be enabled in the remote helper.",
      );
    if (
      p.ghPath !== undefined &&
      (typeof p.ghPath !== "string" ||
        p.ghPath.includes("\0") ||
        (p.ghPath && !path.isAbsolute(p.ghPath)))
    )
      fail(
        "INVALID_GH_PATH",
        "Choose an absolute GitHub CLI executable path, or leave it blank for automatic detection.",
      );
    if (p.enabled !== undefined && typeof p.enabled !== "boolean")
      fail("INVALID_SETTINGS", "Enabled must be a boolean.");
    const disabling = p.enabled === false;
    this.settings = {
      ...this.settings,
      ...(p.ghPath === undefined ? {} : { ghPath: p.ghPath }),
      ...(p.enabled === undefined ? {} : { enabled: p.enabled }),
    };
    this.executable = null;
    this.epoch++;
    if (disabling) await this.close();
    await this.save();
    this.host.emit("host-event", {
      type: "codespaces-settings",
      settings: this.settings,
    });
    return this.settings;
  }
  async status(p) {
    await this.ready;
    if (!this.settings.enabled)
      return {
        enabled: false,
        available: false,
        authenticated: null,
        ghPath: this.settings.ghPath,
        loginGuidance: null,
      };
    let executable;
    try {
      executable = await this.gh();
    } catch (error) {
      if (error.code !== "GH_NOT_FOUND") throw error;
      return {
        enabled: true,
        available: false,
        authenticated: null,
        ghPath: this.settings.ghPath,
        loginGuidance: error.message,
      };
    }
    let authenticated = null;
    if (p.refreshAuth) {
      try {
        await this.run(["auth", "status", "--hostname", "github.com"], 15000);
        authenticated = true;
      } catch (error) {
        if (
          error.code !== "GH_AUTH_REQUIRED" &&
          error.code !== "GH_REQUEST_FAILED"
        )
          throw error;
        authenticated = false;
      }
    }
    return {
      enabled: true,
      available: true,
      authenticated,
      ghPath: executable,
      loginGuidance:
        authenticated === false
          ? "Run gh auth login and authorize Codespaces access, then refresh."
          : null,
    };
  }
  async list() {
    const pages = await this.json(
      ["api", "user/codespaces?per_page=100", "--paginate", "--slurp"],
      60000,
    );
    const rows = (Array.isArray(pages) ? pages : [pages]).flatMap(
      (page) => page.codespaces || [],
    );
    return {
      items: rows.map((value) => item(value, this.host.connections)),
      complete: true,
    };
  }
  async buffers(id) {
    const requestId = crypto.randomUUID(),
      expected = new Set([...this.host.windows.values()].map((w) => w.id));
    if (!expected.size)
      return {
        state: "clean",
        dirtyCount: 0,
        pendingTransactions: 0,
        missingWindows: [],
      };
    return new Promise((resolve) => {
      const reports = new Map();
      const finish = () => {
        clearTimeout(timer);
        this.bufferChecks.delete(requestId);
        const missingWindows = [...expected].filter((w) => !reports.has(w));
        const dirtyCount = [...reports.values()].reduce(
          (a, r) => a + r.dirtyCount,
          0,
        );
        const pendingTransactions = [...reports.values()].reduce(
          (a, r) => a + r.pendingTransactions,
          0,
        );
        resolve({
          state: missingWindows.length
            ? "unknown"
            : dirtyCount || pendingTransactions
              ? "dirty"
              : "clean",
          dirtyCount,
          pendingTransactions,
          missingWindows,
        });
      };
      const timer = setTimeout(finish, this.bufferTimeout);
      this.bufferChecks.set(requestId, { expected, reports, finish });
      this.host.emit("host-event", {
        type: "codespaces-buffer-check",
        requestId,
        hostId: hostId(id),
      });
    });
  }
  report(p) {
    const check = this.bufferChecks.get(p.requestId);
    if (!check || !check.expected.has(p.windowId)) return false;
    if (
      !Number.isInteger(p.dirtyCount) ||
      p.dirtyCount < 0 ||
      (p.pendingTransactions !== undefined &&
        (!Number.isInteger(p.pendingTransactions) || p.pendingTransactions < 0))
    )
      fail("INVALID_BUFFER_REPORT", "Invalid editor buffer check response.");
    check.reports.set(p.windowId, {
      dirtyCount: p.dirtyCount,
      pendingTransactions: p.pendingTransactions || 0,
    });
    if (check.reports.size === check.expected.size) check.finish();
    return true;
  }
  async safety(id) {
    const value = await this.view(id),
      git = gitState(value.git_status || value.gitStatus),
      buffers = await this.buffers(id);
    const snapshot = {
      id,
      hostId: hostId(id),
      token: crypto.randomUUID(),
      expiresAt: Date.now() + 30000,
      clean: git.state === "clean" && buffers.state === "clean",
      git,
      buffers,
    };
    for (const [token, old] of this.snapshots)
      if (old.expiresAt < Date.now()) this.snapshots.delete(token);
    this.snapshots.set(snapshot.token, snapshot);
    return snapshot;
  }
  async lifecycle(action, p) {
    const id = codespaceId(p.id);
    if (p.confirmId !== id)
      fail(
        "CODESPACE_CONFIRMATION_REQUIRED",
        "Submit the exact Codespace ID to confirm this action.",
      );
    if (action === "start")
      return item(
        await this.json(
          ["api", "--method", "POST", `user/codespaces/${id}/start`],
          60000,
        ),
        this.host.connections,
      );
    const previous = this.snapshots.get(p.safetyToken);
    this.snapshots.delete(p.safetyToken);
    if (
      !previous ||
      previous.id !== id ||
      previous.expiresAt < Date.now() ||
      !previous.clean
    )
      fail(
        "CODESPACE_SAFETY_REQUIRED",
        "A recent, clean Git and all-window buffer safety check is required.",
      );
    const fresh = await this.safety(id);
    this.snapshots.delete(fresh.token);
    if (!fresh.clean)
      fail(
        "CODESPACE_UNSAFE",
        "Codespace has unsaved, uncommitted, unpushed, or unknown work. Resolve it before stopping or deleting.",
      );
    await this.run(["codespace", action, "--codespace", id], 60000);
    await this.disconnect(id);
    return {
      id,
      hostId: hostId(id),
      state: action === "stop" ? "Shutdown" : "Deleted",
    };
  }
  async discover(id) {
    const value = await this.view(id);
    let paths = (value.recentFolders || value.recent_folders || []).filter(
      (p) =>
        typeof p === "string" && path.posix.isAbsolute(p) && !p.includes("\0"),
    );
    if (!paths.length && String(value.state).toLowerCase() === "available") {
      const config = this.config({ hostId: hostId(id) });
      const code =
        "import os,json; p='/workspaces'; print(json.dumps([os.path.join(p,n) for n in os.listdir(p) if os.path.isdir(os.path.join(p,n))] if os.path.isdir(p) else []))";
      paths = JSON.parse(
        await this.host.runSsh(config, `python3 -c ${quote(code)}`),
      );
    }
    const folders = [...new Set(paths)].map((p) => ({
      path: p,
      name: path.posix.basename(p) || p,
    }));
    return {
      hostId: hostId(id),
      folders,
      defaultFolder: folders[0]?.path || null,
    };
  }
  mapping(p, { defaultEnabled = false } = {}) {
    const id = codespaceId(p.id),
      mode = p.mode || "simple";
    if (!["simple", "ssh"].includes(mode))
      fail("INVALID_FORWARD", "Choose simple or SSH forwarding.");
    let remoteHost = p.remoteHost || "127.0.0.1";
    if (!/^[A-Za-z0-9_.:[\]-]+$/.test(remoteHost) || remoteHost.startsWith("-"))
      fail(
        "INVALID_FORWARD",
        "Choose a hostname or IP address without shell syntax.",
      );
    if (remoteHost.includes(":")) {
      const address = remoteHost.replace(/^\[|\]$/g, "");
      if (net.isIP(address) !== 6)
        fail(
          "INVALID_FORWARD",
          "Remote IPv6 addresses must be valid IP addresses.",
        );
      remoteHost = `[${address}]`;
    }
    const minutes = Number(p.expiresInMinutes ?? 60);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440)
      fail("INVALID_FORWARD", "Forward expiry must be from 1 to 1440 minutes.");
    if (p.enabled !== undefined && typeof p.enabled !== "boolean")
      fail("INVALID_FORWARD", "Saved forward enabled must be a boolean.");
    return {
      id,
      mode,
      localPort: port(p.localPort),
      remoteHost: mode === "simple" ? "127.0.0.1" : remoteHost,
      remotePort: port(p.remotePort),
      expiresInMinutes: minutes,
      enabled: p.enabled ?? defaultEnabled,
    };
  }
  async availablePort(localPort) {
    await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once("error", () =>
        reject(
          Object.assign(
            new Error(
              "That localhost port is already in use. No existing listener was changed.",
            ),
            { code: "PORT_IN_USE" },
          ),
        ),
      );
      server.listen(
        { host: "127.0.0.1", port: localPort, exclusive: true },
        () => server.close(resolve),
      );
    });
  }
  async startForward(p, { restoring = false } = {}) {
    await this.enabled();
    const mapping = this.mapping(p, { defaultEnabled: !!p.save });
    if (
      [...this.forwards.values()].some((f) => f.localPort === mapping.localPort)
    )
      fail("PORT_IN_USE", "This localhost port already has an owned forward.");
    await this.availablePort(mapping.localPort);
    await this.ensureTransport(mapping.id);
    const executable = await this.gh(),
      forwardId = crypto.randomUUID(),
      expiresAt = Date.now() + mapping.expiresInMinutes * 60000;
    const args =
      mapping.mode === "simple"
        ? [
            "codespace",
            "ports",
            "forward",
            `${mapping.remotePort}:${mapping.localPort}`,
            "--codespace",
            mapping.id,
          ]
        : [
            "codespace",
            "ssh",
            "--codespace",
            mapping.id,
            "--",
            "-N",
            "-T",
            "-o",
            "BatchMode=yes",
            "-o",
            "ExitOnForwardFailure=yes",
            "-L",
            `127.0.0.1:${mapping.localPort}:${mapping.remoteHost}:${mapping.remotePort}`,
          ];
    this.assertEnabled();
    if (
      restoring &&
      !this.settings.savedForwards.some(
        (f) =>
          f.id === mapping.id &&
          f.localPort === mapping.localPort &&
          f.enabled === true,
      )
    )
      fail(
        "FORWARD_DISABLED",
        "This saved mapping was disabled or removed before restoration.",
      );
    const child = this.own(
      this.spawnProcess(executable, args, {
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
        env: this.environment(),
      }),
    );
    const record = {
      ...mapping,
      forwardId,
      hostId: hostId(mapping.id),
      expiresAt,
      state: "connecting",
      saved:
        !!p.save ||
        this.settings.savedForwards.some(
          (f) => f.id === mapping.id && f.localPort === mapping.localPort,
        ),
      child,
    };
    this.forwards.set(forwardId, record);
    child.stdout?.resume();
    child.stderr?.resume();
    const exited = () => {
      clearTimeout(record.timer);
      if (this.forwards.get(forwardId) === record) {
        this.forwards.delete(forwardId);
        this.host.emit("host-event", {
          type: "codespaces-forward",
          forwardId,
          state: "disconnected",
        });
      }
    };
    child.once("close", exited);
    child.once("error", exited);
    try {
      const deadline = Date.now() + this.readyTimeout;
      while (Date.now() < deadline) {
        if (!this.forwards.has(forwardId))
          fail(
            "FORWARD_FAILED",
            "Port forwarding exited before opening its localhost listener.",
          );
        if (
          await new Promise((resolve) => {
            const socket = net.connect({
              host: "127.0.0.1",
              port: mapping.localPort,
            });
            socket.setTimeout(200);
            socket.once("connect", () => {
              socket.destroy();
              resolve(true);
            });
            socket.once("error", () => resolve(false));
            socket.once("timeout", () => {
              socket.destroy();
              resolve(false);
            });
          })
        ) {
          record.state = "ready";
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (record.state !== "ready")
        fail(
          "FORWARD_TIMEOUT",
          "Port forwarding did not open its localhost listener in time.",
        );
      record.timer = setTimeout(
        () => this.stopForward(forwardId),
        mapping.expiresInMinutes * 60000,
      );
      record.timer.unref();
      if (p.save) {
        this.settings.savedForwards = this.settings.savedForwards.filter(
          (f) => !(f.id === mapping.id && f.localPort === mapping.localPort),
        );
        this.settings.savedForwards.push(mapping);
        await this.save();
      }
      return this.forwardRow(record);
    } catch (error) {
      await this.stopForward(forwardId);
      throw error;
    }
  }
  forwardRow({ child, timer, ...row }) {
    return row;
  }
  async stopForward(forwardId) {
    const record = this.forwards.get(forwardId);
    if (!record) return false;
    this.forwards.delete(forwardId);
    clearTimeout(record.timer);
    record.child.kill("SIGTERM");
    const force = setTimeout(() => {
      if (this.children.has(record.child)) record.child.kill("SIGKILL");
    }, 1000);
    force.unref();
    this.host.emit("host-event", {
      type: "codespaces-forward",
      forwardId,
      state: "stopped",
    });
    return true;
  }
  async disconnect(id) {
    await Promise.all(
      [...this.forwards.values()]
        .filter((f) => f.id === id)
        .map((f) => this.stopForward(f.forwardId)),
    );
    await this.host.disconnect(hostId(id));
  }
  async close() {
    this.epoch++;
    await Promise.all(
      [...this.forwards.keys()].map((id) => this.stopForward(id)),
    );
    await Promise.all(
      [...this.host.connections.keys()]
        .filter((id) => id.startsWith("codespace:"))
        .map((id) => this.host.disconnect(id)),
    );
    for (const child of this.children) {
      child.kill("SIGTERM");
      const force = setTimeout(() => {
        if (this.children.has(child)) child.kill("SIGKILL");
      }, 1000);
      force.unref();
    }
    for (const check of this.bufferChecks.values()) check.finish();
    this.snapshots.clear();
  }
  async request(operation, p = {}) {
    await this.ready;
    if (operation === "settings") return this.settings;
    if (operation === "configure") {
      const update = this.settingsQueue.then(() => this.configure(p));
      this.settingsQueue = update.catch(() => {});
      return update;
    }
    if (operation === "status") return this.status(p);
    await this.enabled();
    if (operation === "buffers") return this.report(p);
    if (operation === "list") return this.list();
    if (operation === "safety") return this.safety(codespaceId(p.id));
    if (["start", "stop", "delete"].includes(operation))
      return this.lifecycle(operation, p);
    if (operation === "create") {
      if (!p.confirmCreate)
        fail(
          "CODESPACE_CONFIRMATION_REQUIRED",
          "Confirm creation and its possible GitHub usage charges.",
        );
      if (
        typeof p.repo !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(p.repo)
      )
        fail("INVALID_REPOSITORY", "Enter an owner/repository name.");
      const args = [
        "api",
        "--method",
        "POST",
        `repos/${p.repo}/codespaces`,
        "--field",
        "idle_timeout_minutes=30",
        "--field",
        "retention_period_minutes=1440",
      ];
      for (const [key, field] of [
        ["branch", "ref"],
        ["machine", "machine"],
        ["displayName", "display_name"],
      ])
        if (p[key]) {
          if (
            typeof p[key] !== "string" ||
            p[key].includes("\0") ||
            p[key].length > 200
          )
            fail(
              "INVALID_CODESPACE_OPTION",
              "Invalid Codespace creation option.",
            );
          args.push("--raw-field", `${field}=${p[key]}`);
        }
      return item(await this.json(args, 120000), this.host.connections);
    }
    if (operation === "discover") return this.discover(codespaceId(p.id));
    if (operation === "connect") {
      const id = codespaceId(p.id);
      await this.ensureTransport(id);
      const config = {
        hostId: hostId(id),
        helperPath: p.helperPath,
        systemNode: p.systemNode,
      };
      if (p.helperPath) return this.host.connect(config);
      const probe = await this.host.probe(config);
      if (probe.state === "setup-needed" && !p.approve)
        return { hostId: hostId(id), state: "setup-needed", probe };
      return probe.state === "setup-needed"
        ? this.host.setup({ ...config, approve: true })
        : this.host.connect(config);
    }
    if (operation === "sshCommand") {
      const id = codespaceId(p.id),
        executable = await this.gh(),
        argv = ["codespace", "ssh", "--codespace", id];
      if (p.path !== undefined) {
        if (
          typeof p.path !== "string" ||
          !path.posix.isAbsolute(p.path) ||
          p.path.includes("\0")
        )
          fail(
            "INVALID_PATH",
            "Choose an absolute folder path on this Codespace.",
          );
        argv.push(
          "--",
          "-t",
          `cd -- ${quote(p.path)} && exec "\${SHELL:-/bin/sh}" -l`,
        );
      }
      return {
        executable,
        argv,
        command: [executable, ...argv].map(quote).join(" "),
      };
    }
    if (operation === "forward.list")
      return {
        items: [...this.forwards.values()].map((f) => this.forwardRow(f)),
        savedForwards: this.settings.savedForwards,
      };
    if (operation === "forward.start") return this.startForward(p);
    if (operation === "forward.stop") return this.stopForward(p.forwardId);
    if (operation === "forward.configure") {
      const id = codespaceId(p.id),
        localPort = port(p.localPort);
      if (typeof p.enabled !== "boolean")
        fail("INVALID_FORWARD", "Saved forward enabled must be a boolean.");
      const update = this.settingsQueue.then(async () => {
        this.assertEnabled();
        if (
          !this.settings.savedForwards.some(
            (f) => f.id === id && f.localPort === localPort,
          )
        )
          fail(
            "FORWARD_NOT_FOUND",
            "This saved forward mapping was not found.",
          );
        this.settings = {
          ...this.settings,
          savedForwards: this.settings.savedForwards.map((f) =>
            f.id === id && f.localPort === localPort
              ? { ...f, enabled: p.enabled }
              : f,
          ),
        };
        await this.save();
        this.host.emit("host-event", {
          type: "codespaces-settings",
          settings: this.settings,
        });
        return this.settings;
      });
      this.settingsQueue = update.catch(() => {});
      return update;
    }
    if (operation === "forward.forget") {
      this.settings.savedForwards = this.settings.savedForwards.filter(
        (f) => !(f.id === p.id && f.localPort === Number(p.localPort)),
      );
      await this.save();
      return true;
    }
    if (operation === "forward.restore") {
      if (p.confirm !== true)
        fail(
          "FORWARD_RESTORE_CONFIRMATION_REQUIRED",
          "Confirm restoration of saved port mappings.",
        );
      const items = [];
      for (const mapping of this.settings.savedForwards.filter(
        (f) => f.enabled === true,
      )) {
        if (
          !this.settings.savedForwards.some(
            (f) =>
              f.id === mapping.id &&
              f.localPort === mapping.localPort &&
              f.enabled === true,
          )
        )
          continue;
        try {
          items.push({
            ok: true,
            forward: await this.startForward(
              { ...mapping, save: false },
              { restoring: true },
            ),
          });
        } catch (error) {
          items.push({
            ok: false,
            id: mapping.id,
            localPort: mapping.localPort,
            error: {
              code: error.code || "FORWARD_FAILED",
              message: error.message,
            },
          });
        }
      }
      return { items };
    }
    fail("UNKNOWN_OPERATION", "Unknown Codespaces operation.");
  }
}
