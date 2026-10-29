import crypto from "node:crypto";
import path from "node:path";

export class RecentProjects {
  constructor(engine, emit) {
    this.engine = engine;
    this.emit = emit;
    this.queue = Promise.resolve();
  }
  async list() {
    await this.queue;
    return (
      (await this.engine.loadState("settings", "recent-projects"))?.entries ||
      []
    );
  }
  record(input) {
    const task = this.queue.then(async () => {
      const kind = input.kind === "workspace" ? "workspace" : "folder";
      const hostId = kind === "workspace" ? "local" : input.hostId || "local";
      const file = input.path;
      if (
        typeof file !== "string" ||
        !path.posix.isAbsolute(file) ||
        /[\0\r\n]/.test(file) ||
        typeof hostId !== "string" ||
        !/^(local|ssh:[\w.@:[\]-]+|codespace:[\w-]+)$/.test(hostId)
      )
        throw new Error("Invalid recent project location.");
      const canonical = path.posix.normalize(file);
      const id = crypto
        .createHash("sha256")
        .update(JSON.stringify([kind, hostId, canonical]))
        .digest("hex")
        .slice(0, 24);
      const entry = {
        id,
        kind,
        hostId,
        path: canonical,
        name: String(input.name || path.posix.basename(canonical) || canonical)
          .replace(/[\0\r\n]/g, " ")
          .slice(0, 160),
        ...(typeof input.interpreter === "string"
          ? { interpreter: input.interpreter }
          : {}),
        updated: Date.now(),
      };
      const previous =
        (await this.engine.loadState("settings", "recent-projects"))?.entries ||
        [];
      const entries = [
        entry,
        ...previous.filter((item) => item.id !== id),
      ].slice(0, 20);
      await this.engine.saveState("settings", "recent-projects", {
        schemaVersion: 1,
        entries,
      });
      this.emit("host-event", { type: "recent-projects", entries });
      return entries;
    });
    this.queue = task.catch(() => {});
    return task;
  }
  async get(id) {
    const entry = (await this.list()).find((item) => item.id === id);
    if (!entry) throw new Error("This recent project is no longer available.");
    return entry;
  }
}
