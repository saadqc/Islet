import fs from "node:fs/promises";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { Engine } from "../../remote-helper/engine.mjs";
import { pathToFileURL } from "node:url";
const exec = promisify(execFile),
  root = path.resolve(import.meta.dirname, "../..");
const app = path.join(root, "src-tauri/target/release/bundle/macos/Islet.app");
const resources = path.join(app, "Contents/Resources");
const node = path.join(resources, "resources/runtime/node"),
  cli = path.join(resources, "_up_/scripts/islet.mjs");
await fs.mkdir(path.join(root, "design/validation"), { recursive: true });
const data = path.join(root, ".tools/package-test-data");
const fixture = path.join(root, ".tools/package-test-fixture");
await fs.rm(data, { recursive: true, force: true });
await fs.mkdir(data, { recursive: true });
await fs.mkdir(fixture, { recursive: true });
await fs.writeFile(
  path.join(fixture, "main.py"),
  'print("packaged offline launch")\n',
);
await fs.mkdir(path.join(fixture, "folder with spaces"), { recursive: true });
await fs.rm(path.join(root, "design/validation/package-test-report.json"), {
  force: true,
});
const env = { ...process.env, ISLET_DATA_DIR: data };
delete env.ISLET_NATIVE_TEST_SCRIPT;
delete env.ISLET_DEV_TOKEN;
env.PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
const stdout = await fs.open(
  path.join(root, "design/validation/packaged-native-run.log"),
  "w",
);
const child = spawn(path.join(app, "Contents/MacOS/islet"), [fixture], {
  env,
  stdio: ["ignore", stdout.fd, stdout.fd],
});
const ttl = setTimeout(() => child.kill("SIGTERM"), 3600000);
ttl.unref();
await fs.writeFile(
  path.join(root, "design/validation/package-native-pid"),
  String(child.pid),
);
let success = false;
const wait = async (predicate, timeout = 30000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (child.exitCode !== null)
      throw new Error("Packaged application exited: " + child.exitCode);
    try {
      const value = await predicate();
      if (value) return value;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("Packaged app handshake timed out");
};
const run = async (args) => {
  const result = await exec(node, [cli, ...args], { env });
  return result.stdout.trim();
};
try {
  const start = Date.now();
  const windows = await wait(async () => {
    const w = JSON.parse(await run(["windows", "--json"]));
    return w.length ? w : null;
  });
  assert.equal(windows[0].id, "main");
  const dockIcon = await exec(
    "/usr/bin/swift",
    [
      path.join(root, "scripts/verify-dock-icon.swift"),
      app,
      String(child.pid),
      path.join(root, "design/validation/running-app-icon.png"),
    ],
    { timeout: 120000 },
  );
  assert.equal(JSON.parse(dockIcon.stdout.trim()).dockIconVerified, true);
  console.log(dockIcon.stdout.trim());
  const handshakeMs = Date.now() - start;
  const added = await run([
    "add",
    "--window",
    "main",
    path.join(fixture, "folder with spaces"),
  ]);
  assert.ok(added.startsWith("Delivered"));
  await run(["open", "--new-window", path.join(fixture, "folder with spaces")]);
  const two = await wait(async () => {
    const w = JSON.parse(await run(["windows", "--json"]));
    return w.length === 2 ? w : null;
  });
  assert.ok(two.some((w) => w.id.startsWith("workspace-")));
  const second = two.find((w) => w.id !== "main");
  const target = await run(["add", "--window", second.id, fixture]);
  assert.ok(target.includes(second.id));
  await run(["open", "--new-window", fixture]);
  const three = await wait(async () => {
    const w = JSON.parse(await run(["windows", "--json"]));
    return w.length === 3 ? w : null;
  });
  assert.equal(three.filter((w) => w.focused).length, 1);
  await assert.rejects(
    run(["add", "--window", "missing-islet-window", fixture]),
  );
  await run(["add", "--window", "main", "ssh://127.0.0.1:1/srv/unreachable"]);
  await new Promise((r) => setTimeout(r, 1300));
  const engine = new Engine({ dataDir: data });
  const readSession = async (windowId) => {
    const pointer = await engine.request("session.load", {
      key: "window:" + windowId,
    });
    return pointer
      ? engine.request("session.load", { key: pointer.key })
      : null;
  };
  const main = await wait(async () => {
    const snapshot = await readSession("main");
    return snapshot?.roots?.some(
      (r) => r.hostId === "ssh:127.0.0.1:1" && r.state === "disconnected",
    )
      ? snapshot
      : null;
  });
  const other = await wait(async () => {
    const snapshot = await readSession(second.id);
    return snapshot?.roots?.some((r) => r.path === fixture) ? snapshot : null;
  });
  assert.ok(main.roots.some((r) => r.path === fixture));
  assert.ok(
    main.roots.some((r) => r.path === path.join(fixture, "folder with spaces")),
  );
  assert.ok(other.roots.some((r) => r.path === fixture));
  const recoveryRecords = await engine.request("session.list");
  const ownedRecoveryRecords = recoveryRecords.filter((r) =>
    three.some((w) => w.id === r.windowId),
  );
  assert.equal(ownedRecoveryRecords.length, 3);
  assert.equal(new Set(ownedRecoveryRecords.map((r) => r.key)).size, 3);
  await engine.close();
  const languageScript = `import {Engine} from ${JSON.stringify(pathToFileURL(path.join(resources, "_up_/remote-helper/engine.mjs")).href)};import {pathToFileURL} from 'node:url';const engine=new Engine({runtimeDir:${JSON.stringify(path.join(resources, "resources/runtime/node_modules"))},dataDir:${JSON.stringify(path.join(data, "language-smoke"))}});const result=[];try{await engine.openRoot({path:${JSON.stringify(fixture)}});for(const language of ['python','javascript']){const service=await engine.startService({rootPath:${JSON.stringify(fixture)},language});const initialized=await engine.requestService({sessionId:service.sessionId,method:'initialize',params:{processId:process.pid,rootUri:pathToFileURL(${JSON.stringify(fixture)}).href,capabilities:{}}});if(!initialized.capabilities.renameProvider||!initialized.capabilities.semanticTokensProvider)throw new Error(language+' capabilities missing');result.push({language,rename:true,semanticTokens:true});await engine.stopService(service.sessionId);}console.log(JSON.stringify(result));}finally{await engine.close();}`;
  const languageResult = await exec(
    node,
    ["--input-type=module", "-e", languageScript],
    { env, timeout: 60000 },
  );
  const packagedLanguages = JSON.parse(languageResult.stdout.trim());
  const report = {
    passed: true,
    app,
    handshakeMs,
    offlineRuntimePath: node,
    packagedLanguages,
    recoveryRecords: ownedRecoveryRecords,
    restrictedPATH: env.PATH,
    windows: three,
    checks: [
      "Actual packaged macOS application and WKWebView launched",
      "Bundled Node/services resolved without developer PATH",
      "Bundled optional CLI authenticated IPC handshake",
      "Ordered folder add with spaces to explicit main window",
      "Exactly one new native window per request even with multiple existing windows",
      "One focused target and missing-target rejection",
      "Explicit second-window targeting and independent sessions",
      "Unreachable SSH root remains disconnected while local roots persist",
    ],
    limitations: [
      "Handshake time includes CLI process polling and is not a precise cold-editor paint benchmark.",
      "Package is locally ad-hoc signed, not notarized.",
    ],
  };
  await fs.writeFile(
    path.join(root, "design/validation/package-test-report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
  success = true;
} catch (e) {
  console.error(e);
  console.error(
    await fs.readFile(
      path.join(root, "design/validation/packaged-native-run.log"),
      "utf8",
    ),
  );
  process.exitCode = 1;
} finally {
  clearTimeout(ttl);
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    child.once("exit", resolve);
    setTimeout(resolve, 5000).unref();
  });
  await stdout.close();
  if (!success)
    console.error("Packaged app validation failed; logs preserved.");
}
