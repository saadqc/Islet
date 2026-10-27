import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const tmp = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "islet-native-office-")),
  ),
  data = tmp + "/data",
  files = tmp + "/files";
await fs.mkdir(files);
await fs.copyFile("src/docx/blank.docx", files + "/native.docx");
await fs.writeFile(files + "/clipboard.txt", "Finder file URL clipboard\n");
await fs.mkdir(files + "/source-folder");
await fs.writeFile(
  files + "/source-folder/item.bin",
  Buffer.from([0, 1, 2, 255]),
);
await fs.mkdir(files + "/target");
await fs.writeFile(files + "/associated.csv", "code,value\n0012,7\n");
const bundle = path.resolve("src-tauri/target/debug/bundle/macos/Islet.app");
const log = await fs.open("/tmp/islet-office-native-run.log", "w");
const associations = process.env.ISLET_TEST_OPEN_WITH === "1";
const child = spawn(
  associations
    ? bundle + "/Contents/MacOS/islet"
    : path.resolve("src-tauri/target/debug/islet"),
  [process.env.ISLET_TEST_STANDALONE === "1" ? files + "/native.docx" : files],
  {
    env: {
      ...process.env,
      ISLET_DATA_DIR: data,
      ISLET_NATIVE_TEST_SCRIPT: path.resolve(
        "tests/backend/native-office-files-smoke.js",
      ),
      ISLET_TEST_PASTEBOARD: "islet-test-" + crypto.randomUUID(),
      CFFIXED_USER_HOME: tmp + "/preferences",
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    },
    stdio: ["ignore", log.fd, log.fd],
  },
);
await new Promise((resolve, reject) => {
  child.once("spawn", resolve);
  child.once("error", reject);
});
execFileSync("/usr/bin/swift", [
  "-e",
  `import AppKit; NSRunningApplication(processIdentifier: ${child.pid})?.activate(options: [.activateAllWindows])`,
]);
const exited = new Promise((r) => child.once("exit", r));
const ttl = setTimeout(() => child.kill("SIGTERM"), 65000);
const session = (key) =>
  data +
  "/sessions/" +
  crypto.createHash("sha256").update(key).digest("hex") +
  ".json";
let delivered = false,
  report;
try {
  for (let i = 0; i < 600; i++) {
    try {
      const stage = JSON.parse(
        await fs.readFile(session("native-office-stage"), "utf8"),
      );
      if (stage.ready && !delivered) {
        if (associations)
          execFileSync("/usr/bin/open", [
            "-a",
            bundle,
            files + "/associated.csv",
          ]);
        else {
          execFileSync(
            process.execPath,
            [
              "scripts/islet.mjs",
              "open",
              "--window",
              "main",
              files + "/associated.csv",
            ],
            { env: { ...process.env, ISLET_DATA_DIR: data } },
          );
        }
        delivered = true;
      }
    } catch {}
    try {
      report = JSON.parse(
        await fs.readFile(session("native-office-files-validation"), "utf8"),
      );
      break;
    } catch {}
    if (child.exitCode !== null)
      throw new Error("Native process exited " + child.exitCode);
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(report, "Native report missing");
  assert.equal(report.passed, true, JSON.stringify(report));
  assert.equal(delivered, true);
  if (associations)
    report.checks.push("Actual macOS LaunchServices Open With warm file event");
  assert.equal(
    await fs.readFile(files + "/target/clipboard.txt", "utf8"),
    "Finder file URL clipboard\n",
  );
  assert.deepEqual(
    await fs.readFile(files + "/target/source-folder/item.bin"),
    Buffer.from([0, 1, 2, 255]),
  );
  assert.match(
    execFileSync("/usr/bin/unzip", [
      "-p",
      files + "/native.docx",
      "word/document.xml",
    ]).toString(),
    /Native offline DOCX edit/,
  );
  const evidence =
    os.homedir() + "/islet-ui-screens/offline-docx-files-20261027";
  await fs.mkdir(evidence, { recursive: true });
  await fs.writeFile(
    evidence + "/native-report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  clearTimeout(ttl);
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    await exited;
  }
  await log.close();
  await fs.rm(tmp, { recursive: true, force: true });
}
