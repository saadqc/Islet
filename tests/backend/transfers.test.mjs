import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { Host } from "../../remote-helper/host.mjs";
import { Engine } from "../../remote-helper/engine.mjs";
import { CHUNK } from "../../remote-helper/transfers.mjs";
async function fixture(t) {
  const directory = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "islet-transfer-test-")),
  );
  const host = new Host({ dataDir: directory + "/data", cli: false });
  const remote = new Engine({
    dataDir: directory + "/remote-data",
    hostId: "ssh:test",
  });
  await fs.mkdir(directory + "/local");
  await fs.mkdir(directory + "/remote");
  await fs.mkdir(directory + "/source");
  await host.request("root.open", { path: directory + "/local" });
  await remote.request("root.open", { path: directory + "/remote" });
  host.connections.set("ssh:test", {
    request: (op, p) => remote.request(op, p),
    close: () => remote.close(),
  });
  t.after(async () => {
    await host.close();
    await remote.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { directory, host, remote };
}
async function job(host, op, p) {
  const started = await host.request(op, p);
  const state = host.files.jobs.get(started.id);
  await state.promise;
  return host.files.summary(state);
}
test("chunked local and remote folder copy preserves bytes, empty directories and links; collisions never overwrite", async (t) => {
  const { directory: d, host, remote } = await fixture(t);
  const bytes = crypto.randomBytes(CHUNK * 3 + 17);
  await fs.mkdir(d + "/source/nested");
  await fs.mkdir(d + "/source/empty");
  await fs.writeFile(d + "/source/nested/data.xlsx", bytes);
  await fs.symlink("nested/data.xlsx", d + "/source/link");
  let result = await job(host, "files.copy", {
    sources: [{ hostId: "local", path: d + "/source" }],
    target: { hostId: "ssh:test", path: d + "/remote" },
  });
  assert.equal(result.status, "complete", result.error);
  assert.deepEqual(
    await fs.readFile(d + "/remote/source/nested/data.xlsx"),
    bytes,
  );
  assert.equal(
    await fs.readlink(d + "/remote/source/link"),
    "nested/data.xlsx",
  );
  assert.equal((await fs.stat(d + "/remote/source/empty")).isDirectory(), true);
  result = await job(host, "files.copy", {
    sources: [{ hostId: "ssh:test", path: d + "/remote/source" }],
    target: { hostId: "local", path: d + "/local" },
  });
  assert.equal(result.status, "complete", result.error);
  assert.deepEqual(
    await fs.readFile(d + "/local/source/nested/data.xlsx"),
    bytes,
  );
  result = await job(host, "files.copy", {
    sources: [{ hostId: "local", path: d + "/source" }],
    target: { hostId: "local", path: d + "/local" },
  });
  assert.equal(result.status, "failed");
  assert.match(result.error, /already exists/);
  assert.deepEqual(
    await fs.readFile(d + "/local/source/nested/data.xlsx"),
    bytes,
  );
  assert.equal(remote.transfers.sessions.size, 0);
  assert.equal(host.engine.transfers.sessions.size, 0);
});
test("remote folder download prepares ZIP remotely and cleans its temporary archive", async (t) => {
  const { directory: d, host, remote } = await fixture(t);
  await fs.mkdir(d + "/remote/folder");
  await fs.writeFile(d + "/remote/folder/report.csv", "id,value\n0001,12\n");
  await fs.mkdir(d + "/remote/folder/empty");
  await fs.symlink("/outside/not-read", d + "/remote/folder/link");
  let temporary;
  const original = remote.transfers.startExport.bind(remote.transfers);
  remote.transfers.startExport = async (p) => {
    const r = await original(p);
    const state = remote.transfers.sessions.get(r.id);
    await state.promise;
    temporary = state.temporary;
    return r;
  };
  const result = await job(host, "files.download", {
    hostId: "ssh:test",
    path: d + "/remote/folder",
    destination: d + "/download.zip",
  });
  assert.equal(result.status, "complete", result.error);
  assert.equal(
    execFileSync("/usr/bin/unzip", [
      "-p",
      d + "/download.zip",
      "folder/report.csv",
    ]).toString(),
    "id,value\n0001,12\n",
  );
  assert.equal(
    execFileSync("/usr/bin/unzip", [
      "-p",
      d + "/download.zip",
      "folder/link",
    ]).toString(),
    "/outside/not-read",
  );
  await assert.rejects(fs.stat(temporary), { code: "ENOENT" });
  assert.equal(remote.transfers.sessions.size, 0);
});
test("cancelled copies discard staging, preserve source, and release transfer tokens", async (t) => {
  const { directory: d, host, remote } = await fixture(t);
  await fs.writeFile(d + "/source/big.bin", crypto.randomBytes(CHUNK * 3));
  const write = remote.transfers.write.bind(remote.transfers);
  let started;
  remote.transfers.write = async (p) => {
    const r = await write(p);
    await host.request("files.cancel", { id: started.id });
    return r;
  };
  started = await host.request("files.copy", {
    sources: [{ hostId: "local", path: d + "/source/big.bin" }],
    target: { hostId: "ssh:test", path: d + "/remote" },
  });
  await host.files.jobs.get(started.id).promise;
  assert.equal(
    (await host.request("files.status", { id: started.id })).status,
    "cancelled",
  );
  assert.deepEqual(await fs.readdir(d + "/remote"), []);
  assert.equal(remote.transfers.sessions.size, 0);
  assert.equal(host.engine.transfers.sessions.size, 0);
});
test("uploads reject traversal and source mutations fail without publishing a partial destination", async (t) => {
  const { directory: d, host, remote } = await fixture(t);
  const imported = await remote.request("transfer.import", {
    directory: d + "/remote",
    name: "copy",
    directoryItem: true,
  });
  await assert.rejects(
    remote.request("transfer.entry", {
      id: imported.id,
      name: "../escape",
      type: "file",
      size: 1,
    }),
    { code: "INVALID_PATH" },
  );
  await remote.request("transfer.release", { id: imported.id });
  await fs.writeFile(d + "/source/file.bin", crypto.randomBytes(CHUNK + 17));
  const read = host.engine.transfers.read.bind(host.engine.transfers);
  let mutated = false;
  host.engine.transfers.read = async (p) => {
    const r = await read(p);
    if (!mutated) {
      mutated = true;
      await fs.appendFile(d + "/source/file.bin", "changed");
    }
    return r;
  };
  const result = await job(host, "files.copy", {
    sources: [{ hostId: "local", path: d + "/source/file.bin" }],
    target: { hostId: "ssh:test", path: d + "/remote" },
  });
  assert.equal(result.status, "failed");
  assert.match(result.error, /changed/);
  assert.deepEqual(await fs.readdir(d + "/remote"), []);
});
test("DOCX binary read/save preserves original backup and detects external conflicts", async (t) => {
  const { directory: d, host } = await fixture(t);
  const original = await fs.readFile("src/docx/blank.docx");
  await fs.writeFile(d + "/local/word.docx", original);
  const doc = await host.request("file.read", {
    path: d + "/local/word.docx",
    binary: true,
  });
  assert.equal(doc.text, original.toString("base64"));
  const edited = Buffer.concat([original, Buffer.from("roundtrip")]);
  await host.request("file.save", {
    path: d + "/local/word.docx",
    binary: true,
    text: edited.toString("base64"),
    expectedRevision: doc.revision,
  });
  assert.deepEqual(await fs.readFile(d + "/local/word.docx"), edited);
  const hash = crypto
    .createHash("sha256")
    .update(d + "/local/word.docx")
    .digest("hex");
  const files = await fs.readdir(d + "/data/document-backups/" + hash);
  assert.equal(files.length, 1);
  assert.deepEqual(
    await fs.readFile(d + "/data/document-backups/" + hash + "/" + files[0]),
    original,
  );
  await assert.rejects(
    host.request("file.save", {
      path: d + "/local/word.docx",
      binary: true,
      text: doc.text,
      expectedRevision: doc.revision,
    }),
    { code: "REVISION_CONFLICT" },
  );
});
