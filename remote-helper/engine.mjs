import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { Worker } from "node:worker_threads";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

export const VERSION = "0.1.0";
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const inside = (file, root) =>
  file === root || file.startsWith(root + path.sep);
const fail = (code, message, details) => {
  throw Object.assign(new Error(message), { code, details });
};
const ignoredNames = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  ".venv",
  "venv",
  "__pycache__",
  "dist",
  "build",
  "target",
]);
const mimeTypes = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
};
export const errorObject = (error) => ({
  code: error.code || "HOST_ERROR",
  message: error.message || String(error),
  details: error.details,
});
export class Engine {
  constructor({ dataDir, emit = () => {}, runtimeDir, hostId = "local" } = {}) {
    this.dataDir =
      dataDir ||
      process.env.ISLET_DATA_DIR ||
      path.join(
        os.homedir(),
        process.platform === "darwin"
          ? "Library/Application Support/Islet"
          : ".local/share/islet",
      );
    this.emit = emit;
    this.runtimeDir =
      runtimeDir ||
      (fsSync.existsSync(path.join(import.meta.dirname, "node_modules"))
        ? path.join(import.meta.dirname, "node_modules")
        : path.resolve(import.meta.dirname, "../node_modules"));
    this.hostId = hostId;
    this.roots = new Map();
    this.rootOwners = new Map();
    this.sessionIndexQueue = Promise.resolve();
    this.documents = new Map();
    this.services = new Map();
    this.searches = new Map();
    this.watchers = new Map();
    this.generation = crypto.randomUUID();
  }
  async canonical(file, { mustExist = true } = {}) {
    if (
      typeof file !== "string" ||
      !path.isAbsolute(file) ||
      file.includes("\0")
    )
      fail("INVALID_PATH", "An absolute path is required.");
    const absolute = path.resolve(file);
    try {
      return await fs.realpath(absolute);
    } catch (e) {
      if (mustExist) throw e;
      return path.join(
        await fs.realpath(path.dirname(absolute)),
        path.basename(absolute),
      );
    }
  }
  async scoped(
    file,
    { write = false, dependency = false, mustExist = true } = {},
  ) {
    const canonical = await this.canonical(file, { mustExist });
    const root = [...this.roots.values()]
      .filter((r) => inside(canonical, r.path))
      .sort((a, b) => b.path.length - a.path.length)[0];
    if (
      !root &&
      !(dependency && !write) &&
      !(write && this.documents.get(canonical)?.writable)
    )
      fail(
        "OUTSIDE_WORKSPACE",
        "This path is outside attached roots. Add its folder to the workspace first.",
        { path: canonical },
      );
    return canonical;
  }
  async request(operation, p = {}) {
    operation = operation.replace(/^file\./, "fs.");
    switch (operation) {
      case "app.info":
        return {
          version: VERSION,
          platform: process.platform,
          arch: process.arch,
          node: process.version,
          generation: this.generation,
          dataDir: this.dataDir,
        };
      case "root.open":
        return this.openRoot(p);
      case "root.remove":
        return this.removeRoot(p);
      case "root.closeClient":
        for (const root of [...this.roots.values()])
          await this.removeRoot({ id: root.id, clientId: p.clientId });
        return true;
      case "fs.browse":
        return this.list({ ...p, browse: true });
      case "fs.list":
        return this.list(p);
      case "fs.read":
        return this.read(p);
      case "fs.stat":
        return this.stat(p);
      case "fs.save":
        return this.save(p);
      case "fs.preflight":
        return Promise.all(p.files.map((f) => this.preflight(f)));
      case "fs.create":
        return this.create(p);
      case "fs.rename":
        return this.rename(p);
      case "fs.readAsset":
        return this.asset(p);
      case "fs.watch":
        return this.watch(p);
      case "fs.unwatch": {
        this.watchers.get(p.path)?.close();
        this.watchers.delete(p.path);
        return true;
      }
      case "fs.folders":
        return this.folders(p);
      case "session.list":
        await this.sessionIndexQueue;
        return (
          (await this.loadState("sessions", "session-index"))?.entries || []
        );
      case "session.register":
        return this.registerSession(p.entry || p);
      case "session.load":
        return this.loadState("sessions", p.key || "default");
      case "session.save":
        return this.saveState("sessions", p.key || "default", p.value);
      case "settings.load":
        return this.loadState("settings", "preferences");
      case "settings.save":
        return this.saveState("settings", "preferences", p.value);
      case "recovery.load":
        return this.loadState("recovery", p.key || "default");
      case "recovery.save":
        return this.saveState("recovery", p.key || "default", p.value);
      case "journal.load":
        return this.loadState("journals", p.key || "default");
      case "session.journal":
      case "journal.save":
        return this.saveState("journals", p.key || "default", p.value);
      case "workspace.load":
        return this.loadWorkspace(p);
      case "workspace.save":
        return this.saveWorkspace(p);
      case "lsp.start":
        return this.startService(p);
      case "lsp.send":
        return this.sendService(p);
      case "lsp.request":
        return this.requestService(p);
      case "lsp.notify":
        return this.sendService({
          ...p,
          message: { jsonrpc: "2.0", method: p.method, params: p.params },
        });
      case "lsp.stopClient":
        await Promise.all(
          [...this.services.values()]
            .filter((s) => s.clientId === p.clientId)
            .map((s) => this.stopService(s.id)),
        );
        return true;
      case "lsp.stop":
        return this.stopService(p.sessionId);
      case "search.start":
        return this.search(p);
      case "search.cancel":
        this.searches.get(p.requestId)?.abort();
        return true;
      default:
        fail("UNKNOWN_OPERATION", `Unknown host operation: ${operation}`);
    }
  }
  async openRoot(p) {
    const canonical = await this.canonical(p.path);
    const s = await fs.stat(canonical);
    if (!s.isDirectory()) fail("NOT_DIRECTORY", "Choose a directory.");
    const root = {
      id: p.id || hash(`${this.hostId}\0${canonical}`).slice(0, 20),
      hostId: this.hostId,
      path: canonical,
      label: p.label || path.basename(canonical) || canonical,
      state: "ready",
    };
    this.roots.set(root.id, root);
    const owners = this.rootOwners.get(root.id) || new Set();
    owners.add(p.clientId || "default");
    this.rootOwners.set(root.id, owners);
    return root;
  }
  async removeRoot(p) {
    const root =
      this.roots.get(p.id) ||
      [...this.roots.values()].find((r) => r.path === p.path);
    if (!root) return true;
    const owners = this.rootOwners.get(root.id);
    if (p.clientId && owners && !owners.has(p.clientId)) return true;
    if (p.clientId) owners?.delete(p.clientId);
    await Promise.all(
      [...this.services.values()]
        .filter(
          (s) =>
            inside(s.rootPath, root.path) &&
            (!p.clientId || s.clientId === p.clientId),
        )
        .map((s) => this.stopService(s.id)),
    );
    if (p.clientId && owners?.size) return true;
    this.rootOwners.delete(root.id);
    for (const [file, watcher] of this.watchers) {
      if (inside(file, root.path)) {
        watcher.close();
        this.watchers.delete(file);
      }
    }
    for (const file of this.documents.keys())
      if (inside(file, root.path)) this.documents.delete(file);
    this.roots.delete(root.id);
    return true;
  }
  async list(p) {
    const dir = p.browse
      ? await this.canonical(p.path)
      : await this.scoped(p.path);
    const list = await fs.readdir(dir, { withFileTypes: true });
    return list
      .filter((e) => p.hidden || !e.name.startsWith("."))
      .filter((e) => p.ignored || !ignoredNames.has(e.name))
      .map((e) => ({
        name: e.name,
        path: path.join(dir, e.name),
        isDirectory: e.isDirectory(),
        isFile: e.isFile(),
        isSymlink: e.isSymbolicLink(),
      }))
      .sort(
        (a, b) =>
          Number(b.isDirectory) - Number(a.isDirectory) ||
          a.name.localeCompare(b.name),
      );
  }
  async read(p) {
    const file = await this.scoped(p.path, {
      dependency: p.dependency !== false,
    });
    const bytes = await fs.readFile(file);
    if (bytes.length > 50 * 1024 * 1024)
      fail("FILE_TOO_LARGE", "File exceeds the 50 MB safety limit.");
    if (bytes.includes(0)) fail("BINARY_FILE", "This file is binary.");
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      fail(
        "UNSUPPORTED_ENCODING",
        "This file is not valid UTF-8. It has not been modified.",
      );
    }
    const bom =
      bytes.length >= 3 &&
      bytes[0] === 239 &&
      bytes[1] === 187 &&
      bytes[2] === 191;
    const newline = text.includes("\r\n")
      ? "CRLF"
      : text.includes("\r")
        ? "CR"
        : "LF";
    text = text.replace(/\r\n?/g, "\n");
    const stat = await fs.stat(file);
    let readonly = ![...this.roots.values()].some((r) => inside(file, r.path));
    try {
      await fs.access(file, fsSync.constants.W_OK);
    } catch {
      readonly = true;
    }
    const doc = {
      hostId: this.hostId,
      path: file,
      text,
      revision: hash(bytes),
      encoding: "utf-8",
      bom,
      newline,
      readonly,
      size: bytes.length,
      mtimeMs: stat.mtimeMs,
    };
    this.documents.set(file, {
      ...doc,
      writable:
        !readonly && [...this.roots.values()].some((r) => inside(file, r.path)),
    });
    return doc;
  }
  async stat(p) {
    const file = await this.scoped(p.path, { dependency: true });
    const s = await fs.stat(file);
    return {
      hostId: this.hostId,
      path: file,
      revision: s.isFile() ? hash(await fs.readFile(file)) : null,
      size: s.size,
      mtimeMs: s.mtimeMs,
      isDirectory: s.isDirectory(),
      readonly: !(s.mode & 0o222),
    };
  }
  async preflight(p) {
    const file = await this.scoped(p.path, { write: true });
    const info = await this.stat({ path: file });
    if (p.expectedRevision !== info.revision)
      fail(
        "REVISION_CONFLICT",
        "File changed on disk. Compare or reload before saving.",
        info,
      );
    await fs.access(file, fsSync.constants.W_OK);
    return info;
  }
  async save(p) {
    const file = await this.scoped(p.path, { write: true });
    if (typeof p.text !== "string" || typeof p.expectedRevision !== "string")
      fail(
        "INVALID_SAVE",
        "Saving requires text and the expected disk revision.",
      );
    await this.preflight({ ...p, path: file });
    const old = await fs.stat(file);
    const known = this.documents.get(file);
    const newline = p.newline || known?.newline || "LF";
    if (!["LF", "CRLF", "CR"].includes(newline))
      fail("INVALID_SAVE", "Unsupported newline style.");
    const text = p.text
      .replace(/\r\n?/g, "\n")
      .replace(
        /\n/g,
        newline === "CRLF" ? "\r\n" : newline === "CR" ? "\r" : "\n",
      );
    const bytes = Buffer.from(
      ((p.bom ?? known?.bom) ? "\uFEFF" : "") + text,
      "utf8",
    );
    const temp = path.join(
      path.dirname(file),
      `.${path.basename(file)}.islet-${crypto.randomUUID()}.tmp`,
    );
    let handle;
    try {
      handle = await fs.open(temp, "wx", old.mode);
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.chmod(temp, old.mode); // recheck immediately before the atomic replacement
      if (hash(await fs.readFile(file)) !== p.expectedRevision)
        fail("REVISION_CONFLICT", "File changed while preparing this save.");
      await fs.rename(temp, file);
      try {
        const d = await fs.open(path.dirname(file), "r");
        await d.sync();
        await d.close();
      } catch {}
      return await this.read({ path: file });
    } finally {
      if (handle) await handle.close();
      await fs.unlink(temp).catch(() => {});
    }
  }
  async create(p) {
    const file = await this.scoped(p.path, { write: false, mustExist: false });
    if (p.directory) await fs.mkdir(file);
    else await fs.writeFile(file, p.text || "", { flag: "wx" });
    return { path: file, hostId: this.hostId };
  }
  async rename(p) {
    const oldPath = await this.scoped(p.path, { write: true });
    if ((await fs.lstat(p.path)).isSymbolicLink())
      fail(
        "SYMLINK_RENAME",
        "Rename the target file explicitly. Renaming a symbolic link is not supported.",
      );
    const newPath = await this.scoped(p.newPath, { mustExist: false });
    if (
      await fs.lstat(newPath).then(
        () => true,
        () => false,
      )
    )
      fail("ALREADY_EXISTS", "The destination already exists.");
    await fs.rename(oldPath, newPath);
    for (const [watched, watcher] of [...this.watchers]) {
      if (!inside(watched, oldPath)) continue;
      watcher.close();
      this.watchers.delete(watched);
      await this.watch({
        path: path.join(newPath, path.relative(oldPath, watched)),
      });
    }
    for (const [documentPath, document] of [...this.documents]) {
      if (!inside(documentPath, oldPath)) continue;
      this.documents.delete(documentPath);
      const renamedPath = path.join(
        newPath,
        path.relative(oldPath, documentPath),
      );
      this.documents.set(renamedPath, { ...document, path: renamedPath });
    }
    return { hostId: this.hostId, path: newPath, oldPath };
  }
  async asset(p) {
    const file = await this.scoped(p.path);
    const bytes = await fs.readFile(file);
    if (bytes.length > 10 * 1024 * 1024)
      fail("ASSET_TOO_LARGE", "Images are limited to 10 MB.");
    const mime = mimeTypes[path.extname(file).toLowerCase()];
    if (!mime) fail("UNSUPPORTED_ASSET", "Unsupported image type.");
    if (mime === "image/svg+xml")
      fail(
        "UNSUPPORTED_ASSET",
        "SVG previews are disabled to prevent active content.",
      );
    return { base64: bytes.toString("base64"), mime };
  }
  async watch(p) {
    const file = await this.scoped(p.path);
    this.watchers.get(file)?.close();
    const watcher = fsSync.watch(
      path.dirname(file),
      { persistent: false },
      (_event, name) => {
        if (this.watchers.get(file) !== watcher) return;
        if (name && name.toString() !== path.basename(file)) return;
        this.emit("host-event", {
          type: "file-changed",
          hostId: this.hostId,
          path: file,
        });
      },
    );
    watcher.on("error", (e) =>
      this.emit("host-event", {
        type: "watch-error",
        hostId: this.hostId,
        path: file,
        error: errorObject(e),
      }),
    );
    this.watchers.set(file, watcher);
    return true;
  }
  async folders(p) {
    const dir = await this.scoped(p.path);
    return (await this.list({ path: dir, hidden: p.hidden })).filter(
      (e) => e.isDirectory,
    );
  }
  statePath(kind, key) {
    return path.join(this.dataDir, kind, hash(String(key)) + ".json");
  }
  async loadState(kind, key) {
    try {
      const raw = await fs.readFile(this.statePath(kind, key), "utf8");
      return JSON.parse(raw);
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  }
  async saveState(kind, key, value) {
    if (value === undefined)
      fail("INVALID_STATE", "A state value is required.");
    const file = this.statePath(kind, key);
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = file + "." + crypto.randomUUID();
    let handle;
    try {
      handle = await fs.open(temp, "wx", 0o600);
      await handle.writeFile(JSON.stringify(value));
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.rename(temp, file);
    } finally {
      if (handle) await handle.close();
      await fs.unlink(temp).catch(() => {});
    }
    return true;
  }
  registerSession(entry) {
    if (!entry || typeof entry.key !== "string" || !entry.key)
      fail("INVALID_SESSION", "A recovery session key is required.");
    const record = {
      key: entry.key,
      windowId: String(entry.windowId || ""),
      workspaceId: String(entry.workspaceId || ""),
      workspaceIdentity:
        typeof entry.workspaceIdentity === "string"
          ? entry.workspaceIdentity
          : undefined,
      name: String(entry.name || "Workspace"),
      updated: Number(entry.updated) || Date.now(),
      dirtyCount: Math.max(0, Math.floor(Number(entry.dirtyCount) || 0)),
    };
    const update = async () => {
      const index = (await this.loadState("sessions", "session-index")) || {
        schemaVersion: 1,
        entries: [],
      };
      const entries = [
        record,
        ...(index.entries || []).filter((item) => item.key !== record.key),
      ].sort((a, b) => b.updated - a.updated);
      await this.saveState("sessions", "session-index", {
        schemaVersion: 1,
        entries,
      });
      return record;
    };
    const result = this.sessionIndexQueue.then(update, update);
    this.sessionIndexQueue = result.catch(() => {});
    return result;
  }
  async loadWorkspace(p) {
    const file = await this.canonical(p.path);
    const manifest = JSON.parse(await fs.readFile(file, "utf8"));
    if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.roots))
      fail("WORKSPACE_VERSION", "This workspace format is not supported.");
    for (const r of manifest.roots) {
      if (r.password || r.privateKey)
        fail("WORKSPACE_SECRET", "Workspace files cannot contain credentials.");
      if (r.hostId === "local" && !path.isAbsolute(r.path))
        r.path = path.resolve(path.dirname(file), r.path);
    }
    return { ...manifest, manifestPath: file };
  }
  async saveWorkspace(p) {
    if (
      !p.value ||
      p.value.schemaVersion !== 1 ||
      !Array.isArray(p.value.roots)
    )
      fail("INVALID_WORKSPACE", "Invalid workspace manifest.");
    const safe = JSON.parse(JSON.stringify(p.value));
    for (const r of safe.roots) {
      delete r.password;
      delete r.privateKey;
      delete r.passphrase;
    }
    const file = await this.canonical(p.path, { mustExist: false });
    const temp = file + ".islet-" + crypto.randomUUID();
    await fs.writeFile(temp, JSON.stringify(safe, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    await fs.rename(temp, file);
    return true;
  }
  resolveRuntime(relative) {
    return path.join(this.runtimeDir, relative);
  }
  async startService(p) {
    const rootPath = await this.scoped(p.rootPath || p.root?.path);
    const language =
      p.language === "python"
        ? "python"
        : ["javascript", "typescript", "jsx", "tsx"].includes(p.language)
          ? "javascript"
          : null;
    if (!language)
      fail(
        "UNSUPPORTED_LANGUAGE",
        "No language service is available for this language.",
      );
    const interpreter = p.interpreter || (await this.detectPython(rootPath));
    const key = [
      rootPath,
      language,
      interpreter || "",
      p.clientId || "default",
    ].join("\0");
    const existing = [...this.services.values()].find(
      (s) => s.key === key && !s.closed,
    );
    if (existing) {
      existing.lastUsed = Date.now();
      return { sessionId: existing.id, reused: true, interpreter };
    }
    if (this.services.size >= 8) {
      const idle = [...this.services.values()].sort(
        (a, b) => a.lastUsed - b.lastUsed,
      )[0];
      if (Date.now() - idle.lastUsed < 120000)
        fail(
          "SERVICE_LIMIT",
          "Eight language projects are active. Close a project before starting another.",
        );
      await this.stopService(idle.id);
    }
    const executable =
      language === "python"
        ? this.resolveRuntime("basedpyright/dist/pyright-langserver.js")
        : this.resolveRuntime("typescript-language-server/lib/cli.mjs");
    await fs.access(executable);
    const args = [executable, "--stdio"];
    const child = spawn(process.execPath, args, {
      cwd: rootPath,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, NODE_OPTIONS: "", PYTHONPATH: "" },
    });
    const id = crypto.randomUUID();
    const service = {
      id,
      key,
      clientId: p.clientId || "default",
      child,
      buffer: Buffer.alloc(0),
      pending: new Map(),
      nextId: 1,
      lastUsed: Date.now(),
      closed: false,
      rootPath,
      language,
      interpreter,
    };
    this.services.set(id, service);
    child.stdout.on("data", (data) => this.readLsp(service, data));
    child.stderr.on("data", (data) =>
      this.emit("host-event", {
        type: "language-log",
        sessionId: id,
        text: data.toString().slice(0, 4000),
      }),
    );
    child.on("error", (e) => this.serviceExit(service, e.message));
    child.on("exit", (code, signal) =>
      this.serviceExit(service, `Language service exited (${code ?? signal})`),
    );
    return {
      sessionId: id,
      interpreter,
      language,
      generation: this.generation,
    };
  }
  async detectPython(root) {
    for (const folder of [".venv", "venv"]) {
      const executable = path.join(
        root,
        folder,
        process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
      );
      if (
        await fs.access(executable).then(
          () => true,
          () => false,
        )
      )
        return executable;
    }
    return null;
  }
  readLsp(service, chunk) {
    service.buffer = Buffer.concat([service.buffer, chunk]);
    for (;;) {
      const end = service.buffer.indexOf("\r\n\r\n");
      if (end < 0) return;
      const match = /Content-Length:\s*(\d+)/i.exec(
        service.buffer.subarray(0, end).toString(),
      );
      if (!match) {
        this.serviceExit(service, "Invalid language protocol frame");
        return;
      }
      const len = Number(match[1]);
      if (len > 32 * 1024 * 1024) {
        this.serviceExit(service, "Oversized language protocol frame");
        return;
      }
      if (service.buffer.length < end + 4 + len) return;
      const raw = service.buffer.subarray(end + 4, end + 4 + len);
      service.buffer = service.buffer.subarray(end + 4 + len);
      let message;
      try {
        message = JSON.parse(raw.toString("utf8"));
      } catch {
        continue;
      }
      const waiter = service.pending.get(message.id);
      if (waiter && (message.result !== undefined || message.error)) {
        clearTimeout(waiter.timer);
        service.pending.delete(message.id);
        message.error
          ? waiter.reject(
              Object.assign(new Error(message.error.message), {
                code: "LSP_ERROR",
                details: message.error,
              }),
            )
          : waiter.resolve(message.result);
      } else
        this.emit("lsp-message", {
          sessionId: service.id,
          message,
          hostId: this.hostId,
          generation: this.generation,
        });
    }
  }
  async sendService(p) {
    const s = this.services.get(p.sessionId);
    if (!s || s.closed)
      fail(
        "SERVICE_UNAVAILABLE",
        "The language service is disconnected. Restart it to continue.",
      );
    s.lastUsed = Date.now();
    let message = p.message;
    if (message?.method === "initialize" && s.language === "javascript") {
      const init = message.params?.initializationOptions || {};
      message = {
        ...message,
        params: {
          ...message.params,
          initializationOptions: {
            ...init,
            plugins: [],
            disableAutomaticTypingAcquisition: true,
            tsserver: {
              ...(init.tsserver || {}),
              path: this.resolveRuntime("typescript/lib/tsserver.js"),
            },
          },
        },
      };
    }
    const body = Buffer.from(JSON.stringify(message));
    await new Promise((resolve, reject) =>
      s.child.stdin.write(
        Buffer.concat([
          Buffer.from(`Content-Length: ${body.length}\r\n\r\n`),
          body,
        ]),
        (e) => (e ? reject(e) : resolve()),
      ),
    );
    return true;
  }
  async requestService(p) {
    const s = this.services.get(p.sessionId);
    if (!s || s.closed)
      fail("SERVICE_UNAVAILABLE", "Language service is unavailable.");
    const id = `host-${s.nextId++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        s.pending.delete(id);
        this.sendService({
          sessionId: s.id,
          message: {
            jsonrpc: "2.0",
            method: "$/cancelRequest",
            params: { id },
          },
        }).catch(() => {});
        reject(
          Object.assign(new Error("Language request timed out."), {
            code: "LSP_TIMEOUT",
          }),
        );
      }, p.timeoutMs || 30000);
      s.pending.set(id, { resolve, reject, timer });
      this.sendService({
        sessionId: s.id,
        message: { jsonrpc: "2.0", id, method: p.method, params: p.params },
      }).catch(reject);
    });
  }
  serviceExit(service, message) {
    if (service.closed) return;
    service.closed = true;
    this.services.delete(service.id);
    for (const p of service.pending.values()) {
      clearTimeout(p.timer);
      p.reject(Object.assign(new Error(message), { code: "SERVICE_CRASH" }));
    }
    service.pending.clear();
    this.emit("host-event", {
      type: "language-exit",
      sessionId: service.id,
      message,
      hostId: this.hostId,
    });
  }
  async stopService(id) {
    const s = this.services.get(id);
    if (!s) return true;
    try {
      await this.requestService({
        sessionId: id,
        method: "shutdown",
        timeoutMs: 1000,
      });
      await this.sendService({
        sessionId: id,
        message: { jsonrpc: "2.0", method: "exit" },
      });
    } catch {}
    s.child.kill("SIGTERM");
    this.serviceExit(s, "Language service stopped.");
    return true;
  }
  async search(p) {
    const requestId = p.requestId || crypto.randomUUID();
    this.searches.get(requestId)?.abort();
    const controller = new AbortController();
    this.searches.set(requestId, controller);
    const roots = p.roots || [...this.roots.values()];
    const options = p.options || {};
    const matcher = compileSearch(p.query, options);
    const worker = new RegexMatcher(matcher, controller.signal);
    const results = [];
    const statuses = [];
    const limits = {
      maxFileBytes: 5 * 1024 * 1024,
      maxResults: 10000,
      skippedBinary: 0,
      skippedLarge: 0,
      truncated: false,
    };
    let batch = [];
    const overlays = new Map(
      (p.overlays || [])
        .filter((d) => !d.hostId || d.hostId === this.hostId)
        .map((d) => [path.resolve(d.path), d]),
    );
    const visited = new Set();
    const append = (matches) => {
      if (matches.limited) limits.truncated = true;
      for (const item of matches) {
        if (results.length >= limits.maxResults) {
          limits.truncated = true;
          break;
        }
        results.push(item);
        batch.push(item);
        if (batch.length >= 50) {
          this.emit("host-event", {
            type: "search-results",
            requestId,
            results: batch,
          });
          batch = [];
        }
      }
    };
    try {
      for (const root of roots) {
        const status = {
          id: root.id,
          hostId: this.hostId,
          path: root.path,
          state: "running",
          files: 0,
        };
        statuses.push(status);
        this.emit("host-event", { type: "search-root", requestId, ...status });
        try {
          const folder = await this.scoped(root.path);
          const stat = await fs.stat(folder);
          if (!stat.isDirectory())
            fail("NOT_DIRECTORY", "Search folder does not exist.");
          const owner = [...this.roots.values()]
            .filter((r) => inside(folder, r.path))
            .sort((a, b) => b.path.length - a.path.length)[0];
          const ignore = await ignoreChain(
            folder,
            owner?.path || folder,
            options,
          );
          for await (const file of walk(
            folder,
            options,
            ignore,
            controller.signal,
          )) {
            if (controller.signal.aborted || limits.truncated) break;
            if (visited.has(file)) continue;
            visited.add(file);
            let text, revision, version;
            const overlay = overlays.get(file);
            if (overlay) {
              text = overlay.text;
              version = overlay.version;
              revision = overlay.revision || null;
            } else {
              const info = await fs.stat(file);
              if (info.size > limits.maxFileBytes) {
                limits.skippedLarge++;
                continue;
              }
              const bytes = await fs.readFile(file);
              if (bytes.includes(0)) {
                limits.skippedBinary++;
                continue;
              }
              try {
                text = new TextDecoder("utf-8", { fatal: true })
                  .decode(bytes)
                  .replace(/\r\n?/g, "\n");
              } catch {
                limits.skippedBinary++;
                continue;
              }
              revision = hash(bytes);
            }
            if (Buffer.byteLength(text) > limits.maxFileBytes) {
              limits.skippedLarge++;
              continue;
            }
            status.files++;
            append(
              await worker.match(text, {
                hostId: this.hostId,
                path: file,
                rootId: root.id,
                revision,
                version,
              }),
            );
          } // overlays for new/ignored open documents still respect scope and filters
          for (const [file, overlay] of overlays) {
            if (controller.signal.aborted || limits.truncated) break;
            const relative = path.relative(folder, file);
            if (
              !inside(file, folder) ||
              visited.has(file) ||
              !matchesFilters(relative, options)
            )
              continue;
            const parts = relative.split(path.sep);
            if (!options.hidden && parts.some((part) => part.startsWith(".")))
              continue;
            if (
              !options.ignored &&
              (parts.some((part) => ignoredNames.has(part)) ||
                isIgnored(
                  file,
                  await ignoreChain(
                    path.dirname(file),
                    owner?.path || folder,
                    options,
                  ),
                ))
            )
              continue;
            if (Buffer.byteLength(overlay.text) > limits.maxFileBytes) {
              limits.skippedLarge++;
              continue;
            }
            visited.add(file);
            append(
              await worker.match(overlay.text, {
                hostId: this.hostId,
                path: file,
                rootId: root.id,
                revision: overlay.revision || null,
                version: overlay.version,
              }),
            );
          }
          status.state = controller.signal.aborted
            ? "cancelled"
            : limits.truncated
              ? "limited"
              : "complete";
        } catch (e) {
          status.state = controller.signal.aborted ? "cancelled" : "failed";
          status.error = errorObject(e);
        }
        this.emit("host-event", { type: "search-root", requestId, ...status });
      }
      if (batch.length)
        this.emit("host-event", {
          type: "search-results",
          requestId,
          results: batch,
        });
      const response = {
        requestId,
        results,
        roots: statuses,
        limits,
        cancelled: controller.signal.aborted,
        complete:
          statuses.every((r) => r.state === "complete") && !limits.truncated,
      };
      this.emit("host-event", {
        type: "search-complete",
        ...response,
        results: undefined,
      });
      return response;
    } finally {
      worker.close();
      if (this.searches.get(requestId) === controller)
        this.searches.delete(requestId);
    }
  }
  async close() {
    for (const w of this.watchers.values()) w.close();
    for (const c of this.searches.values()) c.abort();
    await Promise.all(
      [...this.services.keys()].map((id) => this.stopService(id)),
    );
  }
}
export function compileSearch(query, options = {}) {
  if (typeof query !== "string" || !query.length)
    fail("EMPTY_QUERY", "Enter search text.");
  let source = options.regex
    ? query
    : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (options.wholeWord)
    source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
  try {
    return new RegExp(source, options.caseSensitive ? "gu" : "giu");
  } catch (e) {
    fail("INVALID_REGEX", e.message);
  }
}
export function findMatches(text, regex, meta) {
  const output = [];
  let resultChars = 0;
  regex.lastIndex = 0;
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++)
    if (text.charCodeAt(i) === 10) lineStarts.push(i + 1);
  let match;
  while ((match = regex.exec(text))) {
    const from = match.index,
      to = from + match[0].length;
    let lo = 0,
      hi = lineStarts.length;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >>> 1;
      if (lineStarts[mid] <= from) lo = mid;
      else hi = mid;
    }
    const lineStart = lineStarts[lo],
      lineEnd =
        lo + 1 < lineStarts.length ? lineStarts[lo + 1] - 1 : text.length;
    const snippetStart = Math.max(lineStart, from - 200),
      snippetEnd = Math.min(lineEnd, Math.max(to, from + 1) + 300);
    resultChars +=
      match[0].length +
      match.slice(1).reduce((n, g) => n + (g?.length || 0), 0) +
      Math.min(600, snippetEnd - snippetStart) +
      256;
    if (resultChars > 8 * 1024 * 1024) {
      output.limited = true;
      break;
    }
    output.push({
      ...meta,
      from,
      to,
      line: lo + 1,
      column: from - lineStart + 1,
      match: match[0],
      groups: match.slice(1),
      namedGroups: match.groups || {},
      snippet: text.slice(snippetStart, snippetEnd),
      snippetColumn: snippetStart - lineStart + 1,
    });
    if (!match[0].length) {
      if (regex.lastIndex >= text.length) break;
      regex.lastIndex += text.codePointAt(regex.lastIndex) > 0xffff ? 2 : 1;
    }
    if (output.length >= 10000) {
      output.limited = true;
      break;
    }
  }
  return output;
}
class RegexMatcher {
  constructor(regex, signal) {
    this.regex = regex;
    this.signal = signal;
    this.worker = new Worker(new URL("./regex-worker.mjs", import.meta.url));
    this.id = 0;
    this.pending = new Map();
    this.worker.on("message", (message) => {
      const p = this.pending.get(message.id);
      if (!p) return;
      this.pending.delete(message.id);
      clearTimeout(p.timer);
      message.error
        ? p.reject(
            Object.assign(new Error(message.error.message), message.error),
          )
        : p.resolve(
            Object.assign(message.result, { limited: message.limited }),
          );
    });
    this.worker.on("error", (error) => this.rejectAll(error));
    this.onAbort = () => {
      this.rejectAll(
        Object.assign(new Error("Search cancelled."), { code: "CANCELLED" }),
      );
      this.worker.terminate();
    };
    signal.addEventListener("abort", this.onAbort, { once: true });
  }
  match(text, meta) {
    if (this.signal.aborted)
      return Promise.reject(
        Object.assign(new Error("Search cancelled."), { code: "CANCELLED" }),
      );
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          Object.assign(
            new Error(
              "Pattern exceeded the 1.5 second per-file search limit. Refine the expression.",
            ),
            { code: "REGEX_TIMEOUT" },
          ),
        );
        this.worker.terminate();
      }, 1500);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({
        id,
        text,
        meta,
        source: this.regex.source,
        flags: this.regex.flags,
      });
    });
  }
  rejectAll(error) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
  }
  close() {
    this.signal.removeEventListener("abort", this.onAbort);
    this.rejectAll(new Error("Search closed."));
    this.worker.terminate();
  }
}
function globRegex(pattern) {
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        i++;
        source += ".*";
      } else source += "[^/]*";
    } else if (c === "?") source += "[^/]";
    else if (c === "{") source += "(?:";
    else if (c === "}") source += ")";
    else if (c === ",") source += "|";
    else source += c.replace(/[.()+^$|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + source + "$");
}
function patterns(value) {
  if (Array.isArray(value)) return value;
  const list = [];
  let current = "",
    depth = 0;
  for (const char of String(value || "")) {
    if (char === "{") depth++;
    if (char === "}") depth--;
    if ((char === ";" || char === ",") && depth === 0) {
      if (current.trim()) list.push(current.trim());
      current = "";
    } else current += char;
  }
  if (current.trim()) list.push(current.trim());
  return list;
}
function matchesFilters(relative, options) {
  const name = path.basename(relative);
  const masks = patterns(options.fileMask);
  if (
    masks.length &&
    !masks.some((p) => globRegex(p).test(p.includes("/") ? relative : name))
  )
    return false;
  const include = patterns(options.include);
  if (
    include.length &&
    !include.some(
      (p) =>
        relative === p ||
        relative.startsWith(p.replace(/\/$/, "") + "/") ||
        globRegex(p).test(relative),
    )
  )
    return false;
  const exclude = patterns(options.exclude);
  return !exclude.some(
    (p) =>
      relative === p ||
      relative.startsWith(p.replace(/\/$/, "") + "/") ||
      globRegex(p).test(relative),
  );
}
async function buildIgnore(root, options) {
  if (options.ignored) return [];
  const rules = [];
  for (const name of [".gitignore", ".ignore", ".isletignore"]) {
    try {
      for (const raw of (
        await fs.readFile(path.join(root, name), "utf8")
      ).split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith("#")) continue;
        rules.push({
          base: root,
          negative: line[0] === "!",
          pattern: line.replace(/^!|^\//g, "").replace(/\/$/, ""),
        });
      }
    } catch {}
  }
  return rules;
}
async function ignoreChain(folder, boundary, options) {
  if (options.ignored) return [];
  const result = [];
  const relative = path.relative(boundary, folder);
  const folders = [boundary];
  let next = boundary;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    next = path.join(next, part);
    folders.push(next);
  }
  for (const dir of folders) result.push(...(await buildIgnore(dir, options)));
  return result;
}
function isIgnored(file, rules) {
  let ignored = false;
  for (const r of rules) {
    const relative = path.relative(r.base, file);
    if (relative.startsWith(".." + path.sep) || path.isAbsolute(relative))
      continue;
    const parts = relative.split(path.sep);
    const regex = globRegex(r.pattern);
    if (
      regex.test(relative) ||
      (!r.pattern.includes("/") && parts.some((p) => regex.test(p))) ||
      relative.startsWith(r.pattern + "/")
    )
      ignored = !r.negative;
  }
  return ignored;
}
async function* walk(root, options, rules, signal, relative = "") {
  if (signal.aborted) return;
  const localRules = [...rules];
  if (relative && !options.ignored) {
    const nested = await buildIgnore(path.join(root, relative), options);
    for (const r of nested) localRules.push(r);
  }
  for (const e of await fs.readdir(path.join(root, relative), {
    withFileTypes: true,
  })) {
    if (signal.aborted) return;
    if (e.isSymbolicLink()) continue;
    const rel = path.join(relative, e.name);
    if (!options.hidden && e.name.startsWith(".")) continue;
    if (
      !options.ignored &&
      (ignoredNames.has(e.name) || isIgnored(path.join(root, rel), localRules))
    )
      continue;
    if (e.isDirectory()) {
      if (
        patterns(options.exclude).some(
          (p) => rel === p || rel.startsWith(p + "/"),
        )
      )
        continue;
      yield* walk(root, options, localRules, signal, rel);
    } else if (e.isFile() && matchesFilters(rel, options))
      yield path.join(root, rel);
  }
}
