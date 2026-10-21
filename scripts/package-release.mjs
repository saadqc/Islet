import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { signPreview } from "./sign-preview.mjs";
import { verifyBundleIcon } from "./app-icon.mjs";
import {
  archiveFor,
  inspectBinary,
  MINIMUM_MACOS,
  NODE_VERSION,
  sha256,
} from "./setup-runtime.mjs";

const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
export function compareVersions(left, right) {
  const a = String(left).split(".").map(Number),
    b = String(right).split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const difference = (a[i] || 0) - (b[i] || 0);
    if (difference) return difference;
  }
  return 0;
}
export function releaseNames(version, arch = "arm64") {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))
    throw new Error("Expected a semantic release version without a leading v.");
  if (arch !== "arm64")
    throw new Error(
      "Islet installers are available for Apple silicon (arm64) only.",
    );
  const base = `Islet_${version}_macos_${arch}`;
  return {
    base,
    dmg: base + ".dmg",
    metadata: base + ".json",
    checksums: "SHA256SUMS.txt",
  };
}
export function parsePackageArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i],
      key = {
        "--app": "app",
        "--arch": "arch",
        "--version": "version",
        "--out-dir": "outDir",
      }[flag];
    if (!key) throw new Error(`Unknown package option: ${flag}`);
    const value = args[++i];
    if (!value || value.startsWith("--"))
      throw new Error(`${flag} requires a value.`);
    options[key] = value;
  }
  return options;
}
export function validateReleaseIdentity({
  appArch,
  nodeArch,
  requestedArch,
  runnerArch,
  nodeVersion,
  minimumSystemVersion,
  nodeMinimumVersion = MINIMUM_MACOS,
}) {
  if (
    !/^\d+(?:\.\d+){0,2}$/.test(minimumSystemVersion) ||
    !/^\d+(?:\.\d+){0,2}$/.test(nodeMinimumVersion)
  )
    throw new Error("Invalid minimum macOS version.");
  if (requestedArch !== "arm64")
    throw new Error(
      "Islet installers are available for Apple silicon (arm64) only.",
    );
  if (
    appArch !== requestedArch ||
    nodeArch !== requestedArch ||
    runnerArch !== requestedArch
  )
    throw new Error(
      `Architecture mismatch: runner=${runnerArch}, app=${appArch}, Node=${nodeArch}, requested=${requestedArch}. Build natively on the matching runner.`,
    );
  if (nodeVersion !== NODE_VERSION)
    throw new Error(
      `Bundled Node must be ${NODE_VERSION}; got ${nodeVersion}.`,
    );
  if (
    compareVersions(minimumSystemVersion, MINIMUM_MACOS) < 0 ||
    compareVersions(minimumSystemVersion, nodeMinimumVersion) < 0
  )
    throw new Error(
      `App minimum macOS ${minimumSystemVersion} is below bundled Node's ${nodeMinimumVersion} requirement. Set minimumSystemVersion to at least ${MINIMUM_MACOS}.`,
    );
}
async function plist(file, key) {
  return (
    await exec("/usr/libexec/PlistBuddy", ["-c", "Print :" + key, file])
  ).stdout.trim();
}
async function validateBundle(app, { arch, version }) {
  await verifyBundleIcon(app);
  const info = path.join(app, "Contents/Info.plist"),
    executable = await plist(info, "CFBundleExecutable");
  if (executable.includes("/") || executable.includes("\\"))
    throw new Error("Invalid app executable name.");
  const appVersion = await plist(info, "CFBundleShortVersionString");
  if (appVersion !== version)
    throw new Error(
      `Bundle version ${appVersion} does not match requested ${version}.`,
    );
  const minimumSystemVersion = await plist(info, "LSMinimumSystemVersion");
  const binary = path.join(app, "Contents/MacOS", executable),
    runtime = path.join(app, "Contents/Resources/resources/runtime");
  const node = path.join(runtime, "node"),
    appInfo = inspectBinary(await fs.readFile(binary)),
    nodeInfo = inspectBinary(await fs.readFile(node));
  if (appInfo.platform !== "darwin" || nodeInfo.platform !== "darwin")
    throw new Error("The app and bundled Node must be Mach-O executables.");
  const versions = JSON.parse(
    await fs.readFile(path.join(runtime, "versions.json"), "utf8"),
  );
  validateReleaseIdentity({
    appArch: appInfo.arch,
    nodeArch: nodeInfo.arch,
    requestedArch: arch,
    runnerArch: process.arch,
    nodeVersion: versions.node,
    minimumSystemVersion,
    nodeMinimumVersion: nodeInfo.minimumMacOS,
  });
  const pinned = archiveFor("darwin", arch);
  if (
    versions.runtime?.archiveSha256 !== pinned.sha256 ||
    versions.runtime?.archive !== pinned.filename
  )
    throw new Error(
      "Runtime provenance does not match the pinned official archive. Run runtime:setup.",
    );
  if (
    versions.runtime.executableSha256 !== sha256(await fs.readFile(node)) ||
    versions.runtime.licenseSha256 !==
      sha256(await fs.readFile(path.join(runtime, "NODE-LICENSE")))
  )
    throw new Error(
      "Bundled Node or its license changed after verified extraction.",
    );
  if (versions.arch !== arch || versions.platform !== "darwin")
    throw new Error("Runtime provenance target does not match the app.");
  if (compareVersions(minimumSystemVersion, appInfo.minimumMacOS || "0") < 0)
    throw new Error(
      "Bundle minimum macOS is lower than the app executable's minimum.",
    );
  const runtimeProbe = JSON.parse(
    (
      await exec(
        node,
        [
          "-p",
          "JSON.stringify({node:process.version,arch:process.arch,platform:process.platform})",
        ],
        { env: { ...process.env, NODE_OPTIONS: "" } },
      )
    ).stdout.trim(),
  );
  if (
    runtimeProbe.node !== NODE_VERSION ||
    runtimeProbe.arch !== arch ||
    runtimeProbe.platform !== "darwin"
  )
    throw new Error(
      "Bundled runtime failed its architecture/version launch check.",
    );
  for (const file of [binary, node])
    if (!((await fs.stat(file)).mode & 0o111))
      throw new Error(`Executable permission missing: ${file}`);
  return { minimumSystemVersion, executable, runtime: versions, runtimeProbe };
}
async function validateRemoteBundles(app, version) {
  const result = [];
  for (const arch of ["arm64", "x64"]) {
    const archive = path.join(
      app,
      "Contents/Resources/resources/remote",
      `islet-${version}-linux-${arch}.tar.gz`,
    );
    const digest = sha256(await fs.readFile(archive));
    const recorded = (await fs.readFile(archive + ".sha256", "utf8"))
      .trim()
      .split(/\s+/)[0];
    if (digest !== recorded)
      throw new Error(`Bundled remote ${arch} package checksum mismatch.`);
    const contents = await exec("tar", ["-xOf", archive, "./versions.json"], {
      maxBuffer: 1024 * 1024,
    });
    const provenance = JSON.parse(contents.stdout);
    if (
      provenance.node !== NODE_VERSION ||
      provenance.platform !== "linux" ||
      provenance.arch !== arch ||
      provenance.runtime?.archiveSha256 !== archiveFor("linux", arch).sha256
    )
      throw new Error(
        `Bundled remote ${arch} runtime is not the pinned official Node release.`,
      );
    result.push({
      arch,
      archive: path.basename(archive),
      sha256: digest,
      node: provenance,
    });
  }
  return result;
}
async function verifyExtracted(app, { arch, version }) {
  await exec("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
  return validateBundle(app, { arch, version });
}
export async function detachImage(
  mount,
  {
    run = exec,
    delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {},
) {
  // Finder and indexing can briefly retain a newly mounted read-only image.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await run("/usr/bin/hdiutil", ["detach", mount]);
      return;
    } catch (error) {
      if (attempt < 4) await delay(250 * (attempt + 1));
      else {
        // This mount belongs to this packaging invocation and is read-only.
        await run("/usr/bin/hdiutil", ["detach", "-force", mount]);
      }
    }
  }
}
export async function packageRelease(options = {}) {
  if (process.platform !== "darwin")
    throw new Error("macOS release packaging requires a Mac runner.");
  const version =
    options.version ||
    JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"))
      .version;
  const arch = options.arch || process.arch,
    names = releaseNames(version, arch);
  const app = path.resolve(
    options.app ||
      path.join(root, "src-tauri/target/release/bundle/macos/Islet.app"),
  );
  const outDir = path.resolve(options.outDir || path.join(root, "release"));
  if (!app.endsWith(".app"))
    throw new Error("--app must point to an .app bundle.");
  const identity = await validateBundle(app, { arch, version });
  const remoteRuntimes = await validateRemoteBundles(app, version);
  try {
    await exec("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
  } catch {
    await signPreview(app);
  }
  const signature = await exec("/usr/bin/codesign", [
    "--display",
    "--verbose=4",
    app,
  ]);
  if (!(signature.stdout + signature.stderr).includes("Signature=adhoc"))
    throw new Error(
      "This preview packager expects an ad-hoc signed app; an existing certificate signature was preserved.",
    );
  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(path.join(root, ".tools"), { recursive: true });
  const temporary = await fs.mkdtemp(
    path.join(root, ".tools/release-package-"),
  );
  const dmg = path.join(outDir, "." + crypto.randomUUID() + ".dmg");
  let mounted = false;
  const mount = path.join(temporary, "mount");
  try {
    const disk = path.join(temporary, "disk");
    await fs.mkdir(disk);
    await exec("/usr/bin/ditto", [app, path.join(disk, "Islet.app")]);
    await fs.symlink("/Applications", path.join(disk, "Applications"));
    await exec(
      "/usr/bin/hdiutil",
      [
        "create",
        "-volname",
        `Islet ${version} ${arch}`,
        "-srcfolder",
        disk,
        "-format",
        "UDZO",
        "-imagekey",
        "zlib-level=9",
        "-fs",
        "HFS+",
        "-ov",
        dmg,
      ],
      { maxBuffer: 8 * 1024 * 1024 },
    );
    await exec("/usr/bin/hdiutil", ["verify", dmg], {
      maxBuffer: 8 * 1024 * 1024,
    });
    await fs.mkdir(mount);
    await exec(
      "/usr/bin/hdiutil",
      [
        "attach",
        dmg,
        "-readonly",
        "-nobrowse",
        "-noautoopen",
        "-mountpoint",
        mount,
      ],
      { maxBuffer: 8 * 1024 * 1024 },
    );
    mounted = true;
    await verifyExtracted(path.join(mount, "Islet.app"), { arch, version });
    if (
      (await fs.readlink(path.join(mount, "Applications"))) !== "/Applications"
    )
      throw new Error("DMG installation link was not preserved.");
    await detachImage(mount);
    mounted = false;
    const artifacts = [];
    for (const [temporaryFile, name] of [[dmg, names.dmg]]) {
      const file = path.join(outDir, name);
      await fs.rename(temporaryFile, file);
      artifacts.push({
        name,
        bytes: (await fs.stat(file)).size,
        sha256: sha256(await fs.readFile(file)),
      });
    }
    const metadata = {
      schemaVersion: 1,
      product: "Islet",
      version,
      platform: "macos",
      arch,
      createdAt: new Date().toISOString(),
      commit: process.env.GITHUB_SHA || null,
      minimumSystemVersion: identity.minimumSystemVersion,
      node: identity.runtime,
      remoteRuntimes,
      signing: { identity: "ad-hoc", notarized: false, verified: true },
      validation: {
        dmgVerified: true,
        dmgMounted: true,
        codeSignatureVerified: true,
        runtimeExecuted: true,
      },
      artifacts,
    };
    const metadataFile = path.join(outDir, names.metadata);
    await fs.writeFile(metadataFile, JSON.stringify(metadata, null, 2) + "\n");
    const sums =
      artifacts.map((a) => `${a.sha256}  ${a.name}`).join("\n") + "\n";
    await fs.writeFile(path.join(outDir, names.checksums), sums);
    console.log(
      JSON.stringify(
        {
          outDir,
          ...names,
          artifacts,
          minimumSystemVersion: identity.minimumSystemVersion,
        },
        null,
        2,
      ),
    );
    return metadata;
  } finally {
    if (mounted) {
      try {
        await detachImage(mount);
        mounted = false;
      } catch (error) {
        console.error(
          "Could not detach owned verification image: " + error.message,
        );
      }
    }
    if (mounted) {
      console.error(
        `Preserved mounted image and temporary files at ${temporary} and ${dmg}.`,
      );
    } else {
      // Cleanup must not replace the original packaging/validation failure.
      await Promise.all([
        fs.rm(dmg, { force: true }),
        fs.rm(temporary, { recursive: true, force: true }),
      ]).catch((error) =>
        console.error("Release temporary cleanup failed: " + error.message),
      );
    }
  }
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
)
  await packageRelease(parsePackageArgs(process.argv.slice(2)));
