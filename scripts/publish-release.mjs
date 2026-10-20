import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const version = JSON.parse(
  await fs.readFile(path.join(root, "package.json"), "utf8"),
).version;
const tag = process.env.GITHUB_REF_NAME;
const repo = process.env.GITHUB_REPOSITORY;
if (repo !== "saadqc/Islet" || tag !== `v${version}`)
  throw new Error(
    "Publishing requires the matching version tag in saadqc/Islet.",
  );
const directory = path.join(root, "release-artifacts");
const names = ["arm64", "x64"].flatMap((arch) => [
  ...["zip", "dmg", "json"].map(
    (ext) => `Islet_${version}_macos_${arch}.${ext}`,
  ),
  `SHA256SUMS_macos_${arch}.txt`,
]);
const digest = (bytes) =>
  crypto.createHash("sha256").update(bytes).digest("hex");
for (const arch of ["arm64", "x64"]) {
  const metadata = JSON.parse(
    await fs.readFile(
      path.join(directory, `Islet_${version}_macos_${arch}.json`),
      "utf8",
    ),
  );
  if (
    metadata.version !== version ||
    metadata.arch !== arch ||
    metadata.platform !== "macos" ||
    metadata.commit !== process.env.GITHUB_SHA ||
    !metadata.signing?.verified ||
    metadata.signing.notarized !== false ||
    ![
      "zipExtracted",
      "dmgVerified",
      "dmgMounted",
      "codeSignatureVerified",
      "runtimeExecuted",
    ].every((key) => metadata.validation?.[key] === true)
  )
    throw new Error(`Invalid release metadata for ${arch}.`);
  for (const ext of ["zip", "dmg"]) {
    const name = `Islet_${version}_macos_${arch}.${ext}`;
    const expected = metadata.artifacts.find((item) => item.name === name);
    const bytes = await fs.readFile(path.join(directory, name));
    if (
      !expected ||
      expected.bytes !== bytes.length ||
      expected.sha256 !== digest(bytes)
    )
      throw new Error(`Artifact differs from package validation: ${name}`);
  }
}
const expected = new Map();
const sums = [];
for (const name of names.sort()) {
  const bytes = await fs.readFile(path.join(directory, name));
  if (!bytes.length) throw new Error(`Empty release asset: ${name}`);
  expected.set(name, { bytes: bytes.length, sha256: digest(bytes) });
  sums.push(`${digest(bytes)}  ${name}`);
}
const checksumName = "SHA256SUMS.txt";
const checksumBytes = Buffer.from(sums.join("\n") + "\n");
await fs.writeFile(path.join(directory, checksumName), checksumBytes);
expected.set(checksumName, {
  bytes: checksumBytes.length,
  sha256: digest(checksumBytes),
});
const gh = (args) =>
  exec("gh", [...args, "--repo", repo], { maxBuffer: 4 * 1024 * 1024 });
const inspect = async () =>
  JSON.parse(
    (
      await gh([
        "release",
        "view",
        tag,
        "--json",
        "isDraft,isPrerelease,assets,url",
      ])
    ).stdout,
  );
let release;
try {
  release = await inspect();
} catch (error) {
  if (!String(error.stderr).includes("release not found")) throw error;
  await gh([
    "release",
    "create",
    tag,
    "--verify-tag",
    "--draft",
    "--prerelease",
    "--title",
    `Islet ${version} Preview`,
    "--notes-file",
    path.join(root, "docs/RELEASE_NOTES.md"),
  ]);
  release = await inspect();
}
if (!release.isDraft && !release.isPrerelease)
  throw new Error("Refusing to replace a stable published release.");
// An interrupted draft can be resumed. A published prerelease must already match exactly.
if (release.isDraft)
  await gh([
    "release",
    "upload",
    tag,
    ...[...expected.keys()].map((name) => path.join(directory, name)),
    "--clobber",
  ]);
release = await inspect();
if (release.assets.length !== expected.size)
  throw new Error("Unexpected or missing release assets.");
for (const asset of release.assets) {
  const item = expected.get(asset.name);
  if (
    !item ||
    asset.size !== item.bytes ||
    asset.digest !== `sha256:${item.sha256}`
  )
    throw new Error(
      `Uploaded asset failed size/hash verification: ${asset.name}`,
    );
}
if (release.isDraft)
  await gh([
    "release",
    "edit",
    tag,
    "--draft=false",
    "--prerelease",
    "--title",
    `Islet ${version} Preview`,
    "--notes-file",
    path.join(root, "docs/RELEASE_NOTES.md"),
  ]);
release = await inspect();
if (release.isDraft || !release.isPrerelease)
  throw new Error("Release publication did not complete.");
console.log(
  JSON.stringify(
    {
      tag,
      url: release.url,
      assets: [...expected].map(([name, info]) => ({ name, ...info })),
    },
    null,
    2,
  ),
);
