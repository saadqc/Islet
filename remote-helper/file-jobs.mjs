import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { exists, fingerprint } from "./transfers.mjs";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fail = (code, message) => {
  throw Object.assign(new Error(message), { code });
};
export class FileJobs {
  constructor(host) {
    this.host = host;
    this.jobs = new Map();
  }
  publish(job) {
    job.updated = Date.now();
    this.host.emit("host-event", {
      type: "file-transfer",
      job: this.summary(job),
    });
  }
  summary(job) {
    const {
      id,
      kind,
      status,
      phase,
      name,
      bytes,
      total,
      completed,
      error,
      result,
      updated,
    } = job;
    return {
      id,
      kind,
      status,
      phase,
      name,
      bytes,
      total,
      completed,
      error,
      result,
      updated,
    };
  }
  check(job) {
    if (job.cancelled) fail("TRANSFER_CANCELLED", "Transfer cancelled.");
  }
  start(kind, p, work) {
    const job = {
      id: crypto.randomUUID(),
      kind,
      status: "running",
      phase: "preparing",
      bytes: 0,
      total: 0,
      completed: [],
      name: p.name || path.basename(p.path || p.sources?.[0]?.path || "files"),
    };
    this.jobs.set(job.id, job);
    this.publish(job);
    job.promise = work
      .call(this, job, p)
      .then(
        (result) => {
          job.result = result;
          job.status = "complete";
          job.phase = "complete";
        },
        (error) => {
          job.status = job.cancelled ? "cancelled" : "failed";
          job.error = error.message;
        },
      )
      .finally(() => {
        this.publish(job);
        job.timer = setTimeout(() => this.jobs.delete(job.id), 60 * 60 * 1000);
        job.timer.unref();
      });
    return this.summary(job);
  }
  source(hostId, operation, payload = {}) {
    return this.host.request("transfer." + operation, { ...payload, hostId });
  }
  async openExport(job, hostId, p) {
    const selected = hostId === "local";
    const exported = await this.source(hostId, "export", { ...p, selected });
    try {
      for (;;) {
        this.check(job);
        const status = await this.source(hostId, "status", { id: exported.id });
        if (status.status === "failed") throw new Error(status.error);
        if (status.status === "ready")
          return { ...exported, size: status.size };
        await pause(100);
      }
    } catch (error) {
      await this.source(hostId, "release", { id: exported.id }).catch(() => {});
      throw error;
    }
  }
  async pump(job, sourceHost, source, consume) {
    let offset = 0;
    const hash = crypto.createHash("sha256");
    for (;;) {
      this.check(job);
      const chunk = await this.source(sourceHost, "read", {
        id: source.id,
        offset,
      });
      this.check(job);
      if (chunk.eof) {
        const digest = hash.digest("hex");
        if (offset !== source.size || digest !== chunk.sha256)
          fail(
            "CHECKSUM_FAILED",
            "The download failed its size or checksum check.",
          );
        return digest;
      }
      const data = Buffer.from(chunk.base64, "base64");
      await consume(data, offset);
      hash.update(data);
      offset = chunk.offset;
      job.bytes += data.length;
      this.publish(job);
    }
  }
  async download(job, p) {
    if (!p.destination || !path.isAbsolute(p.destination))
      fail("INVALID_DESTINATION", "Choose a local destination with Save As.");
    const parent = await fs.realpath(path.dirname(p.destination));
    const target = path.join(parent, path.basename(p.destination));
    const initial = await fs.lstat(target).catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
    if (initial && (!p.overwrite || !initial.isFile()))
      fail("DESTINATION_EXISTS", "Choose a new filename for this download.");
    const source = await this.openExport(job, p.hostId, { path: p.path });
    const temp = path.join(
      parent,
      "." + path.basename(target) + ".islet-download-" + job.id,
    );
    let handle;
    try {
      this.check(job);
      job.phase = "downloading";
      job.total = source.size;
      this.publish(job);
      handle = await fs.open(temp, "wx", initial ? initial.mode : 0o600);
      await this.pump(job, p.hostId, source, (data) => handle.writeFile(data));
      await handle.sync();
      await handle.close();
      handle = null;
      this.check(job);
      const current = await fs.lstat(target).catch((error) => {
        if (error.code !== "ENOENT") throw error;
        return null;
      });
      if (
        (initial &&
          (!current || fingerprint(current) !== fingerprint(initial))) ||
        (!initial && current)
      )
        fail(
          "DESTINATION_CHANGED",
          "The destination changed during download. Nothing was replaced.",
        );
      if (initial) await fs.rename(temp, target);
      else {
        await fs.link(temp, target);
        await fs.unlink(temp);
      }
      job.completed.push(target);
      return { path: target };
    } finally {
      await handle?.close().catch(() => {});
      await fs.unlink(temp).catch(() => {});
      await this.source(p.hostId, "release", { id: source.id }).catch(() => {});
    }
  }
  async copy(job, p) {
    if (
      !p.target?.hostId ||
      !p.target?.path ||
      !Array.isArray(p.sources) ||
      !p.sources.length
    )
      fail("INVALID_COPY", "Choose files and a destination folder.");
    for (const source of p.sources) {
      this.check(job);
      job.name = path.basename(source.path);
      const manifest = await this.source(source.hostId, "tree", {
        path: source.path,
        selected: source.hostId === "local",
      });
      if (
        source.hostId === p.target.hostId &&
        (p.target.path === manifest.path ||
          p.target.path.startsWith(manifest.path.replace(/\/$/, "") + "/"))
      )
        fail("RECURSIVE_COPY", "A folder cannot be copied into itself.");
      job.total += manifest.entries
        .filter((e) => e.type === "file")
        .reduce((sum, e) => sum + e.size, 0);
      this.publish(job);
      const imported = await this.source(p.target.hostId, "import", {
        directory: p.target.path,
        name: manifest.name,
        directoryItem: manifest.entries[0].type === "directory",
      });
      try {
        job.phase = "copying";
        for (const entry of manifest.entries) {
          this.check(job);
          await this.source(p.target.hostId, "entry", {
            ...entry,
            id: imported.id,
          });
          if (entry.type !== "file") continue;
          const exported = await this.openExport(job, source.hostId, {
            path: path.join(manifest.path, entry.name),
            expectedStamp: entry.stamp,
          });
          try {
            const sha256 = await this.pump(
              job,
              source.hostId,
              exported,
              (data, offset) =>
                this.source(p.target.hostId, "write", {
                  id: imported.id,
                  offset,
                  base64: data.toString("base64"),
                }),
            );
            await this.source(p.target.hostId, "finish", {
              id: imported.id,
              sha256,
            });
          } finally {
            await this.source(source.hostId, "release", {
              id: exported.id,
            }).catch(() => {});
          }
        }
        const fresh = await this.source(source.hostId, "tree", {
          path: source.path,
          selected: source.hostId === "local",
        });
        if (JSON.stringify(fresh.entries) !== JSON.stringify(manifest.entries))
          fail(
            "SOURCE_CHANGED",
            "The source changed during the copy. Its staged copy was discarded.",
          );
        this.check(job);
        const result = await this.source(p.target.hostId, "commit", {
          id: imported.id,
        });
        job.completed.push(result.path);
        this.publish(job);
      } finally {
        await this.source(p.target.hostId, "release", {
          id: imported.id,
        }).catch(() => {});
      }
    }
    return { paths: [...job.completed] };
  }
  async request(operation, p) {
    if (operation === "list")
      return [...this.jobs.values()]
        .filter((job) => job.status === "running")
        .map((job) => this.summary(job));
    if (operation === "download")
      return this.start("download", p, this.download);
    if (operation === "copy") return this.start("copy", p, this.copy);
    const job = this.jobs.get(p.id);
    if (!job) fail("TRANSFER_EXPIRED", "This transfer is no longer available.");
    if (operation === "status") return this.summary(job);
    if (operation === "cancel") {
      job.cancelled = true;
      this.publish(job);
      return this.summary(job);
    }
    fail("UNKNOWN_TRANSFER", "Unknown transfer operation.");
  }
  async close() {
    for (const job of this.jobs.values()) {
      job.cancelled = true;
      clearTimeout(job.timer);
    }
    await Promise.allSettled([...this.jobs.values()].map((job) => job.promise));
    for (const job of this.jobs.values()) clearTimeout(job.timer);
  }
}
