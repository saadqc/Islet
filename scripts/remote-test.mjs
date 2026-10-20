import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import net from "node:net";
import { Host } from "../remote-helper/host.mjs";
const exec = promisify(execFile),
  root = path.resolve(import.meta.dirname, "..");
const temp = await fs.realpath(
  await fs.mkdtemp(path.join(os.tmpdir(), "islet-ssh-")),
);
const events = [];
const host = new Host({
  dataDir: path.join(temp, "data"),
  cli: false,
  emit: (name, payload) => events.push({ name, payload }),
});
let sshd;
try {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  await exec("/usr/bin/ssh-keygen", [
    "-q",
    "-t",
    "ed25519",
    "-N",
    "",
    "-f",
    path.join(temp, "host_key"),
  ]);
  await exec("/usr/bin/ssh-keygen", [
    "-q",
    "-t",
    "ed25519",
    "-N",
    "",
    "-f",
    path.join(temp, "client_key"),
  ]);
  await fs.copyFile(
    path.join(temp, "client_key.pub"),
    path.join(temp, "authorized_keys"),
  );
  await fs.chmod(path.join(temp, "authorized_keys"), 0o600);
  const user = os.userInfo().username;
  await fs.writeFile(
    path.join(temp, "sshd_config"),
    `Port ${port}\nListenAddress 127.0.0.1\nHostKey ${temp}/host_key\nPidFile ${temp}/sshd.pid\nAuthorizedKeysFile ${temp}/authorized_keys\nStrictModes no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nUsePAM no\nAllowUsers ${user}\nLogLevel VERBOSE\n`,
  );
  const log = await fs.open(path.join(temp, "sshd.log"), "w");
  sshd = spawn(
    "/usr/sbin/sshd",
    ["-D", "-e", "-f", path.join(temp, "sshd_config")],
    { stdio: ["ignore", "ignore", log.fd] },
  );
  for (let attempt = 0; attempt < 30; attempt++) {
    if (sshd.exitCode !== null)
      throw new Error(
        "Ephemeral sshd stopped: " +
          (await fs.readFile(path.join(temp, "sshd.log"), "utf8")),
      );
    try {
      await new Promise((resolve, reject) => {
        const socket = net.connect(port, "127.0.0.1", () => {
          socket.end();
          resolve();
        });
        socket.on("error", reject);
      });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const hostPub = (
    await fs.readFile(path.join(temp, "host_key.pub"), "utf8")
  ).trim();
  await fs.writeFile(
    path.join(temp, "known_hosts"),
    `[127.0.0.1]:${port} ${hostPub}\n`,
  );
  await fs.writeFile(
    path.join(temp, "ssh_config"),
    `Host islet-fixture\n HostName 127.0.0.1\n Port ${port}\n User ${user}\n IdentityFile ${temp}/client_key\n IdentitiesOnly yes\n UserKnownHostsFile ${temp}/known_hosts\n StrictHostKeyChecking yes\n`,
  );
  const config = {
    hostId: "ssh:islet-fixture",
    target: "islet-fixture",
    configFile: path.join(temp, "ssh_config"),
    helperPath: path.join(root, "remote-helper"),
    systemNode: process.execPath,
  };
  await fs.writeFile(path.join(temp, "known_hosts"), "");
  await assert.rejects(host.request("remote.probe", config), {
    code: "HOST_KEY_UNVERIFIED",
  });
  const trust = host.request("remote.probe", { ...config, interactive: true });
  let prompt;
  for (let i = 0; i < 100; i++) {
    prompt = events
      .map((e) => e.payload)
      .find((e) => e.type === "authentication");
    if (prompt) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(prompt, "OpenSSH askpass host verification prompt");
  assert.equal(prompt.hostId, config.hostId);
  assert.equal(prompt.secret, false);
  await host.request("remote.respond", {
    promptId: prompt.promptId,
    response: "yes",
  });
  await trust;
  const trustedKnownHosts = await fs.readFile(
    path.join(temp, "known_hosts"),
    "utf8",
  );
  await exec("/usr/bin/ssh-keygen", [
    "-q",
    "-t",
    "ed25519",
    "-N",
    "",
    "-f",
    path.join(temp, "wrong_host_key"),
  ]);
  const wrongPub = (
    await fs.readFile(path.join(temp, "wrong_host_key.pub"), "utf8")
  ).trim();
  await fs.writeFile(
    path.join(temp, "known_hosts"),
    `[127.0.0.1]:${port} ${wrongPub}\n`,
  );
  await assert.rejects(host.request("remote.probe", config), {
    code: "HOST_KEY_CHANGED",
  });
  await fs.writeFile(path.join(temp, "known_hosts"), trustedKnownHosts);
  const connected = await host.request("remote.connect", config);
  assert.equal(connected.state, "ready");
  const project = path.join(temp, "project with spaces");
  await fs.mkdir(project);
  await fs.writeFile(
    path.join(project, "main.py"),
    'def greet(name: str):\n    return name\n\nresult = greet("hi")\n',
  );
  const localRoot = await host.request("root.open", {
    hostId: "local",
    path: project,
  });
  const remoteRoot = await host.request("root.open", {
    hostId: config.hostId,
    path: project,
  });
  assert.notEqual(localRoot.id, remoteRoot.id);
  assert.equal(remoteRoot.hostId, config.hostId);
  const doc = await host.request("fs.read", {
    hostId: config.hostId,
    path: path.join(project, "main.py"),
  });
  assert.equal(doc.hostId, config.hostId);
  const saved = await host.request("fs.save", {
    hostId: config.hostId,
    path: doc.path,
    text: doc.text.replace('"hi"', '"remote"'),
    expectedRevision: doc.revision,
  });
  assert.notEqual(saved.revision, doc.revision);
  const search = await host.request("search.start", {
    requestId: "ssh-search",
    roots: [localRoot, remoteRoot],
    query: "remote",
    overlays: [
      {
        hostId: "local",
        path: doc.path,
        text: "local unsaved only",
        version: 3,
      },
    ],
    options: { fileMask: "*.py" },
  });
  assert.equal(search.complete, true);
  assert.equal(search.results.length, 1);
  assert.equal(search.results[0].hostId, config.hostId);
  const service = await host.request("lsp.start", {
    root: remoteRoot,
    language: "python",
  });
  assert.ok(service.sessionId.startsWith("remote:"));
  const initialized = await host.request("lsp.request", {
    sessionId: service.sessionId,
    method: "initialize",
    params: {
      processId: process.pid,
      rootUri: "file://" + project.replaceAll(" ", "%20"),
      capabilities: { textDocument: { rename: { prepareSupport: true } } },
    },
  });
  assert.ok(initialized.capabilities.renameProvider);
  await host.request("lsp.notify", {
    sessionId: service.sessionId,
    method: "initialized",
    params: {},
  });
  await host.request("remote.disconnect", { hostId: config.hostId });
  await assert.rejects(
    host.request("fs.read", { hostId: config.hostId, path: doc.path }),
    { code: "DISCONNECTED" },
  );
  await fs.writeFile(doc.path, "external remote edit\n");
  await host.request("remote.connect", config);
  await host.request("root.open", { hostId: config.hostId, path: project });
  await assert.rejects(
    host.request("fs.save", {
      hostId: config.hostId,
      path: doc.path,
      text: "unsaved",
      expectedRevision: saved.revision,
    }),
    { code: "REVISION_CONFLICT" },
  );
  assert.equal(
    (await host.request("fs.read", { hostId: "local", path: doc.path })).text,
    "external remote edit\n",
  );
  const faultHelper = path.join(temp, "fault-helper");
  await fs.mkdir(faultHelper);
  await fs.writeFile(
    path.join(faultHelper, "host.mjs"),
    `import readline from 'node:readline';import {Engine,errorObject} from ${JSON.stringify(new URL("../remote-helper/engine.mjs", import.meta.url).href)};const engine=new Engine();const reader=readline.createInterface({input:process.stdin});reader.on('line',async line=>{const req=JSON.parse(line);try{const result=await engine.request(req.operation,req.payload);if(req.operation==='fs.save')process.exit(0);process.stdout.write(JSON.stringify({id:req.id,result})+'\\n');}catch(e){process.stdout.write(JSON.stringify({id:req.id,error:errorObject(e)})+'\\n');}});reader.on('close',()=>engine.close().finally(()=>process.exit()));`,
  );
  await host.request("remote.connect", { ...config, helperPath: faultHelper });
  await host.request("root.open", { hostId: config.hostId, path: project });
  const uncertainBefore = await host.request("fs.read", {
    hostId: config.hostId,
    path: doc.path,
  });
  await assert.rejects(
    host.request("fs.save", {
      hostId: config.hostId,
      path: doc.path,
      text: "committed without acknowledgement\n",
      expectedRevision: uncertainBefore.revision,
    }),
    { code: "SAVE_UNCERTAIN" },
  );
  assert.equal(
    await fs.readFile(doc.path, "utf8"),
    "committed without acknowledgement\n",
  );
  await host.request("remote.connect", config);
  await host.request("root.open", { hostId: config.hostId, path: project });
  assert.equal(
    (await host.request("fs.read", { hostId: config.hostId, path: doc.path }))
      .text,
    "committed without acknowledgement\n",
  );
  const report = {
    passed: true,
    transport: "Actual isolated OpenSSH loopback",
    os: process.platform,
    arch: process.arch,
    port,
    checks: [
      "Actual SSH agent/key authentication, askpass unknown-host trust prompt, changed-key rejection",
      "Paths with spaces",
      "Host-separated identical canonical paths",
      "Revision-checked remote atomic save",
      "Mixed-host search and unsaved overlay",
      "Real remote basedpyright session",
      "Disconnect retains local availability",
      "Reconnect detects changed remote revision",
      "Real SSH loss after commit reports SAVE_UNCERTAIN and reread confirms contents",
    ],
    limitations: [
      "Loopback host is macOS; Linux runtime bootstrap requires separate Linux host verification.",
    ],
    events: events
      .filter((e) => e.payload.type === "connection")
      .map((e) => e.payload),
  };
  await fs.writeFile(
    path.join(root, "design/validation/ssh-test-report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  console.error(e);
  try {
    console.error(await fs.readFile(path.join(temp, "sshd.log"), "utf8"));
  } catch {}
  process.exitCode = 1;
} finally {
  await host.close();
  if (sshd) sshd.kill("SIGTERM");
  await fs.rm(temp, { recursive: true, force: true });
}
