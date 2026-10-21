import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const source = path.resolve(
  import.meta.dirname,
  "../src-tauri/icons/icon.icns",
);

export function inspectIcon(bytes) {
  assert.equal(bytes.toString("ascii", 0, 4), "icns", "App icon must be ICNS");
  assert.equal(bytes.readUInt32BE(4), bytes.length, "Invalid ICNS length");
  const representations = new Set();
  for (let offset = 8; offset < bytes.length;) {
    assert.ok(offset + 8 <= bytes.length, "Truncated ICNS element");
    const size = bytes.readUInt32BE(offset + 4);
    assert.ok(
      size > 8 && offset + size <= bytes.length,
      "Invalid ICNS element",
    );
    representations.add(bytes.toString("ascii", offset, offset + 4));
    offset += size;
  }
  // iconutil uses ARGB for 16/32 pixels and PNG for larger/Retina images.
  for (const types of [
    ["ic04", "icp4", "is32"],
    ["ic05", "icp5", "il32"],
    ["ic07"],
    ["ic08"],
    ["ic09"],
    ["ic10"],
    ["ic11"],
    ["ic12"],
    ["ic13"],
    ["ic14"],
  ])
    assert.ok(
      types.some((type) => representations.has(type)),
      `App icon is missing representation ${types.join("/")}`,
    );
  return [...representations].sort();
}

export async function verifyBundleIcon(app) {
  const { stdout } = await exec("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :CFBundleIconFile",
    path.join(app, "Contents/Info.plist"),
  ]);
  const name = stdout.trim();
  assert.ok(
    name && path.basename(name) === name,
    "Invalid bundle icon filename",
  );
  const file = path.join(
    app,
    "Contents/Resources",
    name.endsWith(".icns") ? name : name + ".icns",
  );
  const bytes = await fs.readFile(file);
  const representations = inspectIcon(bytes);
  assert.deepEqual(
    bytes,
    await fs.readFile(source),
    "Bundled app icon is stale",
  );
  return {
    file: path.basename(file),
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    representations,
  };
}
