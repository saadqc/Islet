import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import {
  Engine,
  compileSearch,
  findMatches,
} from "../../remote-helper/engine.mjs";
import { Host } from "../../remote-helper/host.mjs";
import { parseArgs } from "../../scripts/islet.mjs";
const temp = () => fs.mkdtemp(path.join(os.tmpdir(), "islet-backend-"));
async function interpreterFixture(dir, name = "python") {
  const executable = path.join(dir, name);
  await fs.mkdir(path.dirname(executable), { recursive: true });
  await fs.writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  return executable;
}
async function fixture(t) {
  const dir = await fs.realpath(await temp());
  const engine = new Engine({ dataDir: path.join(dir, ".data") });
  await engine.request("root.open", { path: dir });
  t.after(async () => {
    await engine.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { dir, engine };
}
test("UTF8 BOM + CRLF atomic save preserves permissions and refuses stale disk revisions", async (t) => {
  const { dir, engine } = await fixture(t);
  const file = path.join(dir, "unicode.py");
  await fs.writeFile(file, "\uFEFF# café 😃\r\nx = 1\r\n", { mode: 0o640 });
  const initial = await engine.request("file.read", { path: file });
  assert.equal(initial.bom, true);
  assert.equal(initial.newline, "CRLF");
  assert.equal(initial.text, "# café 😃\nx = 1\n");
  const saved = await engine.request("file.save", {
    path: file,
    text: initial.text.replace("1", "2"),
    expectedRevision: initial.revision,
    bom: initial.bom,
    newline: initial.newline,
  });
  assert.notEqual(saved.revision, initial.revision);
  assert.equal(
    (await fs.readFile(file)).subarray(0, 3).toString("hex"),
    "efbbbf",
  );
  assert.equal((await fs.readFile(file, "utf8")).includes("\r\n"), true);
  assert.equal((await fs.stat(file)).mode & 0o777, 0o640);
  await fs.writeFile(file, "external");
  await assert.rejects(
    engine.request("fs.save", {
      path: file,
      text: "overwrite",
      expectedRevision: saved.revision,
    }),
    { code: "REVISION_CONFLICT" },
  );
  assert.equal(await fs.readFile(file, "utf8"), "external");
});
test("binary/invalid UTF8 refused, canonical symlink saves cannot escape root", async (t) => {
  const { dir, engine } = await fixture(t);
  await fs.writeFile(path.join(dir, "binary"), Buffer.from([1, 0, 2]));
  await assert.rejects(engine.read({ path: path.join(dir, "binary") }), {
    code: "BINARY_FILE",
  });
  await fs.writeFile(path.join(dir, "invalid"), Buffer.from([255]));
  await assert.rejects(engine.read({ path: path.join(dir, "invalid") }), {
    code: "UNSUPPORTED_ENCODING",
  });
  const outside = await temp();
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.writeFile(path.join(outside, "secret"), "safe");
  await fs.symlink(path.join(outside, "secret"), path.join(dir, "link"));
  const doc = await engine.read({ path: path.join(dir, "link") });
  await assert.rejects(
    engine.save({
      path: doc.path,
      expectedRevision: doc.revision,
      text: "bad",
    }),
    { code: "OUTSIDE_WORKSPACE" },
  );
});
test("search uses unsaved buffer only, literal/mask/ignored/binary/large filtering and per-root completeness", async (t) => {
  const { dir, engine } = await fixture(t);
  await fs.writeFile(path.join(dir, "main.py"), "stale needle\n");
  await fs.writeFile(path.join(dir, "other.js"), "needle\n");
  await fs.writeFile(path.join(dir, ".gitignore"), "ignored.py\n");
  await fs.writeFile(path.join(dir, "ignored.py"), "needle");
  await fs.writeFile(path.join(dir, "binary.py"), Buffer.from([0, 110]));
  const result = await engine.search({
    requestId: "overlay",
    roots: [{ id: "r", path: dir }],
    query: "needle",
    options: { fileMask: "*.py" },
    overlays: [
      {
        hostId: "local",
        path: path.join(dir, "main.py"),
        text: "live needle\n",
        version: 8,
      },
    ],
  });
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].snippet, "live needle");
  assert.equal(result.results[0].version, 8);
  assert.equal(result.limits.skippedBinary, 1);
  assert.equal(result.complete, true);
  const failed = await engine.search({
    roots: [{ id: "r", path: "/does-not-exist" }],
    query: "needle",
  });
  assert.equal(failed.complete, false);
  assert.equal(failed.roots[0].state, "failed");
});
test("regex exact UTF16 offsets, astral zero-width progression, capture groups, Unicode word boundaries", () => {
  const matcher = compileSearch("(?<prefix>α)(\\d+)", {
    regex: true,
    caseSensitive: true,
  });
  const found = findMatches("😃 α12\n", matcher, {});
  assert.equal(found[0].from, 3);
  assert.equal(found[0].to, 6);
  assert.deepEqual(found[0].groups, ["α", "12"]);
  assert.equal(found[0].namedGroups.prefix, "α");
  const zeros = findMatches("😃x", compileSearch("(?=.)", { regex: true }), {});
  assert.deepEqual(
    zeros.map((x) => x.from),
    [0, 2],
  );
  assert.equal(
    findMatches("pré pre préfix", compileSearch("pré", { wholeWord: true }), {})
      .length,
    1,
  );
  assert.throws(() => compileSearch("[", { regex: true }), {
    code: "INVALID_REGEX",
  });
});
test("host identities, root selection and transactional journals stay separate", async (t) => {
  const { dir, engine } = await fixture(t);
  const local = await engine.openRoot({ path: dir });
  const remoteEngine = new Engine({
    dataDir: path.join(dir, ".remote-data"),
    hostId: "ssh:fixture",
  });
  t.after(() => remoteEngine.close());
  const remote = await remoteEngine.openRoot({ path: dir });
  assert.notEqual(local.id, remote.id);
  assert.notEqual(local.hostId, remote.hostId);
  await engine.request("journal.save", {
    key: "tx1",
    value: { files: [{ hostId: "local", path: "/x", state: "pending" }] },
  });
  assert.equal(
    (await engine.request("journal.load", { key: "tx1" })).files[0].state,
    "pending",
  );
});
test("workspace manifests resolve relative local paths and remove secrets", async (t) => {
  const { dir, engine } = await fixture(t);
  const target = path.join(dir, "test.islet-workspace");
  await engine.request("workspace.save", {
    path: target,
    value: {
      schemaVersion: 1,
      id: "w",
      roots: [{ hostId: "local", path: "project", password: "nope" }],
    },
  });
  assert.equal((await fs.readFile(target, "utf8")).includes("nope"), false);
  assert.equal(
    (await engine.request("workspace.load", { path: target })).roots[0].path,
    path.join(dir, "project"),
  );
});
test("CLI interpreter selectors merge local and SSH roots without crossing host identity", () => {
  const parsed = parseArgs(
    [
      "add",
      "--window",
      "main",
      "./one",
      "ssh://user@HOST:2222/srv/a%20b/./",
      "--python-interpreter",
      "one/.",
      "/envs/one/bin/python",
      "--python-interpreter",
      "two",
      "/envs/two/bin/python",
      "--python-interpreter",
      "SSH://user@host:2222/srv/a%20b",
      "/remote/env/bin/python",
      "--python-interpreter",
      "ssh://user@host:2223/srv/a%20b",
      "/other/env/bin/python",
      "--python-interpreter",
      "one",
      "/envs/one/bin/python",
    ],
    "/projects",
  );
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.roots.length, 4);
  assert.deepEqual(
    parsed.roots.map(({ hostId, path, interpreter }) => ({
      hostId,
      path,
      interpreter,
    })),
    [
      {
        hostId: "local",
        path: "/projects/one",
        interpreter: "/envs/one/bin/python",
      },
      {
        hostId: "ssh:user@host:2222",
        path: "/srv/a b",
        interpreter: "/remote/env/bin/python",
      },
      {
        hostId: "local",
        path: "/projects/two",
        interpreter: "/envs/two/bin/python",
      },
      {
        hostId: "ssh:user@host:2223",
        path: "/srv/a b",
        interpreter: "/other/env/bin/python",
      },
    ],
  );
  assert.equal("interpreterOverrides" in parsed, false);
  const ipv6 = parseArgs(
    [
      "--python-interpreter",
      "ssh://user@[::1]:2222/srv/project",
      "/env/bin/python",
    ],
    "/projects",
  );
  assert.equal(ipv6.roots[0].hostId, "ssh:user@[::1]:2222");
});
test("CLI workspace interpreter overrides do not add selector roots and reject ambiguous options", () => {
  const parsed = parseArgs(
    [
      "--workspace",
      "named.islet-workspace",
      "--python-interpreter",
      "one",
      "/env/bin/python",
      "--python-interpreter",
      "ssh://host/srv/project",
      "/remote/bin/python",
    ],
    "/projects",
  );
  assert.deepEqual(parsed.roots, []);
  assert.deepEqual(parsed.interpreterOverrides, [
    { hostId: "local", path: "/projects/one", interpreter: "/env/bin/python" },
    {
      hostId: "ssh:host",
      path: "/srv/project",
      interpreter: "/remote/bin/python",
    },
  ]);
  for (const args of [
    ["--python-interpreter"],
    ["--workspace", "--python-interpreter", "one", "/env/python"],
    ["--window", "--python-interpreter", "one", "/env/python"],
    ["--python-interpreter", "one"],
    ["--python-interpreter", "one", ""],
    ["--python-interpreter", "one", "relative/python"],
    ["--python-interpreter", "one", "C:\\env\\python.exe"],
    ["--python-interpreter", "one", "/env/py\0thon"],
    ["--python-interpreter", "C:\\projects\\one", "/env/python"],
    [
      "--python-interpreter",
      "ssh://user%40other@host/srv/project",
      "/env/python",
    ],
    ["--python-interpreter", "ssh://host/srv/%00", "/env/python"],
    ["windows", "--python-interpreter", "one", "/env/python"],
    [
      "--python-interpreter",
      "one",
      "/env/python",
      "--python-interpreter",
      "./one",
      "/other/python",
    ],
  ])
    assert.throws(() => parseArgs(args, "/projects"));
});
test("root interpreter config is preserved per client and reset without leaking across windows", async (t) => {
  const { dir, engine } = await fixture(t);
  const selected = await interpreterFixture(dir, "selected/bin/python");
  const automatic = await interpreterFixture(dir, ".venv/bin/python");
  const first = await engine.openRoot({
    path: dir,
    id: "configured-one",
    clientId: "one",
    interpreter: selected,
  });
  assert.equal(first.interpreter, selected);
  assert.equal(
    (await engine.openRoot({ path: dir, clientId: "one" })).interpreter,
    selected,
  );
  assert.equal(
    "interpreter" in (await engine.openRoot({ path: dir, clientId: "two" })),
    false,
  );
  assert.equal("interpreter" in engine.roots.get(first.id), false);
  const a = await engine.startService({
    rootPath: dir,
    language: "python",
    clientId: "one",
  });
  const b = await engine.startService({
    rootPath: dir,
    language: "python",
    clientId: "two",
  });
  assert.equal(a.interpreter, selected);
  assert.equal(b.interpreter, automatic);
  assert.notEqual(a.sessionId, b.sessionId);
  assert.equal(
    (await engine.openRoot({ path: dir, clientId: "one", interpreter: "" }))
      .interpreter,
    "",
  );
  assert.equal(
    (await engine.openRoot({ path: dir, clientId: "one" })).interpreter,
    "",
  );
  await engine.removeRoot({ id: first.id, clientId: "one" });
  assert.equal(
    "interpreter" in (await engine.openRoot({ path: dir, clientId: "one" })),
    false,
  );
  assert.equal(engine.services.has(b.sessionId), true);
});
test("explicit interpreter validation rejects relative, missing, directory and nonexecutable paths atomically", async (t) => {
  const { dir, engine } = await fixture(t);
  const selected = await interpreterFixture(dir, "selected-python");
  const nonexec = path.join(dir, "nonexec");
  await fs.writeFile(nonexec, "not executable", { mode: 0o644 });
  const root = await engine.openRoot({
    path: dir,
    clientId: "one",
    interpreter: selected,
  });
  for (const interpreter of [
    "relative/python",
    "C:\\env\\python.exe",
    "/bad\0python",
    path.join(dir, "missing"),
    dir,
    nonexec,
    null,
    42,
  ]) {
    await assert.rejects(
      engine.openRoot({ path: dir, clientId: "one", interpreter }),
      { code: "INVALID_INTERPRETER" },
    );
    assert.equal(
      engine.rootConfigs.get(root.id).get("one").interpreter,
      selected,
    );
  }
  await fs.chmod(selected, 0o644);
  await assert.rejects(engine.openRoot({ path: dir, clientId: "one" }), {
    code: "INVALID_INTERPRETER",
  });
  const remote = new Engine({
    dataDir: path.join(dir, "remote-data"),
    hostId: "ssh:fixture",
  });
  t.after(() => remote.close());
  await assert.rejects(
    remote.openRoot({
      path: dir,
      interpreter: path.join(dir, "missing-remote"),
    }),
    { code: "INVALID_INTERPRETER" },
  );
  await fs.chmod(selected, 0o755);
  assert.equal(
    (await remote.openRoot({ path: dir, interpreter: selected })).interpreter,
    selected,
  );
});
test("workspace interpreter overrides match manifest roots atomically and preserve explicit auto reset", async (t) => {
  const { dir, engine } = await fixture(t),
    file = path.join(dir, "interpreters.islet-workspace");
  const value = {
    schemaVersion: 1,
    roots: [
      { hostId: "local", path: "project", interpreter: "" },
      {
        hostId: "ssh:fixture",
        path: "/srv/project",
        interpreter: "/remote/old/python",
      },
    ],
  };
  await engine.saveWorkspace({ path: file, value });
  const before = await fs.readFile(file, "utf8"),
    rootCount = engine.roots.size;
  const loaded = await engine.loadWorkspace({
    path: file,
    interpreterOverrides: [
      {
        hostId: "local",
        path: path.join(dir, "project/./"),
        interpreter: "/env/local/python",
      },
      {
        hostId: "ssh:fixture",
        path: "/srv/project/.",
        interpreter: "/remote/new/python",
      },
    ],
  });
  assert.deepEqual(
    loaded.roots.map((r) => r.interpreter),
    ["/env/local/python", "/remote/new/python"],
  );
  assert.equal(
    (await engine.loadWorkspace({ path: file })).roots[0].interpreter,
    "",
  );
  const reset = await engine.loadWorkspace({
    path: file,
    interpreterOverrides: [
      { hostId: "ssh:fixture", path: "/srv/project", interpreter: "" },
    ],
  });
  assert.equal(reset.roots[1].interpreter, "");
  await assert.rejects(
    engine.loadWorkspace({ path: file, interpreterOverrides: null }),
    { code: "INVALID_INTERPRETER" },
  );
  await assert.rejects(
    engine.loadWorkspace({
      path: file,
      interpreterOverrides: [
        {
          hostId: "local",
          path: path.join(dir, "project"),
          interpreter: "/env/python",
        },
        {
          hostId: "ssh:other-host",
          path: "/srv/project",
          interpreter: "/env/python",
        },
      ],
    }),
    { code: "INTERPRETER_ROOT_NOT_FOUND" },
  );
  await assert.rejects(
    engine.loadWorkspace({
      path: file,
      interpreterOverrides: [
        {
          hostId: "local",
          path: path.join(dir, "project"),
          interpreter: "/one/python",
        },
        {
          hostId: "local",
          path: path.join(dir, "project"),
          interpreter: "/two/python",
        },
      ],
    }),
    { code: "INVALID_INTERPRETER" },
  );
  assert.equal(await fs.readFile(file, "utf8"), before);
  assert.equal(engine.roots.size, rootCount);
  for (const hostId of ["local", "ssh:fixture"])
    for (const interpreter of [
      "relative/python",
      "C:\\env\\python.exe",
      "/bad\0python",
      null,
      42,
    ]) {
      const bad = {
        schemaVersion: 1,
        roots: [
          {
            hostId,
            path: hostId === "local" ? dir : "/srv/project",
            interpreter,
          },
        ],
      };
      await assert.rejects(engine.saveWorkspace({ path: file, value: bad }), {
        code: "INVALID_INTERPRETER",
      });
      assert.equal(await fs.readFile(file, "utf8"), before);
      await fs.writeFile(file, JSON.stringify(bad));
      await assert.rejects(engine.loadWorkspace({ path: file }), {
        code: "INVALID_INTERPRETER",
      });
      await fs.writeFile(file, before);
    }
});
test("CLI normalization, malformed URI errors and deterministic window routing", async (t) => {
  const parsed = parseArgs(
    [
      "add",
      "--window",
      "w",
      "a b",
      "a b",
      "ssh://user@host:2222/srv/a%20b",
      "ssh://host/",
      "--",
      "-literal",
    ],
    "/tmp",
  );
  assert.equal(parsed.roots.length, 3);
  assert.equal(parsed.roots[1].path, "/srv/a b");
  assert.equal(parsed.errors.length, 1);
  assert.equal(parsed.roots[2].path, "/tmp/-literal");
  const host = new Host({ cli: false });
  t.after(() => host.close());
  await assert.rejects(host.request("cli.deliver", { operation: "add" }), {
    code: "AMBIGUOUS_WINDOW",
  });
  await host.request("app.registerWindow", { windowId: "one" });
  await host.request("app.registerWindow", { windowId: "two" });
  await assert.rejects(host.request("cli.deliver", { operation: "add" }), {
    code: "AMBIGUOUS_WINDOW",
  });
  const result = await host.request("cli.deliver", {
    operation: "add",
    windowId: "two",
    roots: [],
  });
  assert.equal(result.windowId, "two");
  assert.equal(
    (await host.request("app.pendingRequests", { windowId: "one" })).length,
    0,
  );
  assert.equal(
    (await host.request("app.pendingRequests", { windowId: "two" })).length,
    1,
  );
});
async function initialize(engine, service, dir) {
  const init = await engine.requestService({
    sessionId: service.sessionId,
    method: "initialize",
    params: {
      processId: process.pid,
      rootUri: pathToFileURL(dir).href,
      workspaceFolders: [
        { uri: pathToFileURL(dir).href, name: path.basename(dir) },
      ],
      capabilities: {
        textDocument: {
          synchronization: { didSave: true },
          definition: {},
          references: {},
          rename: { prepareSupport: true },
          semanticTokens: {
            requests: { full: true },
            tokenTypes: [
              "namespace",
              "class",
              "function",
              "method",
              "variable",
              "parameter",
              "property",
            ],
            tokenModifiers: ["declaration", "readonly", "static"],
            formats: ["relative"],
          },
        },
      },
    },
    timeoutMs: 30000,
  });
  await engine.sendService({
    sessionId: service.sessionId,
    message: { jsonrpc: "2.0", method: "initialized", params: {} },
  });
  return init;
}
test("real basedpyright capabilities, unsaved imported definition and semantic cross-file rename", async (t) => {
  const { dir, engine } = await fixture(t);
  await fs.writeFile(
    path.join(dir, "library.py"),
    "def greet(name: str) -> str:\n    return name\n",
  );
  await fs.writeFile(
    path.join(dir, "main.py"),
    'from library import greet\nresult = greet("hello")\n',
  );
  const service = await engine.startService({
    rootPath: dir,
    language: "python",
  });
  const init = await initialize(engine, service, dir);
  assert.ok(init.capabilities.renameProvider);
  assert.ok(init.capabilities.semanticTokensProvider);
  const uri = pathToFileURL(path.join(dir, "main.py")).href;
  await engine.sendService({
    sessionId: service.sessionId,
    message: {
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: {
        textDocument: {
          uri,
          languageId: "python",
          version: 1,
          text: 'from library import greet\nresult = greet("unsaved")\n',
        },
      },
    },
  });
  await engine.sendService({
    sessionId: service.sessionId,
    message: {
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: {
        textDocument: {
          uri: pathToFileURL(path.join(dir, "library.py")).href,
          languageId: "python",
          version: 1,
          text: await fs.readFile(path.join(dir, "library.py"), "utf8"),
        },
      },
    },
  });
  const definition = await engine.requestService({
    sessionId: service.sessionId,
    method: "textDocument/definition",
    params: { textDocument: { uri }, position: { line: 1, character: 12 } },
  });
  assert.ok(JSON.stringify(definition).includes("library.py"));
  const rename = await engine.requestService({
    sessionId: service.sessionId,
    method: "textDocument/rename",
    params: {
      textDocument: { uri: pathToFileURL(path.join(dir, "library.py")).href },
      position: { line: 0, character: 5 },
      newName: "welcome",
    },
  });
  const edits = rename.documentChanges || Object.entries(rename.changes || {});
  assert.ok(edits.length >= 2, JSON.stringify(rename));
  const tokens = await engine.requestService({
    sessionId: service.sessionId,
    method: "textDocument/semanticTokens/full",
    params: { textDocument: { uri } },
  });
  assert.ok(tokens.data.length > 0);
});
test("real TypeScript server imported definition, rename and JSX-aware completion", async (t) => {
  const { dir, engine } = await fixture(t);
  await fs.writeFile(
    path.join(dir, "jsconfig.json"),
    JSON.stringify({
      compilerOptions: { checkJs: true, allowJs: true, jsx: "react" },
      include: ["*.js", "*.jsx"],
    }),
  );
  await fs.mkdir(path.join(dir, "node_modules/typescript/lib"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(dir, "node_modules/typescript/package.json"),
    JSON.stringify({ name: "typescript", version: "5.9.3" }),
  );
  await fs.writeFile(
    path.join(dir, "node_modules/typescript/lib/tsserver.js"),
    'require("node:fs").writeFileSync(' +
      JSON.stringify(path.join(dir, "workspace-typescript-executed")) +
      ',"unsafe");process.exit(99);',
  );
  await fs.writeFile(
    path.join(dir, "library.js"),
    "export function greet(name) { return name; }\n",
  );
  await fs.writeFile(
    path.join(dir, "main.jsx"),
    'import { greet } from "./library";\nconst result = greet("hello");\n',
  );
  const service = await engine.startService({
    rootPath: dir,
    language: "javascript",
  });
  const init = await initialize(engine, service, dir);
  assert.ok(init.capabilities.renameProvider);
  assert.ok(init.capabilities.semanticTokensProvider);
  const uri = pathToFileURL(path.join(dir, "main.jsx")).href;
  await engine.sendService({
    sessionId: service.sessionId,
    message: {
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: {
        textDocument: {
          uri,
          languageId: "javascriptreact",
          version: 1,
          text: 'import { greet } from "./library";\nconst result = greet("unsaved");\n',
        },
      },
    },
  });
  await engine.sendService({
    sessionId: service.sessionId,
    message: {
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: {
        textDocument: {
          uri: pathToFileURL(path.join(dir, "library.js")).href,
          languageId: "javascript",
          version: 1,
          text: await fs.readFile(path.join(dir, "library.js"), "utf8"),
        },
      },
    },
  });
  const definition = await engine.requestService({
    sessionId: service.sessionId,
    method: "textDocument/definition",
    params: { textDocument: { uri }, position: { line: 1, character: 18 } },
  });
  assert.ok(
    JSON.stringify(definition).includes("library.js"),
    JSON.stringify(definition),
  );
  const rename = await engine.requestService({
    sessionId: service.sessionId,
    method: "textDocument/rename",
    params: {
      textDocument: { uri: pathToFileURL(path.join(dir, "library.js")).href },
      position: { line: 0, character: 18 },
      newName: "welcome",
    },
  });
  assert.ok(
    Object.keys(rename.changes || {}).length >= 2,
    JSON.stringify(rename),
  );
  const tokens = await engine.requestService({
    sessionId: service.sessionId,
    method: "textDocument/semanticTokens/full",
    params: { textDocument: { uri } },
  });
  assert.ok(tokens.data.length > 0);
  assert.equal(
    await fs.access(path.join(dir, "workspace-typescript-executed")).then(
      () => true,
      () => false,
    ),
    false,
  );
});
test("folder scope inherits parent ignores; hidden/ignored dirty overlays obey filters; comma masks keep brace groups", async (t) => {
  const { dir, engine } = await fixture(t);
  await fs.mkdir(path.join(dir, "sub"));
  await fs.writeFile(path.join(dir, ".gitignore"), "sub/ignore.py\n");
  await fs.writeFile(path.join(dir, "sub", "keep.py"), "needle");
  await fs.writeFile(path.join(dir, "sub", "keep.js"), "needle");
  await fs.writeFile(path.join(dir, "sub", "ignore.py"), "needle");
  const result = await engine.search({
    roots: [{ id: "r", path: path.join(dir, "sub") }],
    query: "needle",
    options: { fileMask: "*.{py,jsx},*.js" },
    overlays: [
      {
        path: path.join(dir, "sub", "ignore.py"),
        text: "needle live",
        version: 1,
      },
      {
        path: path.join(dir, "sub", ".hidden.py"),
        text: "needle hidden",
        version: 1,
      },
    ],
  });
  assert.equal(result.complete, true);
  assert.deepEqual(result.results.map((r) => path.basename(r.path)).sort(), [
    "keep.js",
    "keep.py",
  ]);
  assert.equal(
    result.results.some((r) => "text" in r),
    false,
  );
});
test("pathological regex is cancellable without blocking other host requests", async (t) => {
  const { dir, engine } = await fixture(t);
  await fs.writeFile(path.join(dir, "slow.py"), "a".repeat(100000) + "!");
  const running = engine.search({
    requestId: "slow",
    roots: [{ id: "r", path: dir }],
    query: "(a+)+$",
    options: { regex: true },
  });
  await new Promise((resolve) => setTimeout(resolve, 60));
  const before = Date.now();
  await engine.request("app.info");
  assert.ok(Date.now() - before < 100);
  await engine.request("search.cancel", { requestId: "slow" });
  const result = await running;
  assert.equal(result.cancelled, true);
  assert.equal(result.complete, false);
});
test("root removal stops services and revokes saves; dependency docs are read-only", async (t) => {
  const { dir, engine } = await fixture(t);
  const outside = await fs.realpath(await temp());
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.writeFile(path.join(outside, "dependency.py"), "x=1");
  assert.equal(
    (await engine.read({ path: path.join(outside, "dependency.py") })).readonly,
    true,
  );
  await fs.writeFile(path.join(dir, "main.py"), "x=1");
  const doc = await engine.read({ path: path.join(dir, "main.py") });
  await engine.request("root.remove", { path: dir });
  await assert.rejects(
    engine.save({
      path: doc.path,
      text: "x=2",
      expectedRevision: doc.revision,
    }),
    { code: "OUTSIDE_WORKSPACE" },
  );
});
test("multiple native clients retain attached roots and isolated language sessions", async (t) => {
  const { dir, engine } = await fixture(t);
  await engine.openRoot({ path: dir, clientId: "window-one" });
  await engine.openRoot({ path: dir, clientId: "window-two" });
  const first = await engine.startService({
    rootPath: dir,
    language: "python",
    clientId: "window-one",
  });
  const second = await engine.startService({
    rootPath: dir,
    language: "python",
    clientId: "window-two",
  });
  assert.notEqual(first.sessionId, second.sessionId);
  await engine.removeRoot({ path: dir, clientId: "window-one" });
  assert.equal(engine.services.has(first.sessionId), false);
  assert.equal(engine.services.has(second.sessionId), true);
  await fs.writeFile(path.join(dir, "main.py"), "safe");
  const file = await engine.read({ path: path.join(dir, "main.py") });
  assert.equal(file.readonly, false);
});
test("CLI window reservation, single-coordinator delivery, focus and acknowledgement", async (t) => {
  const host = new Host({ cli: false });
  t.after(() => host.close());
  await host.request("app.registerWindow", { windowId: "main", focused: true });
  await host.request("app.registerWindow", {
    windowId: "second",
    focused: true,
  });
  const listed = await host.request("app.windows");
  assert.equal(listed.filter((w) => w.focused).length, 1);
  const delivered = await host.request("cli.deliver", {
    operation: "open",
    newWindow: true,
    roots: [],
  });
  assert.equal(delivered.windowId, "main");
  await host.request("app.ackRequest", { requestId: delivered.requestId });
  assert.equal(
    (await host.request("app.pendingRequests", { windowId: "main" })).length,
    0,
  );
  await host.request("app.reserveWindow", { windowId: "loading" });
  assert.equal(
    (await host.request("app.windows")).some((w) => w.id === "loading"),
    false,
  );
  await host.request("cli.deliver", {
    operation: "open",
    windowId: "loading",
    roots: [],
  });
  await host.request("app.registerWindow", {
    windowId: "loading",
    focused: true,
  });
  assert.equal(
    (await host.request("app.pendingRequests", { windowId: "loading" })).length,
    1,
  );
  await assert.rejects(
    host.request("cli.deliver", {
      operation: "open",
      windowId: "missing",
      roots: [],
    }),
    { code: "WINDOW_NOT_FOUND" },
  );
});
test("directory-based watch survives an atomic save and reports a later focused external edit", async (t) => {
  const { dir, engine } = await fixture(t),
    file = path.join(dir, "watched.py");
  await fs.writeFile(file, "x=1\n");
  const events = [];
  engine.emit = (name, payload) => events.push({ name, payload });
  const doc = await engine.read({ path: file });
  await engine.watch({ path: file });
  await engine.save({
    path: file,
    text: "x=2\n",
    expectedRevision: doc.revision,
  });
  await new Promise((resolve) => setTimeout(resolve, 80));
  events.length = 0;
  await fs.writeFile(file, "externally edited after atomic replacement\n");
  for (
    let i = 0;
    i < 50 && !events.some((e) => e.payload.type === "file-changed");
    i++
  )
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(
    events.some(
      (e) => e.payload.type === "file-changed" && e.payload.path === file,
    ),
  );
});
test("session index serializes concurrent window registrations and keeps named identity separate from keys", async (t) => {
  const { dir, engine } = await fixture(t);
  const identity = path.join(dir, "named.islet-workspace");
  await engine.saveWorkspace({
    path: identity,
    value: { schemaVersion: 1, id: "named-id", roots: [] },
  });
  const loaded = await engine.loadWorkspace({ path: identity });
  assert.equal(loaded.manifestPath, identity);
  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      engine.request("session.register", {
        entry: {
          key: "workspace:window-" + i,
          windowId: "window-" + i,
          workspaceId: "named-id",
          workspaceIdentity: identity,
          name: "Named workspace",
          dirtyCount: i,
          updated: 1000 + i,
          password: "must-not-persist",
        },
      }),
    ),
  );
  const index = await engine.request("session.list");
  assert.equal(index.length, 20);
  assert.equal(index[0].key, "workspace:window-19");
  assert.equal(index[0].workspaceIdentity, identity);
  assert.equal(JSON.stringify(index).includes("must-not-persist"), false);
  const host = new Host({ cli: false });
  t.after(() => host.close());
  await host.request("app.registerWindow", {
    windowId: "w",
    name: "Named",
    workspaceId: "named-id",
    workspaceIdentity: identity,
    focused: true,
  });
  await host.request("app.registerWindow", { windowId: "w", focused: true });
  const windows = await host.request("app.windows");
  assert.equal(windows[0].name, "Named");
  assert.equal(windows[0].workspaceIdentity, identity);
});
test("file rename rejects a symlink rather than renaming its canonical target", async (t) => {
  const { dir, engine } = await fixture(t);
  const target = path.join(dir, "target.py"),
    alias = path.join(dir, "alias.py");
  await fs.writeFile(target, "original target\n");
  await fs.symlink(target, alias);
  await assert.rejects(
    engine.rename({ path: alias, newPath: path.join(dir, "renamed.py") }),
    { code: "SYMLINK_RENAME" },
  );
  assert.equal(await fs.readFile(target, "utf8"), "original target\n");
  assert.equal((await fs.lstat(alias)).isSymbolicLink(), true);
});
test("file rename migrates its active watch to the new path", async (t) => {
  const { dir, engine } = await fixture(t),
    oldPath = path.join(dir, "before.py"),
    newPath = path.join(dir, "after.py");
  await fs.writeFile(oldPath, "before\n");
  const events = [];
  engine.emit = (name, payload) => events.push({ name, payload });
  await engine.read({ path: oldPath });
  await engine.watch({ path: oldPath });
  await engine.rename({ path: oldPath, newPath });
  events.length = 0;
  await fs.writeFile(newPath, "external after rename\n");
  for (
    let i = 0;
    i < 50 && !events.some((e) => e.payload.path === newPath);
    i++
  )
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(
    events.some(
      (e) => e.payload.type === "file-changed" && e.payload.path === newPath,
    ),
  );
  assert.equal(engine.watchers.has(oldPath), false);
  assert.equal(engine.documents.has(newPath), true);
});

test("image preview metadata avoids text reads and enforces scope, MIME and size", async (t) => {
  const { dir, engine } = await fixture(t);
  const file = path.join(dir, "preview.png");
  const bytes = await fs.readFile(
    new URL("../../src-tauri/icons/128x128.png", import.meta.url),
  );
  await fs.writeFile(file, bytes);
  const metadata = await engine.request("fs.stat", {
    path: file,
    metadataOnly: true,
  });
  assert.equal(metadata.size, bytes.length);
  assert.match(metadata.revision, /^\d+:/);
  const asset = await engine.request("fs.readAsset", { path: file });
  assert.equal(asset.mime, "image/png");
  assert.deepEqual(Buffer.from(asset.base64, "base64"), bytes);
  const svg = path.join(dir, "active.svg");
  await fs.writeFile(
    svg,
    '<svg xmlns="http://www.w3.org/2000/svg"><script>throw 1</script></svg>',
  );
  await assert.rejects(engine.request("fs.readAsset", { path: svg }), {
    code: "UNSUPPORTED_ASSET",
  });
  const large = path.join(dir, "large.png");
  await fs.writeFile(large, "");
  await fs.truncate(large, 10 * 1024 * 1024 + 1);
  await assert.rejects(engine.request("fs.readAsset", { path: large }), {
    code: "ASSET_TOO_LARGE",
  });
});
