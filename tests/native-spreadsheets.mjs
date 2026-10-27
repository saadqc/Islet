import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "islet-native-sheets-"));
const data = path.join(tmp, "data"),
  files = path.join(tmp, "files");
await fs.mkdir(files, { recursive: true });
await fs.writeFile(path.join(files, "native.csv"), "code,amount\n0012,12\n");
for (const type of ["xls", "xlsx"]) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      ["Code", "Amount"],
      ["0007", 12.5],
    ]),
    "First",
  );
  await fs.writeFile(
    path.join(files, "native." + type),
    XLSX.write(book, { bookType: type, type: "buffer" }),
  );
}
const log = await fs.open("/tmp/islet-sheets-native-run.log", "w");
const child = spawn(path.resolve("src-tauri/target/debug/islet"), [files], {
  env: {
    ...process.env,
    ISLET_DATA_DIR: data,
    CFFIXED_USER_HOME: path.join(tmp, "preferences"),
    ISLET_NATIVE_TEST_SCRIPT: path.resolve(
      "tests/backend/native-spreadsheets-smoke.js",
    ),
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
  },
  stdio: ["ignore", log.fd, log.fd],
});
const exited = new Promise((resolve) => child.once("exit", resolve));
const ttl = setTimeout(() => child.kill("SIGTERM"), 45000);
const reportPath = path.join(
  data,
  "sessions",
  crypto
    .createHash("sha256")
    .update("native-spreadsheets-validation")
    .digest("hex") + ".json",
);
try {
  let report;
  for (let i = 0; i < 300; i++) {
    try {
      report = JSON.parse(await fs.readFile(reportPath, "utf8"));
      break;
    } catch {}
    if (child.exitCode !== null)
      throw new Error("Native app exited " + child.exitCode);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(report, "Native report missing");
  assert.equal(report.passed, true, JSON.stringify(report));
  for (const type of ["xls", "xlsx"])
    assert.equal(
      XLSX.read(await fs.readFile(path.join(files, "native." + type))).Sheets
        .First.B2.v,
      42.75,
    );
  assert.match(
    await fs.readFile(path.join(files, "native.csv"), "utf8"),
    /0012,42.75/,
  );
  assert.deepEqual(
    XLSX.read(await fs.readFile(path.join(files, "native.xlsx"))).SheetNames,
    ["First", "Native Renamed"],
  );
  const evidence = path.join(
    os.homedir(),
    "islet-ui-screens/offline-spreadsheets-20261027",
  );
  await fs.mkdir(evidence, { recursive: true });
  await fs.writeFile(
    path.join(evidence, "native-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  clearTimeout(ttl);
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    await exited;
  }
  await log.close();
  await fs.rm(tmp, { recursive: true, force: true });
}
