import { FileJobs } from "./file-jobs.mjs";
import { RecentProjects } from "./recents.mjs";
import { Engine, VERSION, errorObject } from "./engine.mjs";
import { Codespaces, codespaceTransportError } from "./codespaces.mjs";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import net from "node:net";
import readline from "node:readline";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const remoteMode = process.argv.includes("--remote");
export class Host {
  constructor({
    emit = () => {},
    dataDir,
    runtimeDir,
    cli = !remoteMode,
    codespacesOptions = {},
  } = {}) {
    this.emit = emit;
    this.searchContexts = new Map();
    this.engine = new Engine({
      emit: (name, payload) => this.dispatch(name, payload),
      dataDir,
      runtimeDir,
      hostId: "local",
    });
    this.connections = new Map();
    this.recents = new RecentProjects(this.engine, this.emit);
    this.connecting = new Map();
    this.remoteConfigs = new Map();
    this.windows = new Map();
    this.pendingRequests = [];
    this.remoteRootIds = new Map();
    this.cli = cli;
    this.closing = false;
    this.files = new FileJobs(this);
    this.codespaces = new Codespaces(this, {
      ...codespacesOptions,
      allowEnable: !remoteMode && codespacesOptions.allowEnable !== false,
    });
  }
  async request(operation, p = {}) {
    if (operation.startsWith("recents.")) {
      if (remoteMode)
        throw new Error("Recent projects are stored on the desktop.");
      if (operation === "recents.list") return this.recents.list();
      if (operation === "recents.record") return this.recents.record(p);
      if (operation === "recents.get") return this.recents.get(p.id);
    }
    if (operation === "app.openRecent") {
      const project = await this.recents.get(p.id);
      const destination = this.windows.get(p.windowId);
      if (!destination?.empty)
        throw new Error(
          "Open this recent project in a new desktop window to preserve the current workspace.",
        );
      return this.deliver({
        operation: project.kind === "workspace" ? "open" : "add",
        windowId: p.windowId,
        ...(project.kind === "workspace"
          ? { workspace: project.path }
          : { roots: [project] }),
      });
    }
    if (operation.startsWith("files.")) {
      if (remoteMode)
        throw new Error("File job coordination runs on the desktop host.");
      return this.files.request(operation.slice(6), p);
    }
    if (operation.startsWith("codespaces."))
      return this.codespaces.request(operation.slice("codespaces.".length), p);
    if (operation === "remote.aliases") return this.aliases();
    if (operation === "remote.probe") return this.probe(p);
    if (operation === "remote.setup") return this.setup(p);
    if (operation === "remote.connect") return this.connect(p);
    if (operation === "remote.disconnect") return this.disconnect(p.hostId);
    if (operation === "remote.respond") {
      const waiter = this.authPrompts?.get(p.promptId);
      if (!waiter)
        throw Object.assign(new Error("Authentication prompt expired."), {
          code: "PROMPT_EXPIRED",
        });
      this.authPrompts.delete(p.promptId);
      waiter(p.response || "");
      return true;
    }
    if (operation === "app.openPaths") {
      const files = (p.paths || []).filter(
        (value) =>
          typeof value === "string" &&
          path.isAbsolute(value) &&
          !value.includes("\0"),
      );
      if (!files.length) throw new Error("No local files were provided.");
      const windows = [...this.windows.values()].sort(
        (a, b) =>
          Number(b.focused) - Number(a.focused) || b.updated - a.updated,
      );
      const windowId = windows[0]?.id || "main";
      const request = {
        operation: "add",
        windowId,
        files,
        requestId: crypto.randomUUID(),
      };
      this.pendingRequests.push(request);
      this.emit("host-event", { type: "cli-request", request });
      return { windowId, requestId: request.requestId };
    }
    if (operation === "app.parseArgs") {
      const script =
        process.env.ISLET_CLI_SCRIPT ||
        path.resolve(import.meta.dirname, "../scripts/islet.mjs");
      const { parseArgs } = await import(new URL("file://" + script).href);
      return parseArgs([...(p.args || [])]);
    }
    if (operation === "app.installCli") return this.installCli(p);
    if (operation === "app.close") {
      await this.close();
      return true;
    }
    if (operation === "app.ackRequest") {
      this.pendingRequests = this.pendingRequests.filter(
        (r) => r.requestId !== p.requestId,
      );
      return true;
    }
    if (operation === "app.reserveWindow") {
      if (!this.windows.has(p.windowId))
        this.windows.set(p.windowId, {
          id: p.windowId,
          name: "Workspace",
          focused: false,
          ready: false,
          updated: Date.now(),
        });
      return true;
    }
    if (operation === "app.focusWindow") {
      if (p.focused)
        for (const other of this.windows.values()) other.focused = false;
      const existing = this.windows.get(p.windowId);
      if (existing) {
        existing.focused = !!p.focused;
        existing.updated = Date.now();
      }
      return true;
    }
    if (operation === "app.registerWindow") {
      if (p.focused)
        for (const other of this.windows.values()) other.focused = false;
      const existing = this.windows.get(p.windowId) || {};
      this.windows.set(p.windowId, {
        ...existing,
        id: p.windowId,
        name: p.name ?? existing.name ?? "Workspace",
        workspaceId: p.workspaceId ?? existing.workspaceId,
        workspaceIdentity: p.workspaceIdentity ?? existing.workspaceIdentity,
        firstFolder: p.firstFolder ?? existing.firstFolder,
        roots: p.roots ?? existing.roots ?? [],
        empty: p.empty ?? existing.empty ?? false,
        focused: p.focused == null ? !!existing.focused : !!p.focused,
        ready: true,
        updated: Date.now(),
      });
      return true;
    }
    if (operation === "app.unregisterWindow") {
      this.windows.delete(p.windowId);
      await this.engine.request("lsp.stopClient", { clientId: p.windowId });
      await this.engine.request("root.closeClient", { clientId: p.windowId });
      await Promise.allSettled(
        [...this.connections.values()].map(async (c) => {
          await c.request("lsp.stopClient", { clientId: p.windowId });
          await c.request("root.closeClient", { clientId: p.windowId });
        }),
      );
      return true;
    }
    if (operation === "app.windows")
      return [...this.windows.values()].filter((w) => w.ready !== false);
    if (operation === "app.pendingRequests") {
      const mine = this.pendingRequests.filter(
        (r) => !r.windowId || r.windowId === p.windowId,
      );
      this.pendingRequests = this.pendingRequests.filter(
        (r) => !mine.includes(r),
      );
      return mine;
    }
    if (operation === "cli.deliver") return this.deliver(p);
    if (operation === "search.start") return this.search(p);
    if (operation === "search.cancel") {
      await Promise.allSettled([
        this.engine.request(operation, p),
        ...[...this.connections.values()].map((c) => c.request(operation, p)),
      ]);
      return true;
    }
    if (operation.startsWith("lsp.") && p.sessionId?.startsWith("remote:")) {
      const [hostId, sessionId] = decodeSession(p.sessionId);
      return this.remoteRequest(hostId, operation, { ...p, sessionId });
    }
    const hostId = p.hostId || p.root?.hostId || "local";
    if (hostId !== "local") {
      const result = await this.remoteRequest(hostId, operation, {
        ...p,
        id:
          operation === "root.remove"
            ? this.remoteRootIds.get(p.id) || p.id
            : p.id,
        hostId: "local",
        root: p.root ? { ...p.root, hostId: "local" } : undefined,
      });
      if (operation === "lsp.start")
        return {
          ...result,
          sessionId: encodeSession(hostId, result.sessionId),
        };
      if (result && typeof result === "object" && !Array.isArray(result)) {
        if (operation === "root.open") {
          const id = crypto
            .createHash("sha256")
            .update(hostId + "\0" + result.path)
            .digest("hex")
            .slice(0, 20);
          this.remoteRootIds.set(id, result.id);
          return { ...result, id, hostId };
        }
        return { ...result, hostId };
      }
      return result;
    }
    return this.engine.request(operation, p);
  }
  async aliases() {
    let config = "";
    try {
      config = await fs.readFile(
        path.join(os.homedir(), ".ssh/config"),
        "utf8",
      );
    } catch {}
    const aliases = [];
    for (const line of config.split("\n")) {
      const match = /^\s*Host\s+(.+?)\s*(?:#.*)?$/i.exec(line);
      if (match)
        for (const name of match[1].trim().split(/\s+/))
          if (!/[?*!]/.test(name) && !aliases.includes(name))
            aliases.push(name);
    }
    return aliases.map((target) => ({
      hostId: "ssh:" + target,
      target,
      label: target,
    }));
  }
  config(p) {
    if (p.hostId?.startsWith("codespace:")) return this.codespaces.config(p);
    let target = p.target || String(p.hostId || "").replace(/^ssh:/, "");
    let parsedPort = p.port;
    if (!parsedPort) {
      const hostPart = target.split("@").at(-1);
      const m = /^(.*):(\d+)$/.exec(target);
      if (m && (hostPart.startsWith("[") || hostPart.split(":").length === 2)) {
        target = m[1];
        parsedPort = Number(m[2]);
      }
    }
    if (
      !target ||
      target.startsWith("-") ||
      !/^([\w.-]+@)?[\w.:[\]-]+$/.test(target)
    )
      throw Object.assign(
        new Error("Use a valid SSH configuration alias or user@host."),
        { code: "INVALID_SSH_TARGET" },
      );
    if (
      parsedPort &&
      (!Number.isInteger(Number(parsedPort)) ||
        Number(parsedPort) < 1 ||
        Number(parsedPort) > 65535)
    )
      throw new Error("Invalid SSH port.");
    return {
      hostId:
        p.hostId || "ssh:" + target + (parsedPort ? ":" + parsedPort : ""),
      target,
      port: parsedPort ? Number(parsedPort) : undefined,
      configFile: p.configFile,
      helperPath: p.helperPath,
      systemNode: p.systemNode,
      interactive: !!p.interactive,
    };
  }
  sshArgs(config) {
    const args = [
      "-T",
      "-o",
      config.interactive ? "BatchMode=no" : "BatchMode=yes",
      "-o",
      config.interactive
        ? "StrictHostKeyChecking=ask"
        : "StrictHostKeyChecking=yes",
      "-o",
      "ConnectTimeout=10",
      "-o",
      "ServerAliveInterval=10",
      "-o",
      "ServerAliveCountMax=2",
    ];
    if (config.port) args.push("-p", String(config.port));
    if (config.configFile) args.push("-F", config.configFile);
    args.push(config.target);
    return args;
  }
  async sshEnvironment(config) {
    if (!config.interactive) return process.env;
    if (!this.askpassServer) {
      this.authPrompts = new Map();
      const token = crypto.randomBytes(32).toString("hex");
      await fs.mkdir(this.engine.dataDir, { recursive: true, mode: 0o700 });
      const socket = path.join(
        this.engine.dataDir,
        `askpass-${process.pid}.sock`,
      );
      this.askpassSocket = socket;
      this.askpassToken = token;
      this.askpassServer = net.createServer((client) => {
        let raw = "";
        client.on("data", (d) => {
          raw += d;
          if (raw.length > 16000) {
            client.destroy();
            return;
          }
          if (!raw.includes("\n")) return;
          let request;
          try {
            request = JSON.parse(raw);
          } catch {
            client.destroy();
            return;
          }
          if (request.token !== token) {
            client.destroy();
            return;
          }
          const promptId = crypto.randomUUID();
          const timer = setTimeout(() => {
            this.authPrompts.delete(promptId);
            client.end("");
          }, 120000);
          this.authPrompts.set(promptId, (response) => {
            clearTimeout(timer);
            client.end(response + "\n");
          });
          this.emit("host-event", {
            type: "authentication",
            hostId: request.hostId || config.hostId,
            promptId,
            prompt: request.prompt,
            secret: !/(yes\/no|fingerprint)/i.test(request.prompt),
            expiresAt: Date.now() + 120000,
          });
        });
      });
      await new Promise((resolve, reject) => {
        this.askpassServer.once("error", reject);
        this.askpassServer.listen(socket, resolve);
      });
      await fs.chmod(socket, 0o600);
      const wrapper = path.join(
        this.engine.dataDir,
        "askpass-" + process.pid + ".sh",
      );
      await fs.writeFile(
        wrapper,
        "#!/bin/sh\nexec " +
          quote(process.execPath) +
          " " +
          quote(path.join(import.meta.dirname, "askpass.mjs")) +
          ' "$@"\n',
        { mode: 0o700 },
      );
      this.askpassWrapper = wrapper;
    }
    return {
      ...process.env,
      SSH_ASKPASS: this.askpassWrapper,
      SSH_ASKPASS_REQUIRE: "force",
      DISPLAY: "islet",
      ISLET_ASKPASS_SOCKET: this.askpassSocket,
      ISLET_ASKPASS_TOKEN: this.askpassToken,
      ISLET_ASKPASS_HOST: config.hostId,
    };
  }
  async runSsh(config, command, { input, timeout = 30000 } = {}) {
    if (config.codespaceId)
      await this.codespaces.ensureTransport(config.codespaceId);
    const env = await this.sshEnvironment(config);
    return new Promise((resolve, reject) => {
      const options = {
        stdio: ["pipe", "pipe", "pipe"],
        env,
      };
      const proc = config.codespaceId
        ? this.codespaces.spawnSsh(config, command, options)
        : spawn("/usr/bin/ssh", [...this.sshArgs(config), command], options);
      let stdout = "",
        stderr = "";
      const timer = setTimeout(() => {
        proc.kill();
        reject(
          Object.assign(new Error("SSH request timed out."), {
            code: "SSH_TIMEOUT",
          }),
        );
      }, timeout);
      proc.stdout.on("data", (d) => {
        stdout += d;
        if (stdout.length > 1024 * 1024) {
          proc.kill();
          reject(new Error("Oversized SSH response."));
        }
      });
      proc.stderr.on("data", (d) => {
        stderr = (stderr + d).slice(-8000);
      });
      proc.on("error", reject);
      proc.on("exit", (code) => {
        clearTimeout(timer);
        const providerError = config.codespaceId
          ? codespaceTransportError(stderr)
          : null;
        code === 0
          ? resolve(stdout)
          : reject(
              Object.assign(
                new Error(providerError?.message || sshError(stderr)),
                {
                  code: providerError?.code || classifySsh(stderr),
                  ...(providerError
                    ? {}
                    : { details: { stderr: stderr.slice(0, 8000) } }),
                },
              ),
            );
      });
      proc.stdin.end(input);
    });
  }
  async probe(p) {
    if (p.hostId?.startsWith("codespace:"))
      await this.codespaces.ensureTransport(
        p.hostId.slice("codespace:".length),
      );
    const config = this.config({ ...this.remoteConfigs.get(p.hostId), ...p });
    const code =
      "import os,sys,json,platform,shutil; p=os.path.expanduser('~/.cache/islet'); a=os.path.expanduser('~'); print(json.dumps({'os':platform.system(),'arch':platform.machine(),'python':sys.version.split()[0],'freeBytes':shutil.disk_usage(a).free,'cachePath':p,'writable':os.access(a,os.W_OK),'helperInstalled':os.path.isfile(p+'/" +
      VERSION +
      "/host.mjs') and os.path.isfile(p+'/" +
      VERSION +
      "/node') and os.access(p+'/" +
      VERSION +
      "/node',os.X_OK)}))";
    const result = JSON.parse(
      await this.runSsh(config, `python3 -c ${quote(code)}`),
    );
    return {
      ...result,
      hostId: config.hostId,
      target: config.target,
      version: VERSION,
      state: result.helperInstalled ? "ready" : "setup-needed",
    };
  }
  async setup(p) {
    if (p.hostId?.startsWith("codespace:"))
      await this.codespaces.ensureTransport(
        p.hostId.slice("codespace:".length),
      );
    const config = this.config({ ...this.remoteConfigs.get(p.hostId), ...p });
    if (!p.approve)
      throw Object.assign(
        new Error(
          "Remote setup needs explicit approval for the displayed host and cache location.",
        ),
        { code: "SETUP_APPROVAL_REQUIRED" },
      );
    const probe = await this.probe(config);
    if (probe.os !== "Linux")
      throw Object.assign(
        new Error("Initial remote runtime supports Linux x86_64 and arm64."),
        { code: "UNSUPPORTED_REMOTE_OS" },
      );
    const arch =
      probe.arch === "x86_64"
        ? "x64"
        : ["aarch64", "arm64"].includes(probe.arch)
          ? "arm64"
          : null;
    if (!arch) throw new Error("Unsupported remote architecture.");
    const archive = process.env.ISLET_REMOTE_PACKAGE_DIR
      ? path.join(
          process.env.ISLET_REMOTE_PACKAGE_DIR,
          `islet-${VERSION}-linux-${arch}.tar.gz`,
        )
      : path.resolve(
          import.meta.dirname,
          `../src-tauri/resources/remote/islet-${VERSION}-linux-${arch}.tar.gz`,
        );
    await fs.access(archive).catch(() => {
      throw Object.assign(
        new Error(
          `Remote package is unavailable. Run npm run runtime:remote -- ${arch} before setup.`,
        ),
        { code: "REMOTE_PACKAGE_MISSING" },
      );
    });
    const data = await fs.readFile(archive);
    if (probe.freeBytes < data.length * 4)
      throw new Error("Not enough remote free space for setup.");
    const digest = crypto.createHash("sha256").update(data).digest("hex");
    const script = `import os,sys,hashlib,tarfile,io,tempfile,shutil\nb=sys.stdin.buffer.read()\nassert hashlib.sha256(b).hexdigest()==sys.argv[1], 'Package checksum mismatch'\nbase=os.path.expanduser('~/.cache/islet'); os.makedirs(base,mode=0o700,exist_ok=True)\nassert os.stat(base).st_uid==os.getuid(), 'Cache ownership mismatch'\ntmp=tempfile.mkdtemp(prefix='.setup-',dir=base)\ntry:\n t=tarfile.open(fileobj=io.BytesIO(b),mode='r:gz')\n for m in t.getmembers():\n  assert not m.name.startswith('/') and '..' not in m.name.split('/') and not m.issym() and not m.islnk(), 'Unsafe archive entry'\n t.extractall(tmp); t.close()\n os.chmod(tmp+'/node',0o700)\n dest=base+'/${VERSION}'; old=dest+'.previous'\n if os.path.exists(old): shutil.rmtree(old)\n if os.path.exists(dest): os.rename(dest,old)\n os.rename(tmp,dest)\n print('Installed Islet ${VERSION}')\nfinally:\n if os.path.exists(tmp): shutil.rmtree(tmp)\n`;
    await this.runSsh(config, `python3 -c ${quote(script)} ${digest}`, {
      input: data,
      timeout: 180000,
    });
    this.remoteConfigs.set(config.hostId, config);
    return this.connect(config);
  }
  async connect(p) {
    if (p.hostId?.startsWith("codespace:")) await this.codespaces.enabled();
    const config = this.config({ ...this.remoteConfigs.get(p.hostId), ...p });
    // Roots and windows share a transport. Never let concurrent restores close
    // one another's handshake, or replace a healthy channel on window focus.
    const pending = this.connecting.get(config.hostId);
    if (pending) return pending.promise;
    const attempt = { cancelled: false };
    attempt.promise = Promise.resolve().then(async () => {
      try {
        const existing = this.connections.get(config.hostId);
        const previous = this.remoteConfigs.get(config.hostId);
        const sameTransport =
          previous &&
          [
            "target",
            "port",
            "configFile",
            "helperPath",
            "systemNode",
            "ghPath",
          ].every((key) => previous[key] === config[key]);
        if (existing?.info && sameTransport && !existing.closed) {
          try {
            await existing.request("ping", {}, 5000);
            if (attempt.cancelled) throw new Error("SSH connection cancelled.");
            return {
              hostId: config.hostId,
              state: "ready",
              generation: existing.info.generation,
              info: existing.info,
            };
          } catch (error) {
            if (attempt.cancelled) throw error;
            existing.close();
          }
        }
        return await this.openConnection(config, attempt);
      } catch (error) {
        if (!attempt.cancelled)
          this.emit("host-event", {
            type: "connection",
            hostId: config.hostId,
            state:
              error.code === "REMOTE_SETUP_REQUIRED"
                ? "setup-needed"
                : "disconnected",
            error: errorObject(error),
          });
        throw error;
      } finally {
        if (this.connecting.get(config.hostId) === attempt)
          this.connecting.delete(config.hostId);
      }
    });
    this.connecting.set(config.hostId, attempt);
    return attempt.promise;
  }
  async openConnection(config, attempt) {
    const cancelled = () => {
      if (attempt.cancelled || this.closing)
        throw Object.assign(new Error("SSH connection cancelled."), {
          code: "DISCONNECTED",
        });
    };
    cancelled();
    if (config.hostId.startsWith("codespace:"))
      await this.codespaces.ensureTransport(
        config.hostId.slice("codespace:".length),
      );
    cancelled();
    this.connections.get(config.hostId)?.close();
    this.remoteConfigs.set(config.hostId, config);
    this.emit("host-event", {
      type: "connection",
      hostId: config.hostId,
      state: "connecting",
    });
    const helper = config.helperPath;
    if (helper && (!path.posix.isAbsolute(helper) || helper.includes("\0")))
      throw new Error("Existing helper path must be absolute."); // shell arguments below are individually quoted, never reconstructed project paths
    if (!helper && !config.codespaceId) {
      const info = await this.probe(config);
      cancelled();
      if (!info.helperInstalled)
        throw Object.assign(
          new Error(
            `The SSH helper for Islet ${VERSION} is not installed on ${config.target}. Set up this version to reconnect.`,
          ),
          {
            code: "REMOTE_SETUP_REQUIRED",
            details: {
              hostId: config.hostId,
              version: VERSION,
              cachePath: path.posix.join(info.cachePath, VERSION),
            },
          },
        );
    }
    const command = helper
      ? `${quote(config.systemNode || "node")} ${quote(path.posix.join(helper, "host.mjs"))} --remote`
      : `exec "$HOME/.cache/islet/${VERSION}/node" "$HOME/.cache/islet/${VERSION}/host.mjs" --remote`;
    const env = await this.sshEnvironment(config);
    cancelled();
    const options = {
      stdio: ["pipe", "pipe", "pipe"],
      env,
    };
    const child = config.codespaceId
      ? this.codespaces.spawnSsh(config, command, options)
      : spawn("/usr/bin/ssh", [...this.sshArgs(config), command], options);
    const channel = new Channel(child, {
      hostId: config.hostId,
      formatError: config.codespaceId
        ? (stderr) => codespaceTransportError(stderr).message
        : sshError,
      emit: (name, event) => {
        if (this.connections.get(config.hostId) !== channel) return;
        if (name === "lsp-message")
          event = {
            ...event,
            hostId: config.hostId,
            sessionId: encodeSession(config.hostId, event.sessionId),
          };
        else {
          event = { ...event, hostId: config.hostId };
          if (event.sessionId)
            event.sessionId = encodeSession(config.hostId, event.sessionId);
          if (event.results)
            event.results = event.results.map((r) => ({
              ...r,
              hostId: config.hostId,
            }));
          if (event.roots)
            event.roots = event.roots.map((r) => ({
              ...r,
              hostId: config.hostId,
            }));
        }
        this.dispatch(name, event);
      },
      onClose: (error) => {
        if (this.connections.get(config.hostId) !== channel) return;
        this.connections.delete(config.hostId);
        this.emit("host-event", {
          type: "connection",
          hostId: config.hostId,
          state: "disconnected",
          error,
        });
      },
    });
    this.connections.set(config.hostId, channel);
    try {
      const info = await channel.request("app.info", {}, 15000);
      cancelled();
      if (info.version !== VERSION || info.fileProtocol !== 1)
        throw Object.assign(
          new Error(
            "Remote helper version differs from this application. Setup an upgrade.",
          ),
          { code: "HELPER_VERSION" },
        );
      channel.info = info;
      this.emit("host-event", {
        type: "connection",
        hostId: config.hostId,
        state: "ready",
        generation: info.generation,
      });
      return {
        hostId: config.hostId,
        state: "ready",
        generation: info.generation,
        info,
      };
    } catch (e) {
      channel.close();
      throw e;
    }
  }
  async remoteRequest(hostId, operation, p) {
    if (hostId.startsWith("codespace:")) await this.codespaces.enabled();
    let channel = this.connections.get(hostId);
    if (
      operation === "root.open" &&
      (!channel || this.connecting.has(hostId))
    ) {
      await this.connect({ hostId });
      channel = this.connections.get(hostId);
    }
    if (!channel)
      throw Object.assign(
        new Error(
          `SSH connection ${hostId} is disconnected. Reconnect before using remote files.`,
        ),
        { code: "DISCONNECTED", details: { hostId } },
      );
    try {
      return await channel.request(
        operation,
        p,
        operation === "search.start" ? 180000 : 30000,
      );
    } catch (e) {
      if (
        (operation === "fs.save" || operation === "file.save") &&
        ["DISCONNECTED", "SSH_TIMEOUT"].includes(e.code)
      )
        throw Object.assign(
          new Error(
            "Connection lost during remote save. The result is uncertain; reread the remote file before retrying.",
          ),
          {
            code: "SAVE_UNCERTAIN",
            details: {
              hostId,
              path: p.path,
              expectedRevision: p.expectedRevision,
              intendedTextSha256: crypto
                .createHash("sha256")
                .update(p.text)
                .digest("hex"),
            },
          },
        );
      throw e;
    }
  }
  async disconnect(hostId) {
    const pending = this.connecting.get(hostId);
    if (pending) {
      pending.cancelled = true;
      this.connecting.delete(hostId);
    }
    const existing = this.connections.get(hostId);
    if (existing) {
      existing.close();
      this.connections.delete(hostId);
    }
    return true;
  }
  dispatch(name, event) {
    if (name === "host-event" && event.type === "search-complete") {
      this.emit(name, { ...event, type: "search-host-complete" });
      return;
    }
    if (name === "host-event" && event.type === "search-results") {
      const context = this.searchContexts.get(event.requestId);
      if (context) {
        const available = Math.max(0, 10000 - context.count);
        const candidates = event.results.slice(0, available);
        const results = [];
        for (const result of candidates) {
          const bytes = Buffer.byteLength(JSON.stringify(result));
          if (context.bytes + bytes > 16 * 1024 * 1024) {
            context.truncated = true;
            break;
          }
          context.bytes += bytes;
          results.push(result);
        }
        context.count += results.length;
        if (results.length < event.results.length) context.truncated = true;
        if (!results.length) return;
        event = { ...event, results };
      }
    }
    this.emit(name, event);
  }
  async search(p) {
    const requestId = p.requestId || crypto.randomUUID();
    p = { ...p, requestId };
    const context = { count: 0, bytes: 0, truncated: false };
    this.searchContexts.set(requestId, context);
    const byHost = new Map();
    for (const root of p.roots || []) {
      const list = byHost.get(root.hostId || "local") || [];
      list.push(root);
      byHost.set(root.hostId || "local", list);
    }
    try {
      const parts = await Promise.all(
        [...byHost].map(async ([hostId, roots]) => {
          try {
            const request = {
              ...p,
              roots: roots.map((r) => ({ ...r, hostId: "local" })),
              overlays: (p.overlays || [])
                .filter((d) => (d.hostId || "local") === hostId)
                .map((d) => ({ ...d, hostId: "local" })),
            };
            const value =
              hostId === "local"
                ? await this.engine.request("search.start", request)
                : await this.remoteRequest(hostId, "search.start", request);
            return {
              ...value,
              results: value.results.map((r) => ({ ...r, hostId })),
              roots: value.roots.map((r) => ({ ...r, hostId })),
            };
          } catch (e) {
            return {
              results: [],
              roots: roots.map((r) => ({
                ...r,
                state: "failed",
                error: errorObject(e),
              })),
              limits: {},
              complete: false,
            };
          }
        }),
      );
      const all = [];
      let bytes = 0;
      for (const result of parts.flatMap((part) => part.results)) {
        bytes += Buffer.byteLength(JSON.stringify(result));
        if (bytes > 16 * 1024 * 1024) {
          context.truncated = true;
          break;
        }
        all.push(result);
      }
      const limits = {
        maxFileBytes: 5242880,
        maxResults: 10000,
        skippedBinary: parts.reduce(
          (n, p) => n + (p.limits.skippedBinary || 0),
          0,
        ),
        skippedLarge: parts.reduce(
          (n, p) => n + (p.limits.skippedLarge || 0),
          0,
        ),
        truncated:
          context.truncated ||
          all.length > 10000 ||
          parts.some((p) => p.limits.truncated),
      };
      const response = {
        requestId,
        results: all.slice(0, 10000),
        roots: parts.flatMap((p) => p.roots),
        limits,
        complete: parts.every((p) => p.complete) && !limits.truncated,
        cancelled: parts.some((p) => p.cancelled),
      };
      this.emit("host-event", {
        type: "search-complete",
        ...response,
        results: undefined,
      });
      return response;
    } finally {
      if (this.searchContexts.get(requestId) === context)
        this.searchContexts.delete(requestId);
    }
  }
  async installCli(p) {
    if (process.platform === "win32")
      throw Object.assign(
        new Error("The launcher installer currently supports macOS and Linux."),
        { code: "UNSUPPORTED_PLATFORM" },
      );
    const directory = p.directory || path.join(os.homedir(), ".local/bin");
    if (!path.isAbsolute(directory))
      throw new Error("Choose an absolute launcher directory.");
    await fs.mkdir(directory, { recursive: true });
    const script =
      process.env.ISLET_CLI_SCRIPT ||
      path.resolve(import.meta.dirname, "../scripts/islet.mjs");
    await fs.access(script);
    const destination = path.join(directory, "islet");
    const contents =
      "#!/bin/sh\nexec " +
      quote(process.execPath) +
      " " +
      quote(script) +
      ' "$@"\n';
    if (
      await fs.lstat(destination).then(
        () => true,
        () => false,
      )
    ) {
      const existing = await fs.readFile(destination, "utf8");
      if (!existing.includes("islet.mjs"))
        throw Object.assign(
          new Error(
            "A different islet launcher already exists here. Choose another directory.",
          ),
          { code: "ALREADY_EXISTS" },
        );
    }
    await fs.writeFile(destination, contents, { mode: 0o755 });
    return {
      path: destination,
      directory,
      onPath: (process.env.PATH || "")
        .split(path.delimiter)
        .includes(directory),
    };
  }
  async deliver(p) {
    let windowId = p.windowId;
    if (windowId && !this.windows.has(windowId))
      throw Object.assign(new Error("The requested window is not open."), {
        code: "WINDOW_NOT_FOUND",
        details: { windows: [...this.windows.values()] },
      });
    if (p.operation === "open" && !windowId) {
      windowId = this.windows.has("main")
        ? "main"
        : [...this.windows.keys()][0];
    }
    if (p.operation === "add") {
      if (windowId && !this.windows.has(windowId))
        throw Object.assign(new Error("The requested window is not open."), {
          code: "WINDOW_NOT_FOUND",
          details: { windows: [...this.windows.values()] },
        });
      if (!windowId) {
        const focused = [...this.windows.values()].filter((w) => w.focused);
        if (focused.length === 1) windowId = focused[0].id;
        else if (this.windows.size === 1)
          windowId = [...this.windows.keys()][0];
        else
          throw Object.assign(
            new Error(
              "No unambiguous target window. Use --window with an ID from islet windows --json.",
            ),
            {
              code: "AMBIGUOUS_WINDOW",
              details: { windows: [...this.windows.values()] },
            },
          );
      }
    }
    const request = {
      ...p,
      windowId,
      requestId: p.requestId || crypto.randomUUID(),
    };
    this.pendingRequests.push(request);
    this.emit("host-event", { type: "cli-request", request });
    return { delivered: true, requestId: request.requestId, windowId };
  }
  async startCli() {
    if (!this.cli) return;
    await fs.mkdir(this.engine.dataDir, { recursive: true, mode: 0o700 });
    const socket = path.join(this.engine.dataDir, `ipc-${process.pid}.sock`);
    const token = crypto.randomBytes(32).toString("hex");
    this.cliRegistry = { pid: process.pid, socket, token, version: VERSION };
    this.cliServer = net.createServer((client) => {
      let buffer = "";
      client.on("data", async (d) => {
        buffer += d;
        if (buffer.length > 1024 * 1024) {
          client.destroy();
          return;
        }
        const end = buffer.indexOf("\n");
        if (end < 0) return;
        const raw = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        try {
          const msg = JSON.parse(raw);
          if (msg.token !== token)
            throw new Error("Unauthenticated CLI request.");
          const result =
            msg.operation === "windows"
              ? await this.request("app.windows")
              : await this.request("cli.deliver", msg.request);
          client.end(JSON.stringify({ result }) + "\n");
        } catch (e) {
          client.end(JSON.stringify({ error: errorObject(e) }) + "\n");
        }
      });
    });
    await new Promise((resolve, reject) => {
      this.cliServer.once("error", reject);
      this.cliServer.listen(socket, resolve);
    });
    await fs.chmod(socket, 0o600);
    await fs.writeFile(
      path.join(this.engine.dataDir, `ipc-${process.pid}.json`),
      JSON.stringify(this.cliRegistry),
      { mode: 0o600 },
    );
  }
  async close() {
    await this.files.close();
    if (this.closing) return;
    this.closing = true;
    await this.codespaces.close();
    await Promise.all(
      [...new Set([...this.connections.keys(), ...this.connecting.keys()])].map(
        (id) => this.disconnect(id),
      ),
    );
    await this.engine.close();
    if (this.cliServer) this.cliServer.close();
    if (this.askpassServer) this.askpassServer.close();
    if (this.askpassSocket) await fs.unlink(this.askpassSocket).catch(() => {});
    if (this.cliRegistry) {
      await fs.unlink(this.cliRegistry.socket).catch(() => {});
      await fs
        .unlink(path.join(this.engine.dataDir, `ipc-${process.pid}.json`))
        .catch(() => {});
    }
  }
}
class Channel {
  constructor(child, { hostId, emit, onClose, formatError = sshError }) {
    this.child = child;
    this.hostId = hostId;
    this.emit = emit;
    this.onClose = onClose;
    this.waiters = new Map();
    this.id = 0;
    this.closed = false;
    this.heartbeat = setInterval(
      () => this.request("ping", {}, 10000).catch(() => this.close()),
      30000,
    );
    this.heartbeat.unref();
    let buffer = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      buffer += d;
      if (buffer.length > 64 * 1024 * 1024) {
        this.fail("Oversized remote frame");
        return;
      }
      for (;;) {
        const end = buffer.indexOf("\n");
        if (end < 0) break;
        const raw = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        let msg;
        try {
          msg = JSON.parse(raw);
        } catch {
          this.fail("Invalid remote helper frame");
          return;
        }
        if (msg.event) {
          this.emit(msg.event, msg.payload);
          continue;
        }
        const w = this.waiters.get(msg.id);
        if (w) {
          this.waiters.delete(msg.id);
          clearTimeout(w.timer);
          msg.error
            ? w.reject(Object.assign(new Error(msg.error.message), msg.error))
            : w.resolve(msg.result);
        }
      }
    });
    child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-8000)));
    child.on("error", (e) => this.fail(e.message));
    child.on("exit", () =>
      this.fail(formatError(stderr) || "SSH channel closed."),
    );
  }
  request(operation, payload, timeout = 30000) {
    if (this.closed)
      return Promise.reject(
        Object.assign(new Error("SSH channel is closed."), {
          code: "DISCONNECTED",
        }),
      );
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        reject(
          Object.assign(new Error("SSH operation timed out."), {
            code: "SSH_TIMEOUT",
          }),
        );
      }, timeout);
      this.waiters.set(id, { resolve, reject, timer });
      this.child.stdin.write(
        JSON.stringify({ id, operation, payload }) + "\n",
        (e) => {
          if (e) {
            clearTimeout(timer);
            this.waiters.delete(id);
            reject(Object.assign(e, { code: "DISCONNECTED" }));
          }
        },
      );
    });
  }
  fail(message) {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.heartbeat);
    for (const w of this.waiters.values()) {
      clearTimeout(w.timer);
      w.reject(Object.assign(new Error(message), { code: "DISCONNECTED" }));
    }
    this.waiters.clear();
    this.onClose({ code: "DISCONNECTED", message });
  }
  close() {
    this.child.stdin.end();
    this.child.kill("SIGTERM");
    this.fail("SSH disconnected.");
  }
}
const encodeSession = (hostId, id) =>
  "remote:" + Buffer.from(JSON.stringify([hostId, id])).toString("base64url");
const decodeSession = (id) =>
  JSON.parse(Buffer.from(id.slice(7), "base64url").toString());
function quote(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}
function classifySsh(stderr) {
  return /REMOTE HOST IDENTIFICATION HAS CHANGED/.test(stderr)
    ? "HOST_KEY_CHANGED"
    : /Host key verification failed/.test(stderr)
      ? "HOST_KEY_UNVERIFIED"
      : /Permission denied/.test(stderr)
        ? "AUTHENTICATION_REQUIRED"
        : "SSH_ERROR";
}
function sshError(stderr) {
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED/.test(stderr))
    return "The SSH host key changed. Connection was rejected. Verify the host with your administrator.";
  if (/Host key verification failed/.test(stderr))
    return "SSH host key is not trusted. Verify it using OpenSSH before reconnecting.";
  if (/Permission denied/.test(stderr))
    return "SSH authentication failed. Unlock your SSH agent or configure a key for this alias.";
  return stderr.trim();
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
  const host = new Host({
    emit: (event, payload) => send({ event, payload }),
    runtimeDir: process.env.ISLET_RUNTIME_DIR,
    cli: !remoteMode,
  });
  if (!remoteMode) await host.startCli();
  const reader = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });
  // A local helper belongs to the app's stdin pipe. Heartbeats can pause during
  // system sleep or App Nap, so a wall-clock lease would kill a healthy helper
  // on wake. Only remote helpers need a lease to clean up abandoned SSH sessions.
  let lease;
  const touch = () => {
    if (!remoteMode) return;
    clearTimeout(lease);
    lease = setTimeout(() => {
      host.close().finally(() => process.exit(0));
    }, 120000);
    lease.unref();
  };
  touch();
  reader.on("line", (line) => {
    touch();
    if (Buffer.byteLength(line) > 64 * 1024 * 1024) {
      send({
        error: {
          code: "FRAME_TOO_LARGE",
          message: "Request exceeds frame size limit.",
        },
      });
      return;
    }
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      return;
    }
    if (request.operation === "ping") {
      send({ id: request.id, result: true });
      return;
    }
    host.request(request.operation, request.payload).then(
      (result) => send({ id: request.id, result }),
      (e) => send({ id: request.id, error: errorObject(e) }),
    );
  });
  reader.on("close", () => host.close().finally(() => process.exit(0)));
  process.on("SIGTERM", () => host.close().finally(() => process.exit(0)));
  process.on("SIGINT", () => host.close().finally(() => process.exit(0)));
}
