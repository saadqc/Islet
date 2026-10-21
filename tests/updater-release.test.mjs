import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  bundleManifest,
  compareReleaseVersions,
  createFeed,
  digest,
  shouldAdvanceFeed,
  updaterNames,
  validateFeed,
  verifyUpdaterSignature,
} from "../scripts/package-updater.mjs";
import {
  advanceUpdateFeed,
  assertUploadedAssets,
  publishVerifiedRelease,
  verifiedArtifacts,
} from "../scripts/publish-release.mjs";
const exec = promisify(execFile);
const version = "1.2.3";
function signed(bytes = Buffer.from("app archive"), signedVersion = version) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const keyId = crypto.randomBytes(8),
    rawKey = publicKey.export({ type: "spki", format: "der" }).subarray(-32);
  const key = Buffer.from(
    `untrusted comment: test key\n${Buffer.concat([Buffer.from("Ed"), keyId, rawKey]).toString("base64")}\n`,
  ).toString("base64");
  const signature = crypto.sign(
    null,
    crypto.createHash("blake2b512").update(bytes).digest(),
    privateKey,
  );
  const comment = `timestamp:1\tfile:archive\tversion:${signedVersion}`;
  const global = crypto.sign(
    null,
    Buffer.concat([signature, Buffer.from(comment)]),
    privateKey,
  );
  const encoded = Buffer.from(
    `untrusted comment: test signature\n${Buffer.concat([Buffer.from("ED"), keyId, signature]).toString("base64")}\ntrusted comment: ${comment}\n${global.toString("base64")}\n`,
  ).toString("base64");
  return { key, signature: encoded, bytes };
}

test("updater signatures authenticate bytes, key and trusted version", () => {
  const fixture = signed();
  assert.equal(
    verifyUpdaterSignature(
      fixture.bytes,
      fixture.signature,
      fixture.key,
      version,
    ),
    true,
  );
  assert.throws(
    () =>
      verifyUpdaterSignature(
        Buffer.from("changed app"),
        fixture.signature,
        fixture.key,
        version,
      ),
    /verification/,
  );
  assert.throws(
    () =>
      verifyUpdaterSignature(
        fixture.bytes,
        fixture.signature,
        signed().key,
        version,
      ),
    /key/,
  );
  assert.throws(
    () =>
      verifyUpdaterSignature(
        fixture.bytes,
        fixture.signature,
        fixture.key,
        "2.0.0",
      ),
    /signed version/,
  );
  const changed = Buffer.from(fixture.signature, "base64")
    .toString()
    .replace("version:1.2.3", "version:2.0.0");
  assert.throws(
    () =>
      verifyUpdaterSignature(
        fixture.bytes,
        Buffer.from(changed).toString("base64"),
        fixture.key,
        "2.0.0",
      ),
    /verification/,
  );
});

test("actual Tauri CLI signatures interoperate with release verification", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "islet-signature-test-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const cli = path.resolve("node_modules/@tauri-apps/cli/tauri.js"),
    key = path.join(directory, "key"),
    artifact = path.join(directory, "app.tar.gz");
  const bytes = Buffer.from("actual Tauri signing fixture");
  await fs.writeFile(artifact, bytes);
  const env = {
    ...process.env,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "test-fixture",
    TAURI_SIGNING_PRIVATE_KEY_PATH: key,
  };
  delete env.TAURI_SIGNING_PRIVATE_KEY;
  await exec(
    process.execPath,
    [
      cli,
      "signer",
      "generate",
      "--ci",
      "--password",
      "test-fixture",
      "--write-keys",
      key,
    ],
    { env },
  );
  await exec(
    process.execPath,
    [cli, "signer", "sign", "--app-version", version, artifact],
    { env },
  );
  const publicKey = (await fs.readFile(key + ".pub", "utf8")).trim(),
    signature = (await fs.readFile(artifact + ".sig", "utf8")).trim();
  assert.equal(
    verifyUpdaterSignature(bytes, signature, publicKey, version),
    true,
  );
  assert.throws(
    () => verifyUpdaterSignature(bytes, signature, publicKey, "1.2.4"),
    /signed version/,
  );
});

test("feed permits only versioned Apple silicon artifacts from the release repository", () => {
  const feed = createFeed({ version, signature: signed().signature });
  assert.equal(validateFeed(feed), feed);
  assert.throws(
    () =>
      validateFeed({
        ...feed,
        platforms: { "darwin-x86_64": feed.platforms["darwin-aarch64"] },
      }),
    /manifest/,
  );
  assert.throws(
    () =>
      validateFeed({
        ...feed,
        platforms: {
          "darwin-aarch64": {
            ...feed.platforms["darwin-aarch64"],
            url: "https://example.com/app.tar.gz",
          },
        },
      }),
    /URL/,
  );
  assert.throws(() => updaterNames("../escape"), /version/);
});

test("release ordering rejects downgrades and respects prerelease SemVer", () => {
  const feed = (v) => createFeed({ version: v, signature: signed().signature });
  assert.equal(shouldAdvanceFeed(feed("1.10.0"), feed("1.9.99")), false);
  assert.equal(shouldAdvanceFeed(feed("1.2.3"), feed("1.2.3")), false);
  assert.equal(
    shouldAdvanceFeed(feed("1.2.3-rc.2"), feed("1.2.3-rc.10")),
    true,
  );
  assert.equal(shouldAdvanceFeed(feed("1.2.3-rc.10"), feed("1.2.3")), true);
  assert.equal(compareReleaseVersions("1.2.3+build1", "1.2.3+build2"), 0);
  assert.throws(() => compareReleaseVersions("1.02.3", "1.2.3"), /version/);
});

test("bundle provenance includes modes and links, rejects escaping symlinks", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "islet-bundle-test-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, "binary"), "content", {
    mode: 0o755,
  });
  await fs.symlink("binary", path.join(directory, "link"));
  const manifest = await bundleManifest(directory);
  assert.equal(manifest.find((file) => file.name === "binary").mode, 0o755);
  assert.equal(manifest.find((file) => file.name === "link").link, "binary");
  await fs.symlink("../outside", path.join(directory, "escaping"));
  await assert.rejects(bundleManifest(directory), /escaping symlink/);
});

async function fixtureDirectory(t) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "islet-release-test-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const names = updaterNames(version),
    signedFixture = signed(),
    image = Buffer.from("verified dmg"),
    commit = "a".repeat(40),
    bundleSha256 = "b".repeat(64);
  const feed = createFeed({ version, signature: signedFixture.signature });
  const metadata = {
    version,
    arch: "arm64",
    platform: "macos",
    commit,
    bundleSha256,
    signing: { verified: true, notarized: false },
    validation: {
      dmgVerified: true,
      dmgMounted: true,
      codeSignatureVerified: true,
      runtimeExecuted: true,
    },
    artifacts: [
      {
        name: `Islet_${version}_macos_arm64.dmg`,
        bytes: image.length,
        sha256: digest(image),
      },
    ],
  };
  const updater = {
    version,
    commit,
    archive: names.archive,
    bytes: signedFixture.bytes.length,
    sha256: digest(signedFixture.bytes),
    bundleSha256,
    signedVersion: version,
    signatureVerified: true,
    bundleVerified: true,
  };
  for (const [name, data] of [
    [`Islet_${version}_macos_arm64.dmg`, image],
    [`Islet_${version}_macos_arm64.json`, JSON.stringify(metadata)],
    [names.archive, signedFixture.bytes],
    [names.signature, signedFixture.signature],
    [names.feed, JSON.stringify(feed)],
    [names.metadata, JSON.stringify(updater)],
  ])
    await fs.writeFile(path.join(directory, name), data);
  return {
    directory,
    version,
    commit,
    publicKey: signedFixture.key,
    names,
    updater,
  };
}

test("publisher rejects modified artifacts and DMG/archive provenance mismatch", async (t) => {
  const fixture = await fixtureDirectory(t);
  const result = await verifiedArtifacts(fixture);
  assert.equal(result.expected.size, 5);
  assert.ok(result.expected.has("SHA256SUMS.txt"));
  await fs.writeFile(
    path.join(fixture.directory, fixture.names.metadata),
    JSON.stringify({ ...fixture.updater, bundleSha256: "c".repeat(64) }),
  );
  await assert.rejects(verifiedArtifacts(fixture), /validated DMG/);
  await fs.writeFile(
    path.join(fixture.directory, fixture.names.archive),
    "tampered archive",
  );
  await assert.rejects(verifiedArtifacts(fixture), /signature verification/);
});

function mockApi(
  expected,
  { currentFeed = null, failUpload = false, badDigest = false } = {},
) {
  const releases = new Map(),
    calls = [];
  if (currentFeed) {
    const bytes = Buffer.from(JSON.stringify(currentFeed));
    releases.set("updater", {
      isDraft: false,
      isPrerelease: true,
      assets: [
        {
          name: "latest.json",
          size: bytes.length,
          digest: `sha256:${digest(bytes)}`,
        },
      ],
    });
  }
  const api = {
    async view(tag) {
      calls.push(["view", tag]);
      return releases.get(tag) || null;
    },
    async create(tag) {
      calls.push(["create", tag]);
      releases.set(tag, {
        isDraft: true,
        isPrerelease: true,
        assets: [],
        url: `https://github.com/saadqc/Islet/releases/tag/${tag}`,
      });
    },
    async upload(tag, files) {
      calls.push(["upload", tag]);
      if (failUpload) throw new Error("Upload failed");
      releases.get(tag).assets = files.map((file) => {
        const name = path.basename(file),
          record = expected.get(name);
        return {
          name,
          size: record.bytes,
          digest: `sha256:${badDigest ? "0".repeat(64) : record.sha256}`,
        };
      });
    },
    async publish(tag) {
      calls.push(["publish", tag]);
      releases.get(tag).isDraft = false;
    },
    async readFeed() {
      return Buffer.from(JSON.stringify(currentFeed));
    },
  };
  return { api, calls, releases };
}

test("feed publishes only after immutable version assets are verified and public", async (t) => {
  const fixture = await fixtureDirectory(t),
    artifacts = await verifiedArtifacts(fixture),
    { api, calls } = mockApi(artifacts.expected);
  const result = await publishVerifiedRelease({
    ...fixture,
    ...artifacts,
    api,
    tag: `v${version}`,
  });
  assert.equal(result.channel.advanced, true);
  assert.ok(
    calls.findIndex(
      ([action, tag]) => action === "publish" && tag === `v${version}`,
    ) <
      calls.findIndex(
        ([action, tag]) => action === "create" && tag === "updater",
      ),
  );
});

test("upload or digest failure never advances the feed", async (t) => {
  const fixture = await fixtureDirectory(t),
    artifacts = await verifiedArtifacts(fixture);
  for (const options of [{ failUpload: true }, { badDigest: true }]) {
    const { api, calls } = mockApi(artifacts.expected, options);
    await assert.rejects(
      publishVerifiedRelease({
        ...fixture,
        ...artifacts,
        api,
        tag: `v${version}`,
      }),
    );
    assert.equal(
      calls.some(([, tag]) => tag === "updater"),
      false,
    );
  }
});

test("slow older publication cannot replace a newer update feed", async (t) => {
  const fixture = await fixtureDirectory(t),
    artifacts = await verifiedArtifacts(fixture),
    currentFeed = createFeed({
      version: "2.0.0",
      signature: signed().signature,
    });
  const { api, calls } = mockApi(artifacts.expected, { currentFeed });
  const result = await advanceUpdateFeed({ ...fixture, ...artifacts, api });
  assert.deepEqual(result, { advanced: false, version: "2.0.0" });
  assert.equal(
    calls.some(([action]) => action === "upload"),
    false,
  );
});

test("uploaded asset validation rejects extras and duplicates", () => {
  const expected = new Map([["a", { bytes: 1, sha256: "a".repeat(64) }]]);
  assert.throws(
    () => assertUploadedAssets({ assets: [] }, expected),
    /missing/,
  );
  assert.throws(
    () =>
      assertUploadedAssets(
        {
          assets: [{ name: "b", size: 1, digest: `sha256:${"a".repeat(64)}` }],
        },
        expected,
      ),
    /verification/,
  );
});
