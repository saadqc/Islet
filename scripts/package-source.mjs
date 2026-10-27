import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
const exec = promisify(execFile),
  root = path.resolve(import.meta.dirname, "..");
export const SUPERDOC_SOURCE = {
  version: "1.46.2",
  commit: "66c22186c7c0735360ca4fd94f7499898415e903",
  sha256: "1b60af9a701e70bffe8661e49f8f88d191dd2faada9d9853c8db30964a235feb",
  url: "https://codeload.github.com/superdoc/docx-editor/tar.gz/66c22186c7c0735360ca4fd94f7499898415e903",
};
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
export const sourceNames = (version) => {
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw Error("Invalid source release version.");
  return {
    archive: `Islet_${version}_source.tar.gz`,
    metadata: `Islet_${version}_source.json`,
  };
};
export async function packageSource({
  outDir = path.join(root, "release-artifacts"),
} = {}) {
  const pkg = JSON.parse(
    await fs.readFile(path.join(root, "package.json"), "utf8"),
  );
  if (
    pkg.dependencies.superdoc !== SUPERDOC_SOURCE.version ||
    pkg.license !== "AGPL-3.0-only"
  )
    throw Error("Review source/license provenance after changing SuperDoc.");
  const commit = (
    await exec("git", ["rev-parse", "HEAD"], { cwd: root })
  ).stdout.trim();
  const frozen = JSON.parse(
    (await exec("git", ["show", commit + ":package.json"], { cwd: root }))
      .stdout,
  );
  if (
    frozen.version !== pkg.version ||
    frozen.dependencies.superdoc !== SUPERDOC_SOURCE.version
  )
    throw Error("Commit the exact release sources before packaging.");
  const cache = path.join(root, ".tools/source-cache"),
    file = path.join(
      cache,
      `superdoc-${SUPERDOC_SOURCE.version}-${SUPERDOC_SOURCE.commit}.tar.gz`,
    );
  await fs.mkdir(cache, { recursive: true });
  let upstream = await fs.readFile(file).catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  if (!upstream) {
    const response = await fetch(SUPERDOC_SOURCE.url, {
      signal: AbortSignal.timeout(180000),
    });
    if (!response.ok)
      throw Error(`Upstream source download failed (${response.status}).`);
    upstream = Buffer.from(await response.arrayBuffer());
  }
  if (hash(upstream) !== SUPERDOC_SOURCE.sha256)
    throw Error("SuperDoc source archive checksum mismatch.");
  await fs.writeFile(file, upstream);
  const prefix = "docx-editor-" + SUPERDOC_SOURCE.commit;
  const upstreamPackage = JSON.parse(
    (
      await exec(
        "/usr/bin/tar",
        ["-xOf", file, prefix + "/packages/superdoc/package.json"],
        { maxBuffer: 1024 * 1024 },
      )
    ).stdout,
  );
  if (
    upstreamPackage.version !== SUPERDOC_SOURCE.version ||
    upstreamPackage.license !== "AGPL-3.0"
  )
    throw Error("Upstream source version/license mismatch.");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "islet-source-"));
  try {
    const name = `Islet-${pkg.version}`,
      stage = path.join(tmp, name),
      own = path.join(tmp, "application.tar");
    await fs.mkdir(stage);
    await exec("git", ["archive", "--format=tar", "--output", own, commit], {
      cwd: root,
    });
    await exec("/usr/bin/tar", ["-xf", own, "-C", stage]);
    await fs.mkdir(path.join(stage, "dependency-sources"));
    await fs.copyFile(
      file,
      path.join(stage, "dependency-sources", path.basename(file)),
    );
    await fs.writeFile(
      path.join(stage, "dependency-sources", "README.txt"),
      `SuperDoc ${SUPERDOC_SOURCE.version}, AGPLv3\nUpstream public 1.x source revision: ${SUPERDOC_SOURCE.commit}\nArchive SHA-256: ${SUPERDOC_SOURCE.sha256}\n${SUPERDOC_SOURCE.url}\n\nExtract the archive and follow its README and package build scripts. Islet's root README, package-lock.json, Cargo.lock and scripts describe the application build. Third-party licenses remain in their source trees and public/licenses.\n`,
    );
    await fs.mkdir(outDir, { recursive: true });
    const names = sourceNames(pkg.version),
      archive = path.join(outDir, names.archive);
    await exec("/usr/bin/tar", ["-czf", archive, "-C", tmp, name], {
      env: { ...process.env, COPYFILE_DISABLE: "1" },
    });
    const bytes = await fs.readFile(archive);
    const metadata = {
      version: pkg.version,
      commit,
      license: pkg.license,
      archive: names.archive,
      bytes: bytes.length,
      sha256: hash(bytes),
      superdoc: SUPERDOC_SOURCE,
    };
    await fs.writeFile(
      path.join(outDir, names.metadata),
      JSON.stringify(metadata, null, 2) + "\n",
    );
    console.log(
      JSON.stringify({
        sourceArchive: names.archive,
        bytes: bytes.length,
        commit,
        superdoc: SUPERDOC_SOURCE.version,
      }),
    );
    return metadata;
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
)
  await packageSource();
