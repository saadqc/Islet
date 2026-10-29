import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { Host } from "../remote-helper/host.mjs";

const tmp = await fs.realpath(await fs.mkdtemp("/tmp/islet-native-clipboard-"));
const dataDir = path.join(tmp, "data"),
  folder = path.join(tmp, "Project");
await fs.mkdir(folder);
await fs.writeFile(path.join(folder, "notes.txt"), "original");
const host = new Host({ cli: false, dataDir });
await host.request("recents.record", {
  path: folder,
  hostId: "local",
  kind: "folder",
});
await host.close();
const log = await fs.open("/tmp/islet-native-clipboard-run.log", "w");
const child = spawn(path.resolve("src-tauri/target/debug/islet"), [], {
  env: {
    ...process.env,
    ISLET_DATA_DIR: dataDir,
    ISLET_NATIVE_TEST_SCRIPT: path.resolve(
      "tests/backend/native-clipboard-smoke.js",
    ),
    CFFIXED_USER_HOME: path.join(tmp, "preferences"),
    ISLET_TEST_PASTEBOARD: "islet-text-test-" + crypto.randomUUID(),
  },
  stdio: ["ignore", log.fd, log.fd],
});
const timer = setTimeout(() => child.kill("SIGTERM"), 45000);
try {
  execFileSync("/usr/bin/swift", [
    "-e",
    `import AppKit; NSRunningApplication(processIdentifier: ${child.pid})?.activate(options: [.activateAllWindows])`,
  ]);
  const resultFile = path.join(
    dataDir,
    "sessions",
    crypto
      .createHash("sha256")
      .update("native-clipboard-result")
      .digest("hex") + ".json",
  );
  let report;
  for (let i = 0; i < 400; i++) {
    try {
      report = JSON.parse(await fs.readFile(resultFile, "utf8"));
      break;
    } catch {}
    if (child.exitCode !== null)
      throw Error(
        "Native app stopped before reporting; see /tmp/islet-native-clipboard-run.log",
      );
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(report, "Native clipboard report missing");
  assert.equal(report.passed, true, report.error);
  assert.equal(
    await fs.readFile(path.join(folder, "notes.txt"), "utf8"),
    "original",
  );
  console.log(JSON.stringify(report));
} finally {
  clearTimeout(timer);
  if (child.exitCode === null) child.kill("SIGTERM");
  await log.close();
}
