import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  archiveFor,
  inspectBinary,
  parseRuntimeArgs,
  verifyArchive,
  downloadArchive,
  sha256,
  NODE_VERSION,
} from "../scripts/setup-runtime.mjs";
import {
  releaseNames,
  validateReleaseIdentity,
  compareVersions,
  parsePackageArgs,
  detachImage,
} from "../scripts/package-release.mjs";
import { signPreview } from "../scripts/sign-preview.mjs";
function macho(arch, minimum = 0x000d0500) {
  const bytes = Buffer.alloc(64);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(arch === "arm64" ? 0x0100000c : 0x01000007, 4);
  bytes.writeUInt32LE(1, 16);
  bytes.writeUInt32LE(0x32, 32);
  bytes.writeUInt32LE(32, 36);
  bytes.writeUInt32LE(1, 40);
  bytes.writeUInt32LE(minimum, 44);
  return bytes;
}
function elf(arch) {
  const bytes = Buffer.alloc(64);
  Buffer.from([127, 69, 76, 70, 2, 1]).copy(bytes);
  bytes.writeUInt16LE(arch === "arm64" ? 183 : 62, 18);
  return bytes;
}
test("Node release targets are pinned independently of Actions host Node", () => {
  assert.equal(NODE_VERSION, "v24.12.0");
  for (const platform of ["darwin", "linux"])
    for (const arch of ["arm64", "x64"]) {
      const archive = archiveFor(platform, arch);
      assert.match(
        archive.url,
        new RegExp(
          `^https://nodejs.org/dist/v24.12.0/node-v24.12.0-${platform}-${arch}`,
        ),
      );
      assert.match(archive.sha256, /^[a-f0-9]{64}$/);
    }
  assert.throws(() => archiveFor("darwin", "universal"), /Unsupported runtime/);
});
test("runtime target parser rejects ambiguous or missing arguments", () => {
  assert.deepEqual(
    parseRuntimeArgs(["--arch", "x64", "--platform", "darwin"]),
    { arch: "x64", platform: "darwin" },
  );
  assert.deepEqual(parseRuntimeArgs(["--remote", "arm64"]), {
    remote: "arm64",
  });
  assert.throws(() => parseRuntimeArgs(["--remote"]), /requires a value/);
  assert.throws(
    () => parseRuntimeArgs(["--remote", "x64", "--arch", "arm64"]),
    /cannot be combined/,
  );
  assert.throws(() => parseRuntimeArgs(["--something"]), /Unknown runtime/);
});
test("binary inspection checks Mac and Linux architectures and Mac minimum", () => {
  for (const arch of ["arm64", "x64"]) {
    assert.deepEqual(inspectBinary(macho(arch)), {
      platform: "darwin",
      arch,
      minimumMacOS: "13.5.0",
    });
    assert.deepEqual(inspectBinary(elf(arch)), { platform: "linux", arch });
  }
  assert.throws(() => inspectBinary(Buffer.from("bad")), /truncated/);
  const corrupt = macho("x64");
  corrupt.writeUInt32LE(1000000, 36);
  assert.throws(() => inspectBinary(corrupt), /command size/);
});
test("checksum mismatch fails closed and corrupt cache is not trusted", async (t) => {
  const bytes = Buffer.from("fixture"),
    digest = sha256(bytes);
  assert.equal(verifyArchive(bytes, digest), digest);
  assert.throws(
    () => verifyArchive(bytes, "0".repeat(64)),
    /checksum mismatch/,
  );
  const cache = await fs.mkdtemp(
    path.join(os.tmpdir(), "islet-release-cache-"),
  );
  t.after(() => fs.rm(cache, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(cache, archiveFor("darwin", "x64").filename),
    bytes,
  );
  let fetched = false;
  await assert.rejects(
    downloadArchive("darwin", "x64", {
      cache,
      fetchImpl: () => {
        fetched = true;
        throw new Error("must not fetch");
      },
    }),
    /checksum mismatch/,
  );
  assert.equal(fetched, false);
});
test("HTTP failure cannot publish an unverified cached runtime", async (t) => {
  const cache = await fs.mkdtemp(path.join(os.tmpdir(), "islet-release-http-"));
  t.after(() => fs.rm(cache, { recursive: true, force: true }));
  await assert.rejects(
    downloadArchive("linux", "arm64", {
      cache,
      fetchImpl: async () => ({ ok: false, status: 503 }),
    }),
    /HTTP 503/,
  );
  assert.deepEqual(await fs.readdir(cache), []);
});
test("release artifact names and options are per architecture", () => {
  assert.deepEqual(releaseNames("0.1.0", "arm64"), {
    base: "Islet_0.1.0_macos_arm64",
    zip: "Islet_0.1.0_macos_arm64.zip",
    dmg: "Islet_0.1.0_macos_arm64.dmg",
    metadata: "Islet_0.1.0_macos_arm64.json",
    checksums: "SHA256SUMS_macos_arm64.txt",
  });
  assert.notEqual(
    releaseNames("0.1.0", "arm64").checksums,
    releaseNames("0.1.0", "x64").checksums,
  );
  assert.throws(() => releaseNames("../0.1.0", "x64"), /semantic/);
  assert.throws(() => releaseNames("v0.1.0", "x64"), /semantic/);
  assert.deepEqual(
    parsePackageArgs([
      "--app",
      "build/Islet.app",
      "--arch",
      "x64",
      "--out-dir",
      "release",
    ]),
    { app: "build/Islet.app", arch: "x64", outDir: "release" },
  );
  assert.throws(() => parsePackageArgs(["--arch"]), /requires a value/);
});
test("architecture and macOS minimum validation reject wrong builds", () => {
  const identity = {
    appArch: "arm64",
    nodeArch: "arm64",
    requestedArch: "arm64",
    runnerArch: "arm64",
    nodeVersion: NODE_VERSION,
    minimumSystemVersion: "13.5",
    nodeMinimumVersion: "13.5.0",
  };
  validateReleaseIdentity(identity);
  assert.throws(
    () => validateReleaseIdentity({ ...identity, nodeArch: "x64" }),
    /Architecture mismatch/,
  );
  assert.throws(
    () => validateReleaseIdentity({ ...identity, runnerArch: "x64" }),
    /Architecture mismatch/,
  );
  assert.throws(
    () => validateReleaseIdentity({ ...identity, nodeVersion: "v24.13.0" }),
    /Bundled Node/,
  );
  assert.throws(
    () =>
      validateReleaseIdentity({ ...identity, minimumSystemVersion: "12.0" }),
    /below bundled Node/,
  );
  assert.throws(
    () =>
      validateReleaseIdentity({
        ...identity,
        minimumSystemVersion: "13.5-bad",
      }),
    /Invalid minimum/,
  );
  assert.equal(compareVersions("13.5", "13.5.0"), 0);
  assert.ok(compareVersions("14.0", "13.5.0") > 0);
});
test("signing verifies the signed app and stops after a signing error", async () => {
  const commands = [];
  await signPreview("/tmp/Islet.app", {
    platform: "darwin",
    run: async (...args) => commands.push(args),
  });
  assert.deepEqual(commands, [
    [
      "/usr/bin/codesign",
      ["--force", "--deep", "--sign", "-", "/tmp/Islet.app"],
    ],
    ["/usr/bin/codesign", ["--verify", "--deep", "--strict", "/tmp/Islet.app"]],
  ]);
  let calls = 0;
  await assert.rejects(
    signPreview("/tmp/Islet.app", {
      platform: "darwin",
      run: async () => {
        calls++;
        throw new Error("sign fail");
      },
    }),
    /sign fail/,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    signPreview("relative.app", { platform: "darwin" }),
    /absolute/,
  );
  await assert.rejects(
    signPreview("/tmp/Islet.app", { platform: "linux" }),
    /requires macOS/,
  );
});
test("owned disk image cleanup retries transient busy mounts before forcing", async () => {
  const commands = [],
    delays = [];
  await detachImage("/owned/mount", {
    run: async (_bin, args) => {
      commands.push(args);
      if (commands.length < 3) throw new Error("Resource busy");
    },
    delay: async (ms) => delays.push(ms),
  });
  assert.deepEqual(delays, [250, 500]);
  assert.equal(commands.length, 3);
  assert.ok(commands.every((args) => !args.includes("-force")));
  commands.length = 0;
  await detachImage("/owned/mount", {
    run: async (_bin, args) => {
      commands.push(args);
      if (!args.includes("-force")) throw new Error("Resource busy");
    },
    delay: async () => {},
  });
  assert.equal(commands.length, 6);
  assert.deepEqual(commands.at(-1), ["detach", "-force", "/owned/mount"]);
  await assert.rejects(
    detachImage("/owned/mount", {
      run: async () => {
        throw new Error("still busy");
      },
      delay: async () => {},
    }),
    /still busy/,
  );
});
