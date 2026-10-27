import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const NODE_VERSION = "v24.12.0";
export const MINIMUM_MACOS = "13.5";
// Published https://nodejs.org/dist/v24.12.0/SHASUMS256.txt. Pin the values so
// neither the builder's Node installation nor a changed download can drift.
export const NODE_ARCHIVES = Object.freeze({
  "darwin-arm64": {
    filename: "node-v24.12.0-darwin-arm64.tar.gz",
    sha256: "319f221adc5e44ff0ed57e8a441b2284f02b8dc6fc87b8eb92a6a93643fd8080",
  },
  "darwin-x64": {
    filename: "node-v24.12.0-darwin-x64.tar.gz",
    sha256: "b82ea4c62fd08e250cab59d625e75d77cc5b0a3d60c6698ebee4545c88a169c5",
  },
  "linux-arm64": {
    filename: "node-v24.12.0-linux-arm64.tar.xz",
    sha256: "a06d42807fb500f7459e5f3fa6cb431447352826ee6f07e14adfeec58a1b3210",
  },
  "linux-x64": {
    filename: "node-v24.12.0-linux-x64.tar.xz",
    sha256: "bdebee276e58d0ef5448f3d5ac12c67daa963dd5e0a9bb621a53d1cefbc852fd",
  },
});
const root = path.resolve(import.meta.dirname, "..");
const resources = path.join(root, "src-tauri/resources");
const packages = ["basedpyright", "typescript", "typescript-language-server", "yazl"];
export const sha256 = (bytes) =>
  crypto.createHash("sha256").update(bytes).digest("hex");
export const run = (bin, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code, signal) =>
      code === 0
        ? resolve()
        : reject(new Error(`${bin} exited with ${code ?? signal}`)),
    );
  });
export function archiveFor(platform, arch) {
  const archive = NODE_ARCHIVES[`${platform}-${arch}`];
  if (!archive)
    throw new Error(
      `Unsupported runtime target: ${platform}/${arch}. Expected darwin/linux and arm64/x64.`,
    );
  return {
    ...archive,
    url: `https://nodejs.org/dist/${NODE_VERSION}/${archive.filename}`,
  };
}
export function verifyArchive(bytes, expected) {
  const actual = sha256(bytes);
  if (actual !== expected)
    throw new Error(
      `Node runtime checksum mismatch: expected ${expected}, got ${actual}`,
    );
  return actual;
}
function versionNumber(value) {
  return [(value >>> 16) & 65535, (value >>> 8) & 255, value & 255].join(".");
}
export function inspectBinary(bytes) {
  if (bytes.length < 32) throw new Error("Runtime executable is truncated.");
  if (bytes.readUInt32LE(0) === 0xfeedfacf) {
    const cpu = bytes.readUInt32LE(4);
    const arch =
      cpu === 0x0100000c ? "arm64" : cpu === 0x01000007 ? "x64" : null;
    if (!arch) throw new Error("Unsupported Mach-O architecture.");
    let offset = 32,
      minimumMacOS;
    for (let n = 0; n < bytes.readUInt32LE(16); n++) {
      if (offset + 8 > bytes.length)
        throw new Error("Invalid Mach-O load commands.");
      const command = bytes.readUInt32LE(offset),
        size = bytes.readUInt32LE(offset + 4);
      if (size < 8 || offset + size > bytes.length)
        throw new Error("Invalid Mach-O command size.");
      if (command === 0x32 && size >= 24)
        minimumMacOS = versionNumber(bytes.readUInt32LE(offset + 12));
      if (command === 0x24 && size >= 16)
        minimumMacOS = versionNumber(bytes.readUInt32LE(offset + 8));
      offset += size;
    }
    return { platform: "darwin", arch, minimumMacOS };
  }
  if (bytes.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70]))) {
    if (bytes[4] !== 2 || bytes[5] !== 1)
      throw new Error("Expected a 64-bit little-endian Linux runtime.");
    const machine = bytes.readUInt16LE(18);
    const arch = machine === 183 ? "arm64" : machine === 62 ? "x64" : null;
    if (!arch) throw new Error("Unsupported ELF architecture.");
    return { platform: "linux", arch };
  }
  throw new Error(
    "Expected a single-architecture Mach-O or Linux ELF executable.",
  );
}
export async function downloadArchive(
  platform,
  arch,
  { cache = path.join(root, ".tools/downloads"), fetchImpl = fetch } = {},
) {
  const archive = archiveFor(platform, arch);
  await fs.mkdir(cache, { recursive: true });
  const file = path.join(cache, archive.filename);
  let bytes;
  try {
    bytes = await fs.readFile(file);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const response = await fetchImpl(archive.url, {
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok)
      throw new Error(`Node runtime download failed: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    verifyArchive(bytes, archive.sha256);
    const temporary = file + "." + crypto.randomUUID();
    await fs.writeFile(temporary, bytes);
    await fs.rename(temporary, file);
  }
  verifyArchive(bytes, archive.sha256);
  return { ...archive, file };
}
async function copyPackages(destination) {
  await fs.mkdir(destination, { recursive: true });
  const done = new Set();
  const copy = async (name) => {
    if (done.has(name)) return;
    done.add(name);
    const source = path.join(root, "node_modules", name);
    const json = JSON.parse(
      await fs.readFile(path.join(source, "package.json"), "utf8"),
    );
    await fs.mkdir(path.dirname(path.join(destination, name)), {
      recursive: true,
    });
    await fs.cp(source, path.join(destination, name), {
      recursive: true,
      filter: (file) =>
        !file.endsWith(".map") &&
        !file.includes(`${path.sep}node_modules${path.sep}.bin${path.sep}`),
    });
    for (const dependency of Object.keys(json.dependencies || {}))
      await copy(dependency);
  };
  for (const name of packages) await copy(name);
  return Object.fromEntries(
    await Promise.all(
      [...done]
        .sort()
        .map(async (name) => [
          name,
          JSON.parse(
            await fs.readFile(
              path.join(root, "node_modules", name, "package.json"),
              "utf8",
            ),
          ).version,
        ]),
    ),
  );
}
async function extractRuntime(platform, arch, destination) {
  const archive = await downloadArchive(platform, arch);
  const folder = `node-${NODE_VERSION}-${platform}-${arch}`;
  await fs.mkdir(destination, { recursive: true });
  await run("tar", [
    archive.filename.endsWith(".xz") ? "-xJf" : "-xzf",
    archive.file,
    "-C",
    destination,
    `${folder}/bin/node`,
    `${folder}/LICENSE`,
  ]);
  await fs.rename(
    path.join(destination, folder, "bin/node"),
    path.join(destination, "node"),
  );
  await fs.rename(
    path.join(destination, folder, "LICENSE"),
    path.join(destination, "NODE-LICENSE"),
  );
  await fs.rm(path.join(destination, folder), { recursive: true });
  await fs.chmod(path.join(destination, "node"), 0o755);
  const executable = await fs.readFile(path.join(destination, "node"));
  const inspected = inspectBinary(executable);
  if (inspected.platform !== platform || inspected.arch !== arch)
    throw new Error(
      "Extracted runtime architecture does not match its target.",
    );
  const versions = {
    node: NODE_VERSION,
    platform,
    arch,
    ...(platform === "darwin" ? { minimumMacOS: MINIMUM_MACOS } : {}),
    runtime: {
      archive: archive.filename,
      url: archive.url,
      archiveSha256: archive.sha256,
      executableSha256: sha256(executable),
      licenseSha256: sha256(
        await fs.readFile(path.join(destination, "NODE-LICENSE")),
      ),
    },
    packageLockSha256: sha256(
      await fs.readFile(path.join(root, "package-lock.json")),
    ),
    packages: await copyPackages(path.join(destination, "node_modules")),
  };
  await fs.writeFile(
    path.join(destination, "versions.json"),
    JSON.stringify(versions, null, 2) + "\n",
  );
  return versions;
}
export async function setupLocal({
  platform = process.platform,
  arch = process.arch,
} = {}) {
  archiveFor(platform, arch);
  const runtime = path.join(resources, "runtime"),
    stage = path.join(resources, ".runtime-" + crypto.randomUUID());
  try {
    const versions = await extractRuntime(platform, arch, stage);
    await fs.rm(runtime, { recursive: true, force: true });
    await fs.rename(stage, runtime);
    console.log(
      `Bundled verified ${NODE_VERSION} ${platform}/${arch} runtime at ${runtime}`,
    );
    return versions;
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
}
export async function setupRemote(arch) {
  archiveFor("linux", arch);
  const stage = path.join(root, ".tools", `remote-${arch}`);
  await fs.rm(stage, { recursive: true, force: true });
  const versions = await extractRuntime("linux", arch, stage);
  for (const name of (
    await fs.readdir(path.join(root, "remote-helper"))
  ).filter((name) => name.endsWith(".mjs")))
    await fs.copyFile(
      path.join(root, "remote-helper", name),
      path.join(stage, name),
    );
  const version = JSON.parse(
    await fs.readFile(path.join(root, "package.json"), "utf8"),
  ).version;
  const directory = path.join(resources, "remote");
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(directory, `islet-${version}-linux-${arch}.tar.gz`),
    temporary = target + "." + crypto.randomUUID();
  await run("tar", ["-czf", temporary, "-C", stage, "."]);
  await fs.rename(temporary, target);
  await fs.writeFile(
    target + ".sha256",
    sha256(await fs.readFile(target)) + "\n",
  );
  // A local build may retain earlier helper versions; only ship this version.
  for (const name of await fs.readdir(directory)) {
    if (
      new RegExp(
        `^islet-[0-9][^/]*-linux-${arch}\\.tar\\.gz(?:\\.sha256)?$`,
      ).test(name) &&
      name !== path.basename(target) &&
      name !== path.basename(target) + ".sha256"
    )
      await fs.rm(path.join(directory, name));
  }
  console.log(
    `Bundled verified ${NODE_VERSION} Linux ${arch} runtime: ${target}`,
  );
  return versions;
}
export function parseRuntimeArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--remote") options.remote = args[++i];
    else if (flag === "--arch") options.arch = args[++i];
    else if (flag === "--platform") options.platform = args[++i];
    else throw new Error(`Unknown runtime option: ${flag}`);
    if (!args[i] || args[i].startsWith("--"))
      throw new Error(`${flag} requires a value.`);
  }
  if (options.remote) {
    archiveFor("linux", options.remote);
    if (options.arch || options.platform)
      throw new Error("--remote cannot be combined with local target options.");
  } else
    archiveFor(
      options.platform || process.platform,
      options.arch || process.arch,
    );
  return options;
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const options = parseRuntimeArgs(process.argv.slice(2));
  if (options.remote) await setupRemote(options.remote);
  else await setupLocal(options);
}
