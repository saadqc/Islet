import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  REPOSITORY,
  digest,
  updaterNames,
  validateFeed,
  shouldAdvanceFeed,
  verifyUpdaterSignature,
} from "./package-updater.mjs";

const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");

export async function verifiedArtifacts({
  directory,
  version,
  commit,
  publicKey,
}) {
  const names = updaterNames(version),
    imageName = `Islet_${version}_macos_arm64.dmg`;
  const metadata = JSON.parse(
    await fs.readFile(
      path.join(directory, `Islet_${version}_macos_arm64.json`),
    ),
  );
  if (
    metadata.version !== version ||
    metadata.arch !== "arm64" ||
    metadata.platform !== "macos" ||
    metadata.commit !== commit ||
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
  const image = await fs.readFile(path.join(directory, imageName)),
    validated = metadata.artifacts?.find((item) => item.name === imageName);
  if (
    metadata.artifacts.length !== 1 ||
    !validated ||
    validated.bytes !== image.length ||
    validated.sha256 !== digest(image)
  )
    throw new Error("The DMG differs from package validation.");
  const archive = await fs.readFile(path.join(directory, names.archive)),
    signatureBytes = await fs.readFile(path.join(directory, names.signature));
  const signature = signatureBytes.toString("utf8").trim();
  verifyUpdaterSignature(archive, signature, publicKey, version);
  const updater = JSON.parse(
    await fs.readFile(path.join(directory, names.metadata)),
  );
  if (
    updater.version !== version ||
    updater.commit !== commit ||
    updater.archive !== names.archive ||
    updater.bytes !== archive.length ||
    updater.sha256 !== digest(archive) ||
    updater.signedVersion !== version ||
    updater.signatureVerified !== true ||
    updater.bundleVerified !== true ||
    !/^[a-f0-9]{64}$/.test(updater.bundleSha256) ||
    updater.bundleSha256 !== metadata.bundleSha256
  )
    throw new Error("Updater archive differs from validated DMG application.");
  const feedBytes = await fs.readFile(path.join(directory, names.feed)),
    feed = validateFeed(JSON.parse(feedBytes));
  if (
    feed.version !== version ||
    feed.platforms["darwin-aarch64"].signature !== signature
  )
    throw new Error("Updater feed does not match its signed artifact.");
  const contents = new Map([
    [imageName, image],
    [names.archive, archive],
    [names.signature, signatureBytes],
    [names.feed, feedBytes],
  ]);
  const checksum = Buffer.from(
    [...contents]
      .map(([name, bytes]) => `${digest(bytes)}  ${name}`)
      .join("\n") + "\n",
  );
  await fs.writeFile(path.join(directory, "SHA256SUMS.txt"), checksum);
  contents.set("SHA256SUMS.txt", checksum);
  return {
    feed,
    expected: new Map(
      [...contents].map(([name, bytes]) => [
        name,
        { bytes: bytes.length, sha256: digest(bytes) },
      ]),
    ),
  };
}
export function assertUploadedAssets(release, expected) {
  if (!Array.isArray(release.assets) || release.assets.length !== expected.size)
    throw new Error("Unexpected or missing release assets.");
  const seen = new Set();
  for (const asset of release.assets) {
    const record = expected.get(asset.name);
    if (
      !record ||
      seen.has(asset.name) ||
      asset.size !== record.bytes ||
      asset.digest !== `sha256:${record.sha256}`
    )
      throw new Error(
        `Uploaded asset failed size/hash verification: ${asset.name}`,
      );
    seen.add(asset.name);
  }
}
function notFound(error) {
  return String(error?.stderr || error?.message).includes("release not found");
}
export function githubApi(repo = REPOSITORY) {
  const gh = (args) =>
    exec("gh", [...args, "--repo", repo], { maxBuffer: 4 * 1024 * 1024 });
  return {
    async view(tag) {
      try {
        return JSON.parse(
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
      } catch (error) {
        if (notFound(error)) return null;
        throw error;
      }
    },
    async create(tag, { commit, feed = false, notesFile }) {
      await gh([
        "release",
        "create",
        tag,
        ...(feed ? ["--target", commit] : ["--verify-tag"]),
        "--draft",
        "--prerelease",
        "--latest=false",
        "--title",
        feed ? "Islet update channel" : `Islet ${tag.slice(1)} Preview`,
        ...(notesFile
          ? ["--notes-file", notesFile]
          : [
              "--notes",
              "Automatic update metadata. Download the DMG from the latest versioned release.",
            ]),
      ]);
    },
    async upload(tag, files) {
      await gh(["release", "upload", tag, ...files, "--clobber"]);
    },
    async publish(tag) {
      await gh([
        "release",
        "edit",
        tag,
        "--draft=false",
        "--prerelease",
        "--latest=false",
      ]);
    },
    async readFeed() {
      const temporary = await fs.mkdtemp(
        path.join(os.tmpdir(), "islet-published-feed-"),
      );
      try {
        const file = path.join(temporary, "latest.json");
        await gh([
          "release",
          "download",
          "updater",
          "--pattern",
          "latest.json",
          "--output",
          file,
        ]);
        return await fs.readFile(file);
      } finally {
        await fs.rm(temporary, { recursive: true, force: true });
      }
    },
  };
}
// Call only from the serialized publication job, after immutable artifacts have
// passed GitHub's uploaded-size/digest checks and the version release is public.
export async function advanceUpdateFeed({
  api,
  feed,
  directory,
  commit,
  expected,
}) {
  let channel = await api.view("updater"),
    current = null;
  if (channel) {
    const assets = channel.assets || [];
    if (assets.length) {
      const record = assets.find((asset) => asset.name === "latest.json");
      if (assets.length !== 1 || !record)
        throw new Error("Unexpected update channel assets.");
      const bytes = await api.readFeed();
      if (
        record.size !== bytes.length ||
        record.digest !== `sha256:${digest(bytes)}`
      )
        throw new Error("Published update feed digest mismatch.");
      current = validateFeed(JSON.parse(bytes));
    } else if (!channel.isDraft)
      throw new Error("Published update channel is missing its manifest.");
  }
  if (current && !shouldAdvanceFeed(current, feed)) {
    // A slow older workflow must never replace a newer channel. Equal versions
    // are idempotent only when the immutable signed artifact is unchanged.
    if (
      current.version === feed.version &&
      JSON.stringify(current.platforms) !== JSON.stringify(feed.platforms)
    )
      throw new Error("A published updater version cannot be replaced.");
    return { advanced: false, version: current.version };
  }
  if (!channel) {
    await api.create("updater", { commit, feed: true });
    channel = await api.view("updater");
  }
  if (!channel) throw new Error("Could not create update channel.");
  await api.upload("updater", [path.join(directory, "latest.json")]);
  channel = await api.view("updater");
  assertUploadedAssets(
    channel,
    new Map([["latest.json", expected.get("latest.json")]]),
  );
  if (channel.isDraft) await api.publish("updater");
  channel = await api.view("updater");
  if (channel?.isDraft || !channel?.isPrerelease)
    throw new Error("Update channel publication did not complete.");
  return { advanced: true, version: feed.version };
}
export async function publishVerifiedRelease({
  api,
  tag,
  version,
  commit,
  directory,
  notesFile,
  expected,
  feed,
}) {
  if (tag !== `v${version}` || feed.version !== version)
    throw new Error("Release version and tag must match.");
  let release = await api.view(tag);
  if (!release) {
    await api.create(tag, { commit, notesFile });
    release = await api.view(tag);
  }
  if (!release || (!release.isDraft && !release.isPrerelease))
    throw new Error("Refusing to replace a stable published release.");
  if (release.isDraft)
    await api.upload(
      tag,
      [...expected.keys()].map((name) => path.join(directory, name)),
    );
  release = await api.view(tag);
  assertUploadedAssets(release, expected);
  if (release.isDraft) await api.publish(tag);
  release = await api.view(tag);
  if (release?.isDraft || !release?.isPrerelease)
    throw new Error("Release publication did not complete.");
  const channel = await advanceUpdateFeed({
    api,
    feed,
    directory,
    commit,
    expected,
  });
  return {
    tag,
    url: release.url,
    channel,
    assets: [...expected].map(([name, info]) => ({ name, ...info })),
  };
}
async function main() {
  const version = JSON.parse(
      await fs.readFile(path.join(root, "package.json")),
    ).version,
    tag = process.env.GITHUB_REF_NAME,
    repo = process.env.GITHUB_REPOSITORY,
    commit = process.env.GITHUB_SHA;
  if (
    repo !== REPOSITORY ||
    tag !== `v${version}` ||
    !/^[a-f0-9]{40}$/.test(commit || "")
  )
    throw new Error(
      "Publishing requires the matching version tag and commit in saadqc/Islet.",
    );
  const config = JSON.parse(
      await fs.readFile(path.join(root, "src-tauri/tauri.conf.json")),
    ),
    directory = path.join(root, "release-artifacts");
  const { expected, feed } = await verifiedArtifacts({
    directory,
    version,
    commit,
    publicKey: config.plugins?.updater?.pubkey,
  });
  console.log(
    JSON.stringify(
      await publishVerifiedRelease({
        api: githubApi(repo),
        tag,
        version,
        commit,
        directory,
        notesFile: path.join(root, "docs/RELEASE_NOTES.md"),
        expected,
        feed,
      }),
      null,
      2,
    ),
  );
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
)
  await main();
