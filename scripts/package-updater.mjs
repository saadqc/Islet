import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { verifyBundleIcon } from "./app-icon.mjs";
import { inspectBinary, NODE_VERSION } from "./setup-runtime.mjs";

const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
export const REPOSITORY = "saadqc/Islet";
export const digest = (bytes) =>
  crypto.createHash("sha256").update(bytes).digest("hex");

function semver(version) {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
      version,
    );
  if (!match) throw new Error("Invalid semantic version.");
  return { main: match.slice(1, 4).map(BigInt), pre: match[4]?.split(".") };
}
export function compareReleaseVersions(a, b) {
  const left = semver(a),
    right = semver(b);
  for (let i = 0; i < 3; i++)
    if (left.main[i] !== right.main[i])
      return left.main[i] > right.main[i] ? 1 : -1;
  if (!left.pre || !right.pre) return left.pre ? -1 : right.pre ? 1 : 0;
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const x = left.pre[i],
      y = right.pre[i];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const nx = /^\d+$/.test(x),
      ny = /^\d+$/.test(y);
    if (nx && ny) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (nx !== ny) return nx ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}
export function updaterNames(version) {
  semver(version);
  return {
    archive: `Islet_${version}_macos_arm64.app.tar.gz`,
    signature: `Islet_${version}_macos_arm64.app.tar.gz.sig`,
    feed: "latest.json",
    metadata: "updater-validation.json",
  };
}
function decodeBase64(text) {
  if (typeof text !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(text.trim()))
    throw new Error("Invalid base64 signature encoding.");
  return Buffer.from(text.trim(), "base64");
}
// Tauri's Minisign signatures use Ed25519 over a BLAKE2b-512 digest. The second
// signature authenticates the trusted comment, including the release version.
export function verifyUpdaterSignature(
  bytes,
  encodedSignature,
  encodedPublicKey,
  version,
) {
  semver(version);
  const publicLines = decodeBase64(encodedPublicKey)
    .toString("utf8")
    .trim()
    .split(/\r?\n/);
  const signatureLines = decodeBase64(encodedSignature)
    .toString("utf8")
    .trim()
    .split(/\r?\n/);
  if (
    publicLines.length !== 2 ||
    signatureLines.length !== 4 ||
    !signatureLines[2].startsWith("trusted comment: ")
  )
    throw new Error("Invalid Minisign signature.");
  const keyPacket = decodeBase64(publicLines[1]),
    packet = decodeBase64(signatureLines[1]),
    globalSignature = decodeBase64(signatureLines[3]);
  if (
    keyPacket.length !== 42 ||
    keyPacket.subarray(0, 2).toString() !== "Ed" ||
    packet.length !== 74 ||
    packet.subarray(0, 2).toString() !== "ED" ||
    globalSignature.length !== 64 ||
    !keyPacket.subarray(2, 10).equals(packet.subarray(2, 10))
  )
    throw new Error("Invalid Minisign key or algorithm.");
  const key = crypto.createPublicKey({
    key: Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      keyPacket.subarray(10),
    ]),
    type: "spki",
    format: "der",
  });
  const signature = packet.subarray(10),
    comment = signatureLines[2].slice("trusted comment: ".length);
  if (
    !crypto.verify(
      null,
      crypto.createHash("blake2b512").update(bytes).digest(),
      key,
      signature,
    ) ||
    !crypto.verify(
      null,
      Buffer.concat([signature, Buffer.from(comment)]),
      key,
      globalSignature,
    )
  )
    throw new Error("Updater signature verification failed.");
  const versions = comment
    .split("\t")
    .filter((field) => field.startsWith("version:"))
    .map((field) => field.slice(8));
  if (versions.length !== 1 || versions[0] !== version)
    throw new Error("Updater signed version does not match the release.");
  return true;
}
export function createFeed({
  version,
  signature,
  notes = "",
  pubDate = new Date().toISOString(),
}) {
  const names = updaterNames(version);
  return validateFeed({
    version,
    notes,
    pub_date: pubDate,
    platforms: {
      "darwin-aarch64": {
        signature,
        url: `https://github.com/${REPOSITORY}/releases/download/v${version}/${names.archive}`,
      },
    },
  });
}
export function validateFeed(feed) {
  const names = updaterNames(feed?.version);
  if (
    !feed ||
    typeof feed.notes !== "string" ||
    feed.notes.length > 100000 ||
    !Number.isFinite(Date.parse(feed.pub_date)) ||
    Object.keys(feed.platforms || {}).join() !== "darwin-aarch64"
  )
    throw new Error("Invalid updater manifest.");
  const artifact = feed.platforms["darwin-aarch64"];
  if (
    artifact.url !==
      `https://github.com/${REPOSITORY}/releases/download/v${feed.version}/${names.archive}` ||
    typeof artifact.signature !== "string" ||
    artifact.signature.length > 4096
  )
    throw new Error("Invalid updater artifact URL or signature.");
  decodeBase64(artifact.signature);
  return feed;
}
export function shouldAdvanceFeed(current, candidate) {
  validateFeed(candidate);
  if (!current) return true;
  validateFeed(current);
  return compareReleaseVersions(candidate.version, current.version) > 0;
}
export async function bundleManifest(directory) {
  const records = [];
  async function walk(relative) {
    for (const item of (
      await fs.readdir(path.join(directory, relative), { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = path.posix.join(relative, item.name),
        full = path.join(directory, name),
        stat = await fs.lstat(full);
      if (stat.isSymbolicLink()) {
        const target = await fs.readlink(full),
          resolved = path.resolve(path.dirname(full), target);
        if (
          path.isAbsolute(target) ||
          !resolved.startsWith(path.resolve(directory) + path.sep)
        )
          throw new Error("App contains an escaping symlink.");
        records.push({ name, link: target });
      } else if (stat.isDirectory()) {
        records.push({ name, directory: true, mode: stat.mode & 0o777 });
        await walk(name);
      } else if (stat.isFile())
        records.push({
          name,
          mode: stat.mode & 0o777,
          sha256: digest(await fs.readFile(full)),
        });
      else throw new Error("Unsupported app bundle entry.");
    }
  }
  await walk("");
  return records;
}
export async function packageUpdater({
  app = path.join(root, "src-tauri/target/release/bundle/macos/Islet.app"),
  outDir = path.join(root, "release-artifacts"),
} = {}) {
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw new Error("Updater packaging requires Apple silicon macOS.");
  if (
    !process.env.TAURI_SIGNING_PRIVATE_KEY &&
    !process.env.TAURI_SIGNING_PRIVATE_KEY_PATH
  )
    throw new Error("Updater signing key is not configured.");
  const version = JSON.parse(
      await fs.readFile(path.join(root, "package.json")),
    ).version,
    names = updaterNames(version);
  const config = JSON.parse(
      await fs.readFile(path.join(root, "src-tauri/tauri.conf.json")),
    ),
    publicKey = config.plugins?.updater?.pubkey;
  if (!publicKey || config.plugins?.updater?.requireSignedVersion !== true)
    throw new Error(
      "Updater public key and version binding must be configured.",
    );
  const dmgMetadata = JSON.parse(
    await fs.readFile(path.join(outDir, `Islet_${version}_macos_arm64.json`)),
  );
  if (
    dmgMetadata.version !== version ||
    dmgMetadata.validation?.dmgMounted !== true ||
    dmgMetadata.validation?.codeSignatureVerified !== true
  )
    throw new Error("The DMG must pass validation before updater packaging.");
  await exec("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
  await verifyBundleIcon(app);
  const original = await bundleManifest(app),
    archive = path.join(outDir, names.archive);
  const bundleSha256 = digest(Buffer.from(JSON.stringify(original)));
  if (dmgMetadata.bundleSha256 !== bundleSha256)
    throw new Error("Updater app differs from the mounted DMG app.");
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), "islet-updater-package-"),
  );
  try {
    await exec(
      "/usr/bin/tar",
      ["-czf", archive, "-C", path.dirname(app), path.basename(app)],
      {
        env: { ...process.env, COPYFILE_DISABLE: "1" },
        maxBuffer: 1024 * 1024,
      },
    );
    await exec("/usr/bin/tar", ["-xzf", archive, "-C", temporary]);
    const extracted = path.join(temporary, "Islet.app");
    if (
      JSON.stringify(await bundleManifest(extracted)) !==
      JSON.stringify(original)
    )
      throw new Error("Updater archive differs from the verified app.");
    await exec("/usr/bin/codesign", [
      "--verify",
      "--deep",
      "--strict",
      extracted,
    ]);
    await verifyBundleIcon(extracted);
    const plist = path.join(extracted, "Contents/Info.plist");
    for (const [key, expected] of [
      ["CFBundleShortVersionString", version],
      ["CFBundleIdentifier", config.identifier],
    ]) {
      const actual = (
        await exec("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, plist])
      ).stdout.trim();
      if (actual !== expected)
        throw new Error("Updater application identity does not match.");
    }
    if (
      inspectBinary(
        await fs.readFile(path.join(extracted, "Contents/MacOS/islet")),
      ).arch !== "arm64"
    )
      throw new Error("Updater architecture does not match.");
    const node = path.join(
      extracted,
      "Contents/Resources/resources/runtime/node",
    );
    if ((await exec(node, ["--version"])).stdout.trim() !== NODE_VERSION)
      throw new Error("Updater runtime does not match.");
    // The signer can print key-related diagnostics; never forward its output.
    try {
      await exec(
        process.execPath,
        [
          path.join(root, "node_modules/@tauri-apps/cli/tauri.js"),
          "signer",
          "sign",
          "--app-version",
          version,
          archive,
        ],
        { maxBuffer: 1024 * 1024 },
      );
    } catch {
      throw new Error(
        "Updater signing failed. Check configured signing secrets.",
      );
    }
    const signature = (await fs.readFile(archive + ".sig", "utf8")).trim(),
      bytes = await fs.readFile(archive);
    verifyUpdaterSignature(bytes, signature, publicKey, version);
    const feed = createFeed({
      version,
      signature,
      notes: await fs.readFile(
        path.join(root, "docs/RELEASE_NOTES.md"),
        "utf8",
      ),
    });
    await fs.writeFile(
      path.join(outDir, names.feed),
      JSON.stringify(feed, null, 2) + "\n",
    );
    const metadata = {
      version,
      commit: process.env.GITHUB_SHA || null,
      archive: names.archive,
      bytes: bytes.length,
      sha256: digest(bytes),
      bundleSha256,
      signatureVerified: true,
      signedVersion: version,
      bundleVerified: true,
    };
    await fs.writeFile(
      path.join(outDir, names.metadata),
      JSON.stringify(metadata, null, 2) + "\n",
    );
    console.log(
      JSON.stringify({
        updaterArchive: names.archive,
        signatureVerified: true,
        signedVersion: version,
        bundleVerified: true,
      }),
    );
    return metadata;
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
)
  await packageUpdater();
