import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { pipeline } from "node:stream/promises";

export const CHUNK = 512 * 1024;
const LEASE = 10 * 60 * 1000;
const fail = (code, message) => {
  throw Object.assign(new Error(message), { code });
};
const fingerprint = (s) => `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.mode}`;
const inside = (file, root) =>
  file === root || file.startsWith(root + path.sep);
function bytes(value) {
  if (
    typeof value !== "string" ||
    value.length > CHUNK * 1.4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  )
    fail("INVALID_CHUNK", "Invalid transfer data.");
  const buffer = Buffer.from(value, "base64");
  if (buffer.length > CHUNK)
    fail("INVALID_CHUNK", "Transfer chunk exceeds its limit.");
  return buffer;
}
export class Transfers {
  constructor(engine) {
    this.engine = engine;
    this.sessions = new Map();
  }
  async source(p) {
    return this.engine.scoped(p.path, {
      dependency: p.selected === true && !process.argv.includes("--remote"),
    });
  }
  async tree(p) {
    const root = await this.source(p),
      entries = [];
    const visit = async (file, name) => {
      if (entries.length >= 100000)
        fail("TRANSFER_LIMIT", "This transfer exceeds 100,000 entries.");
      const stat = await fs.lstat(file);
      const entry = {
        name,
        size: stat.size,
        mode: stat.mode,
        stamp: fingerprint(stat),
        type: stat.isDirectory()
          ? "directory"
          : stat.isSymbolicLink()
            ? "symlink"
            : stat.isFile()
              ? "file"
              : "unsupported",
      };
      if (entry.type === "unsupported")
        fail(
          "UNSUPPORTED_FILE",
          "Sockets and device files cannot be transferred.",
        );
      if (entry.type === "symlink") entry.link = await fs.readlink(file);
      entries.push(entry);
      if (entry.type === "directory")
        for (const item of (await fs.readdir(file)).sort())
          await visit(path.join(file, item), name ? name + "/" + item : item);
    };
    await visit(root, "");
    return { path: root, name: path.basename(root) || "folder", entries };
  }
  remember(state) {
    state.id = crypto.randomBytes(32).toString("hex");
    state.abort = new AbortController();
    this.sessions.set(state.id, state);
    this.touch(state);
    return state;
  }
  touch(state) {
    clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      void this.release(state.id);
    }, LEASE);
    state.timer.unref();
  }
  get(id, kind) {
    const state = this.sessions.get(id);
    if (!state || (kind && state.kind !== kind))
      fail("TRANSFER_EXPIRED", "This transfer expired. Start it again.");
    this.touch(state);
    return state;
  }
  async startExport(p) {
    const file = await this.source(p),
      stat = await fs.lstat(file);
    if (!stat.isFile() && !stat.isDirectory())
      fail("UNSUPPORTED_FILE", "Choose a regular file or folder.");
    if (p.expectedStamp && fingerprint(stat) !== p.expectedStamp)
      fail("SOURCE_CHANGED", "The source changed before copying.");
    const state = this.remember({
      kind: "export",
      status: "preparing",
      file,
      offset: 0,
      hash: crypto.createHash("sha256"),
      name: path.basename(file) + (stat.isDirectory() ? ".zip" : ""),
    });
    state.promise = (async () => {
      let exported = file;
      if (stat.isDirectory()) {
        state.temporary = await fs.mkdtemp(
          path.join(os.tmpdir(), "islet-export-"),
        );
        exported = path.join(state.temporary, "folder.zip");
        const manifest = await this.tree(p);
        if (state.abort.signal.aborted) throw new Error("Transfer cancelled");
        const require = createRequire(
          path.join(this.engine.runtimeDir, "package.json"),
        );
        const { ZipFile } = require("yazl");
        const zip = new ZipFile();
        zip.on("error", (error) => zip.outputStream.destroy(error));
        const output = pipeline(
          zip.outputStream,
          fsSync.createWriteStream(exported, { flags: "wx", mode: 0o600 }),
          { signal: state.abort.signal },
        );
        void output.catch(() => {});
        for (const entry of manifest.entries) {
          const archiveName =
            manifest.name + (entry.name ? "/" + entry.name : "");
          if (entry.type === "directory")
            zip.addEmptyDirectory(archiveName, { mode: entry.mode });
          else if (entry.type === "symlink")
            zip.addBuffer(Buffer.from(entry.link), archiveName, {
              mode: 0o120777,
              compress: false,
            });
          else
            zip.addReadStreamLazy(
              archiveName,
              { size: entry.size, mode: entry.mode },
              (callback) => {
                fs.open(
                  path.join(manifest.path, entry.name),
                  fsSync.constants.O_RDONLY |
                    (fsSync.constants.O_NOFOLLOW || 0),
                )
                  .then(async (handle) => {
                    if (fingerprint(await handle.stat()) !== entry.stamp) {
                      await handle.close();
                      throw new Error(
                        "The source changed while preparing the ZIP.",
                      );
                    }
                    callback(null, handle.createReadStream());
                  })
                  .catch((error) => callback(error));
              },
            );
        }
        zip.end();
        await output;
        for (const entry of manifest.entries)
          if (
            fingerprint(
              await fs.lstat(path.join(manifest.path, entry.name)),
            ) !== entry.stamp
          )
            fail(
              "SOURCE_CHANGED",
              "The folder changed while preparing the ZIP. Try again.",
            );
      }
      state.handle = await fs.open(
        exported,
        fsSync.constants.O_RDONLY | (fsSync.constants.O_NOFOLLOW || 0),
      );
      state.stamp = fingerprint(await state.handle.stat());
      state.size = (await state.handle.stat()).size;
      state.status = "ready";
    })().catch((error) => {
      state.status = "failed";
      state.error = error.message;
    });
    return { id: state.id, name: state.name, status: state.status };
  }
  exportStatus(id) {
    const s = this.get(id, "export");
    return { status: s.status, size: s.size, error: s.error };
  }
  async read(p) {
    const state = this.get(p.id, "export");
    if (state.status !== "ready")
      fail(
        "TRANSFER_NOT_READY",
        state.error || "The download is still being prepared.",
      );
    if (state.previous?.offset === p.offset) return state.previous.result;
    if (p.offset !== state.offset)
      fail("INVALID_OFFSET", "The transfer offset does not match.");
    if (state.offset === state.size) {
      if (fingerprint(await state.handle.stat()) !== state.stamp)
        fail("SOURCE_CHANGED", "The source changed during download.");
      state.digest ||= state.hash.digest("hex");
      return { offset: state.offset, eof: true, sha256: state.digest };
    }
    const buffer = Buffer.alloc(Math.min(CHUNK, state.size - state.offset));
    const { bytesRead } = await state.handle.read(
      buffer,
      0,
      buffer.length,
      state.offset,
    );
    if (!bytesRead)
      fail("SOURCE_CHANGED", "The source became incomplete during download.");
    const data = buffer.subarray(0, bytesRead),
      offset = state.offset;
    state.hash.update(data);
    state.offset += bytesRead;
    const result = {
      offset: state.offset,
      base64: data.toString("base64"),
      eof: false,
    };
    state.previous = { offset, result };
    return result;
  }
  async startImport(p) {
    const directory = await this.engine.scoped(p.directory, { write: true });
    if (
      !p.name ||
      path.basename(p.name) !== p.name ||
      [".", ".."].includes(p.name) ||
      /[\0\r\n]/.test(p.name)
    )
      fail("INVALID_PATH", "Choose a valid destination name.");
    const destination = path.join(directory, p.name);
    if (await exists(destination))
      fail(
        "DESTINATION_EXISTS",
        "An item with this name already exists. Rename it or choose another folder.",
      );
    const temporary = await fs.mkdtemp(path.join(directory, ".islet-copy-"));
    const root = path.join(temporary, p.name);
    if (p.directoryItem) await fs.mkdir(root);
    const state = this.remember({
      kind: "import",
      destination,
      temporary,
      root,
      directoryItem: !!p.directoryItem,
    });
    return { id: state.id };
  }
  async entry(p) {
    const state = this.get(p.id, "import");
    if (state.active) fail("TRANSFER_BUSY", "Finish the current file first.");
    const relative = p.name || "";
    if (
      path.isAbsolute(relative) ||
      relative.split(/[\\/]/).includes("..") ||
      relative.includes("\0")
    )
      fail("INVALID_PATH", "Invalid transfer entry path.");
    const target = path.resolve(state.root, relative);
    if (
      !inside(target, state.root) ||
      (!state.directoryItem && target !== state.root)
    )
      fail("INVALID_PATH", "Transfer entry escaped its destination.");
    if (target !== state.root) {
      const parent = await fs.realpath(path.dirname(target));
      if (!inside(parent, state.root))
        fail("INVALID_PATH", "Transfer entry traversed a symbolic link.");
    }
    if (p.type === "directory") {
      if (target !== state.root) await fs.mkdir(target);
      (state.directories ||= []).push({
        path: target,
        mode: (p.mode || 0o755) & 0o777,
      });
      return true;
    }
    if (p.type === "symlink") {
      if (
        typeof p.link !== "string" ||
        path.isAbsolute(p.link) ||
        !inside(path.resolve(path.dirname(target), p.link), state.root)
      )
        fail(
          "UNSAFE_SYMLINK",
          "A symbolic link points outside this folder and cannot be copied to another host.",
        );
      await fs.symlink(p.link, target);
      return true;
    }
    if (p.type !== "file" || !Number.isSafeInteger(p.size) || p.size < 0)
      fail("INVALID_ENTRY", "Invalid transfer entry.");
    state.active = {
      handle: await fs.open(target, "wx", 0o600),
      offset: 0,
      size: p.size,
      mode: (p.mode || 0o600) & 0o777,
      hash: crypto.createHash("sha256"),
    };
    return true;
  }
  async write(p) {
    const state = this.get(p.id, "import"),
      active = state.active;
    if (!active || active.offset !== p.offset)
      fail("INVALID_OFFSET", "The upload offset does not match.");
    const buffer = bytes(p.base64);
    if (active.offset + buffer.length > active.size)
      fail("INVALID_CHUNK", "The upload exceeds the declared file size.");
    await active.handle.writeFile(buffer);
    active.hash.update(buffer);
    active.offset += buffer.length;
    return { offset: active.offset };
  }
  async finishEntry(p) {
    const state = this.get(p.id, "import"),
      active = state.active;
    if (
      !active ||
      active.offset !== active.size ||
      active.hash.digest("hex") !== p.sha256
    )
      fail(
        "TRANSFER_INCOMPLETE",
        "The file transfer failed its size or checksum check.",
      );
    await active.handle.chmod(active.mode);
    await active.handle.sync();
    await active.handle.close();
    state.active = undefined;
    return true;
  }
  async commit(p) {
    const state = this.get(p.id, "import");
    if (state.active)
      fail("TRANSFER_INCOMPLETE", "A file is still being uploaded.");
    if (await exists(state.destination))
      fail(
        "DESTINATION_EXISTS",
        "An item with this name appeared during the copy. Nothing was replaced.",
      );
    // Files use an exclusive hard-link commit; directories remain staged until complete.
    if (state.directoryItem) {
      // Reserve the name exclusively: rename alone can overwrite an empty directory.
      await fs.mkdir(state.destination, { mode: 0o700 });
      try {
        for (const entry of await fs.readdir(state.root))
          await fs.rename(
            path.join(state.root, entry),
            path.join(state.destination, entry),
          );
        for (const dir of [...(state.directories || [])].reverse())
          await fs.chmod(
            path.join(state.destination, path.relative(state.root, dir.path)),
            dir.mode,
          );
      } catch (error) {
        await fs.rm(state.destination, { recursive: true, force: true });
        throw error;
      }
    } else {
      await fs.link(state.root, state.destination);
      await fs.unlink(state.root);
    }
    const destination = state.destination;
    await this.release(p.id);
    return { path: destination };
  }
  async release(id) {
    const state = this.sessions.get(id);
    if (!state) return;
    this.sessions.delete(id);
    clearTimeout(state.timer);
    state.abort.abort();
    await state.promise?.catch(() => {});
    await state.handle?.close().catch(() => {});
    await state.active?.handle.close().catch(() => {});
    if (state.temporary)
      await fs.rm(state.temporary, { recursive: true, force: true });
  }
  async request(operation, p) {
    if (operation === "tree") return this.tree(p);
    if (operation === "export") return this.startExport(p);
    if (operation === "status") return this.exportStatus(p.id);
    if (operation === "read") return this.read(p);
    if (operation === "import") return this.startImport(p);
    if (operation === "entry") return this.entry(p);
    if (operation === "write") return this.write(p);
    if (operation === "finish") return this.finishEntry(p);
    if (operation === "commit") return this.commit(p);
    if (operation === "release") return this.release(p.id).then(() => true);
    fail("UNKNOWN_TRANSFER", "Unknown transfer operation.");
  }
  async close() {
    await Promise.allSettled(
      [...this.sessions.keys()].map((id) => this.release(id)),
    );
  }
}
export const exists = (file) =>
  fs.lstat(file).then(
    () => true,
    (error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
export { fingerprint };
