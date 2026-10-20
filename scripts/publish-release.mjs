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
const imageName = `Islet_${version}_macos_arm64.dmg`;
const digest = (bytes) =>
  crypto.createHash("sha256").update(bytes).digest("hex");
const metadata = JSON.parse(
  await fs.readFile(
    path.join(directory, `Islet_${version}_macos_arm64.json`),
    "utf8",
  ),
);
if (
  metadata.version !== version ||
  metadata.arch !== "arm64" ||
  metadata.platform !== "macos" ||
  metadata.commit !== process.env.GITHUB_SHA ||
  metadata.signing?.verified !== true ||
  metadata.signing.notarized !== false ||
  ![
    "dmgVerified",
    "dmgMounted",
    "codeSignatureVerified",
    "runtimeExecuted",
  ].every((key) => metadata.validation?.[key] === true)
)
  throw new Error("Invalid Apple silicon release validation metadata.");
const image = await fs.readFile(path.join(directory, imageName));
const validated = metadata.artifacts?.find((item) => item.name === imageName);
if (
  metadata.artifacts.length !== 1 ||
  !validated ||
  validated.bytes !== image.length ||
  validated.sha256 !== digest(image)
)
  throw new Error("The DMG differs from package validation.");
const checksumName = "SHA256SUMS.txt";
const checksum = Buffer.from(`${digest(image)}  ${imageName}\n`);
await fs.writeFile(path.join(directory, checksumName), checksum);
const expected = new Map([
  [imageName, { bytes: image.length, sha256: digest(image) }],
  [checksumName, { bytes: checksum.length, sha256: digest(checksum) }],
]);
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
// Resume an interrupted draft; an already published prerelease must match exactly.
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
