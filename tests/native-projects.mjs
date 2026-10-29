import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { Host } from "../remote-helper/host.mjs";
const tmp = await fs.realpath(await fs.mkdtemp("/tmp/islet-native-projects-"));
const dataDir = path.join(tmp, "data");
const host = new Host({ cli: false, dataDir });
for (let i = 0; i < 6; i++) {
  const folder = path.join(tmp, "Project-" + i);
  await fs.mkdir(folder);
  await fs.writeFile(path.join(folder, "notes.txt"), "original");
  await host.request("recents.record", {
    path: folder,
    hostId: "local",
    kind: "folder",
  });
}
await host.close();
const log = await fs.open("/tmp/islet-native-projects-run.log", "w");
const child = spawn(path.resolve("src-tauri/target/debug/islet"), [], {
  env: {
    ...process.env,
    ISLET_DATA_DIR: dataDir,
    ISLET_NATIVE_TEST_SCRIPT: path.resolve(
      "tests/backend/native-projects-smoke.js",
    ),
    CFFIXED_USER_HOME: path.join(tmp, "preferences"),
  },
  stdio: ["ignore", log.fd, log.fd],
});
const timer = setTimeout(() => child.kill("SIGTERM"), 65000);
execFileSync("/usr/bin/swift", [
  "-e",
  `import AppKit; NSRunningApplication(processIdentifier: ${child.pid})?.activate(options: [.activateAllWindows])`,
]);
const resultFile = path.join(
  dataDir,
  "sessions",
  crypto.createHash("sha256").update("native-projects-result").digest("hex") +
    ".json",
);
try {
  let report;
  for (let i = 0; i < 600; i++) {
    try {
      report = JSON.parse(await fs.readFile(resultFile, "utf8"));
      break;
    } catch {}
    if (child.exitCode !== null)
      throw Error(
        "Native app stopped before reporting; see /tmp/islet-native-projects-run.log",
      );
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(report, "Native report missing");
  assert.equal(report.passed, true, report.error);
  // Wait for Keep Recovery and Close to actually destroy the final window.
  await Promise.race([
    new Promise((resolve) => {
      if (child.exitCode !== null) resolve();
      else child.once("exit", resolve);
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(Error("Dirty window did not close")), 10000),
    ),
  ]);
  const sessions = await fs.readdir(path.join(dataDir, "sessions"));
  const values = await Promise.all(
    sessions.map(async (name) =>
      JSON.parse(
        await fs.readFile(path.join(dataDir, "sessions", name), "utf8"),
      ),
    ),
  );
  assert.ok(
    values.some((value) =>
      value.documents?.some(
        (doc) => doc.text === "UNSAVED NATIVE RECOVERY" && doc.dirty,
      ),
    ),
  );
  assert.equal(
    await fs.readFile(path.join(tmp, "Project-5/notes.txt"), "utf8"),
    "original",
  );
  console.log(JSON.stringify(report));
} finally {
  clearTimeout(timer);
  if (child.exitCode === null) child.kill("SIGTERM");
  await log.close();
}
