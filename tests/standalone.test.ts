import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DocumentStore } from "../src/core/documents";
// @ts-ignore Shared desktop/helper engine is JavaScript.
import { Engine } from "../remote-helper/engine.mjs";

test("explicit standalone files save without attaching their parent or authorizing siblings", async () => {
  const dir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "islet-standalone-")),
  );
  const engine = new Engine({ dataDir: path.join(dir, "data") });
  try {
    const file = path.join(dir, "selected.txt"),
      sibling = path.join(dir, "sibling.txt");
    await fs.writeFile(file, "original");
    await fs.writeFile(sibling, "private sibling");
    const store = new DocumentStore((operation, payload) =>
      engine.request(operation, payload),
    );
    const doc = await store.openStandalone(file, "window-one");
    assert.equal(doc.standalone, true);
    assert.equal(doc.readonly, false);
    assert.equal(engine.roots.size, 0);
    store.change(doc.id, "edited standalone");
    await store.save(doc.id);
    assert.equal(await fs.readFile(file, "utf8"), "edited standalone");
    await assert.rejects(engine.request("fs.list", { path: dir }), {
      code: "OUTSIDE_WORKSPACE",
    });
    const neighbor = await engine.request("file.read", { path: sibling });
    assert.equal(neighbor.readonly, true);
    await assert.rejects(
      engine.request("file.save", {
        path: sibling,
        text: "changed",
        expectedRevision: neighbor.revision,
      }),
      { code: "OUTSIDE_WORKSPACE" },
    );
    await assert.rejects(
      engine.request("fs.create", {
        path: path.join(dir, "new.txt"),
        text: "not authorized",
      }),
      { code: "OUTSIDE_WORKSPACE" },
    );
    await assert.rejects(engine.request("file.authorize", { path: dir }), {
      code: "NOT_A_FILE",
    });
    await engine.request("file.authorize", {
      path: file,
      clientId: "window-two",
    });
    await engine.request("root.closeClient", { clientId: "window-one" });
    assert.equal(
      (await engine.request("file.read", { path: file })).readonly,
      false,
    );
    await engine.request("root.closeClient", { clientId: "window-two" });
    assert.equal(
      (await engine.request("file.read", { path: file })).readonly,
      true,
    );
    assert.equal(engine.roots.size, 0);
    assert.equal(await fs.readFile(sibling, "utf8"), "private sibling");
    const remote = new Engine({
      hostId: "ssh:test",
      dataDir: path.join(dir, "remote-data"),
    });
    try {
      await assert.rejects(remote.request("file.authorize", { path: file }), {
        code: "LOCAL_ONLY",
      });
    } finally {
      await remote.close();
    }
  } finally {
    await engine.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
