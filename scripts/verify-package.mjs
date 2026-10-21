import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { verifyBundleIcon } from "./app-icon.mjs";
const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const app = path.join(root, "src-tauri/target/release/bundle/macos/Islet.app");
const resource = path.join(app, "Contents/Resources");
const appIcon = await verifyBundleIcon(app);
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
async function entry(file) {
  const stat = await fs.stat(file);
  return {
    path: path.relative(root, file),
    bytes: stat.size,
    modified: stat.mtime.toISOString(),
    sha256: hash(await fs.readFile(file)),
  };
}
async function files(directory) {
  const result = [];
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) result.push(...(await files(file)));
    else if (item.isFile()) result.push(file);
  }
  return result.sort();
}
const helpers = (await files(path.join(root, "remote-helper"))).filter((file) =>
  file.endsWith(".mjs"),
);
const source = [
  ...(await files(path.join(root, "src"))),
  ...helpers,
  ...(await files(path.join(root, "scripts"))),
  ...(await files(path.join(root, "src-tauri/src"))),
  ...(await files(path.join(root, "src-tauri/icons"))),
  ...[
    "package.json",
    "package-lock.json",
    "src-tauri/Cargo.toml",
    "src-tauri/Cargo.lock",
    "src-tauri/tauri.conf.json",
    "src-tauri/build.rs",
    "src-tauri/capabilities/default.json",
  ].map((file) => path.join(root, file)),
];
const binaries = [
  path.join(root, "src-tauri/target/release/islet"),
  path.join(app, "Contents/MacOS/islet"),
];
const binaryEntries = await Promise.all(binaries.map(entry));
const runtimeSources = [
  ...(await files(path.join(root, "src"))),
  ...(await files(path.join(root, "src-tauri/src"))),
  ...(await files(path.join(root, "dist"))),
];
let newestRuntimeSource = 0;
for (const file of runtimeSources)
  newestRuntimeSource = Math.max(
    newestRuntimeSource,
    (await fs.stat(file)).mtimeMs,
  );
assert.ok(
  (await fs.stat(binaries[0])).mtimeMs >= newestRuntimeSource,
  "Release binary predates final UI/Rust/dist source; rebuild the executable",
);

function machoSections(bytes) {
  assert.equal(
    bytes.readUInt32LE(0),
    0xfeedfacf,
    "Expected 64-bit Mach-O executable",
  );
  const sections = [];
  let commandOffset = 32;
  for (let i = 0; i < bytes.readUInt32LE(16); i++) {
    const command = bytes.readUInt32LE(commandOffset),
      length = bytes.readUInt32LE(commandOffset + 4);
    if (command === 0x19) {
      const count = bytes.readUInt32LE(commandOffset + 64);
      for (let n = 0; n < count; n++) {
        const at = commandOffset + 72 + n * 80;
        const name = bytes
          .subarray(at, at + 16)
          .toString()
          .replace(/\0.*$/s, "");
        const segment = bytes
          .subarray(at + 16, at + 32)
          .toString()
          .replace(/\0.*$/s, "");
        const size = Number(bytes.readBigUInt64LE(at + 40)),
          offset = bytes.readUInt32LE(at + 48),
          flags = bytes.readUInt32LE(at + 64);
        if (!offset || !size || [1, 12, 18].includes(flags & 255)) continue;
        assert.ok(
          offset + size <= bytes.length,
          "Invalid Mach-O section bounds",
        );
        sections.push({
          name: segment + "," + name,
          offset,
          size,
          flags,
          sha256: hash(bytes.subarray(offset, offset + size)),
        });
      }
    }
    commandOffset += length;
  }
  return sections;
}
const executableSections = await Promise.all(
  binaries.map(async (file) => machoSections(await fs.readFile(file))),
);
assert.deepEqual(
  executableSections[0],
  executableSections[1],
  "Bundled executable code/data sections differ from release output",
);
for (const record of binaryEntries)
  record.sectionPayloadSha256 = hash(
    Buffer.from(JSON.stringify(executableSections[0])),
  );
const helperChecks = [];
for (const file of helpers) {
  const name = path.basename(file);
  const bundled = path.join(resource, "_up_/remote-helper", name);
  assert.equal(
    hash(await fs.readFile(file)),
    hash(await fs.readFile(bundled)),
    "Bundled helper differs: " + name,
  );
  helperChecks.push({ file: name, sha256: hash(await fs.readFile(file)) });
}
const cliSource = path.join(root, "scripts/islet.mjs"),
  cliBundled = path.join(resource, "_up_/scripts/islet.mjs");
assert.equal(
  hash(await fs.readFile(cliSource)),
  hash(await fs.readFile(cliBundled)),
  "Bundled CLI differs from current source",
);
const cliEntry = await entry(cliSource);
const remoteChecks = [];
const { version } = JSON.parse(
  await fs.readFile(path.join(root, "package.json"), "utf8"),
);
for (const arch of ["x64", "arm64"]) {
  const name = `islet-${version}-linux-${arch}.tar.gz`;
  const archive = path.join(root, "src-tauri/resources/remote", name),
    bundled = path.join(resource, "resources/remote", name);
  assert.equal(
    hash(await fs.readFile(archive)),
    hash(await fs.readFile(bundled)),
  );
  for (const helper of helpers.map((file) => path.basename(file))) {
    const extracted = await exec("tar", ["-xOf", archive, "./" + helper], {
      encoding: "buffer",
      maxBuffer: 8 * 1024 * 1024,
    });
    assert.equal(
      hash(extracted.stdout),
      hash(await fs.readFile(path.join(root, "remote-helper", helper))),
      "Remote archived helper differs: " + arch + "/" + helper,
    );
  }
  remoteChecks.push(await entry(archive));
}
const distEntries = await Promise.all(
  (await files(path.join(root, "dist"))).map(entry),
);
const index = await fs.readFile(path.join(root, "dist/index.html"), "utf8");
const asset = index.match(/src="\/assets\/([^"]+\.js)"/)?.[1];
assert.ok(asset, "Final index has no JavaScript entry");
const binary = await fs.readFile(binaries[1]);
assert.ok(
  binary.includes(Buffer.from(asset)),
  "Packaged executable does not contain final asset name " + asset,
);
await exec("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
const packageFiles = await files(app);
let packageBytes = 0;
for (const file of packageFiles) packageBytes += (await fs.stat(file)).size;
const allocated = await exec("du", ["-sk", app]);
const packageAllocatedBytes = Number.parseInt(allocated.stdout, 10) * 1024;
const report = {
  verified: true,
  date: new Date().toISOString(),
  app,
  entryAsset: asset,
  packageBytes,
  packageAllocatedBytes,
  source: await Promise.all(source.map(entry)),
  dist: distEntries,
  binaries: binaryEntries,
  executableSections: executableSections[0],
  helpers: helperChecks,
  cli: cliEntry,
  remotePackages: remoteChecks,
  appIcon,
  codeSignature:
    "Locally ad-hoc signed; codesign --verify --deep --strict passed",
  limitations: [
    "Not notarized or published.",
    "Physical IME/trackpad and Linux clean-host setup remain qualification gates.",
  ],
};
await fs.writeFile(
  path.join(root, "design/validation/package-manifest.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      verified: report.verified,
      entryAsset: asset,
      packageBytes,
      packageAllocatedBytes,
      app,
      binary: binaryEntries[1],
      helpers: helperChecks,
      cli: cliEntry,
      remotePackages: remoteChecks,
      appIcon,
    },
    null,
    2,
  ),
);
