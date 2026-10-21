import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Engine } from "../remote-helper/engine.mjs";
import { emitHostEvent, type Request } from "../src/core/bridge";
import { DocumentStore } from "../src/core/documents";
import type { Root } from "../src/core/types";
import { LanguageManager } from "../src/languages/client";
import {
  attachWorkspaceRoot,
  mergeManifestRoots,
} from "../src/workspaces/roots";

const root = (hostId = "local", interpreter?: string): Root => ({
  hostId,
  id: hostId + ":root",
  path: "/project",
  label: "Fixture",
  interpreter,
});

test("manifest root configuration preserves omitted choices and honors explicit override/reset per host", () => {
  const previous = [
    root("local", "/env/local/python"),
    root("ssh:fixture", "/env/remote/python"),
  ];
  const merged = mergeManifestRoots(previous, [
    root(),
    root("ssh:fixture", "/env/selected/python"),
  ]);
  assert.equal(merged[0].interpreter, "/env/local/python");
  assert.equal(merged[1].interpreter, "/env/selected/python");
  assert.equal(
    mergeManifestRoots(previous, [root("local", "")])[0].interpreter,
    "",
  );
});

test("root attachment forwards client identity and preserves per-host configuration across add/open", async () => {
  const calls: any[] = [];
  const transport: Request = async <T>(operation: string, payload: any) => {
    calls.push({ operation, payload });
    return {
      ...payload,
      id: payload.hostId + ":root",
      state: "ready",
      label: "Fixture",
    } as T;
  };
  const manager = new LanguageManager(transport);
  manager.roots = [
    root("local", "/env/local/python"),
    root("ssh:fixture", "/env/remote/python"),
  ];
  await attachWorkspaceRoot(
    { hostId: "local", path: "/project" },
    manager,
    transport,
  );
  assert.equal(calls[0].payload.clientId, manager.clientId);
  assert.equal(calls[0].payload.interpreter, "/env/local/python");
  await attachWorkspaceRoot(
    {
      hostId: "ssh:fixture",
      path: "/project",
      interpreter: "/env/override/python",
    },
    manager,
    transport,
  );
  assert.equal(manager.roots[0].interpreter, "/env/local/python");
  assert.equal(manager.roots[1].interpreter, "/env/override/python");
  await attachWorkspaceRoot(
    { hostId: "local", path: "/project", interpreter: "" },
    manager,
    transport,
  );
  assert.equal(manager.roots[0].interpreter, "");
  await manager.close();
});

test("interpreter restart rejects and stops an old language startup completing later", async () => {
  let start!: (value: any) => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => (entered = resolve));
  const response = new Promise((resolve) => (start = resolve));
  const stopped: string[] = [];
  const manager = new LanguageManager((async (operation, payload) => {
    if (operation === "lsp.start") {
      entered();
      return response;
    }
    if (operation === "lsp.stop") {
      stopped.push(payload.sessionId);
      return true;
    }
    throw Error("Unexpected operation: " + operation);
  }) as Request);
  const selected = root("local", "/env/first/python");
  manager.roots = [selected];
  const pending = manager.ensure(selected);
  const rejected = assert.rejects(pending, /restarted/);
  await started;
  await manager.updateRoot({ ...selected, interpreter: "/env/second/python" });
  start({ sessionId: "old-startup" });
  await rejected;
  assert.deepEqual(stopped, ["old-startup"]);
  assert.equal(manager.sessions.size, 0);
  await manager.close();
});

test(
  "manifest to root.open to real LSP uses an external interpreter, detects version and restarts only that root",
  { timeout: 120000 },
  async () => {
    const temporary = await fs.mkdtemp(
      path.join(os.tmpdir(), "islet-interpreter-"),
    );
    const project = path.join(temporary, "project"),
      otherProject = path.join(temporary, "other-project");
    await fs.mkdir(project);
    await fs.mkdir(otherProject);
    const source =
      "import islet_selected_environment\nislet_selected_environment.";
    await fs.writeFile(path.join(project, "main.py"), source);
    await fs.writeFile(path.join(otherProject, "main.py"), "value = 1\n");
    await fs.writeFile(path.join(project, "main.js"), "const value = 1;\n");
    const interpreters: string[] = [];
    for (const [index, marker] of [
      "first_environment_marker",
      "second_environment_marker",
    ].entries()) {
      const environment = path.join(temporary, "external-environment-" + index);
      execFileSync(process.env.ISLET_PYTHON || "python3", [
        "-m",
        "venv",
        "--without-pip",
        environment,
      ]);
      const interpreter = path.join(environment, "bin/python");
      const site = execFileSync(
        interpreter,
        ["-c", "import sysconfig; print(sysconfig.get_paths()['purelib'])"],
        { encoding: "utf8" },
      ).trim();
      await fs.mkdir(site, { recursive: true });
      await fs.writeFile(
        path.join(site, "islet_selected_environment.py"),
        `def ${marker}() -> str:\n    return 'fixture'\n`,
      );
      interpreters.push(interpreter);
    }
    const version = execFileSync(
      interpreters[0],
      [
        "-c",
        "import sys; print(str(sys.version_info.major) + '.' + str(sys.version_info.minor))",
      ],
      { encoding: "utf8" },
    ).trim();
    const logs: string[] = [];
    const engine = new Engine({
      dataDir: path.join(temporary, "state"),
      runtimeDir: path.resolve("node_modules"),
      emit: (name: string, payload: any) => {
        if (payload.message?.method === "window/logMessage")
          logs.push(payload.message.params.message);
        emitHostEvent(name, payload);
      },
    });
    const transport = engine.request.bind(engine) as Request;
    const documents = new DocumentStore(transport),
      languages = new LanguageManager(transport);
    languages.documents = documents;
    try {
      const manifestPath = path.join(temporary, "fixture.islet-workspace");
      await engine.request("workspace.save", {
        path: manifestPath,
        value: {
          schemaVersion: 1,
          id: "fixture",
          roots: [
            {
              id: "first",
              hostId: "local",
              path: project,
              label: "First",
              interpreter: interpreters[0],
            },
            {
              id: "other",
              hostId: "local",
              path: otherProject,
              label: "Other",
              interpreter: interpreters[0],
            },
          ],
        },
      });
      const manifest = await engine.request("workspace.load", {
        path: manifestPath,
      });
      for (const item of manifest.roots)
        await attachWorkspaceRoot(item, languages, transport);
      const document = await documents.open(
        "local",
        path.join(project, "main.py"),
      );
      const other = await documents.open(
        "local",
        path.join(otherProject, "main.py"),
      );
      const javascript = await documents.open(
        "local",
        path.join(project, "main.js"),
      );
      const first = await languages.request(
        document,
        "textDocument/completion",
        source.length,
      );
      assert.ok(
        (first.items || first).some(
          (item: any) => item.label === "first_environment_marker",
        ),
      );
      assert.equal(languages.interpreterFor(document), interpreters[0]);
      await languages.ensure(languages.roots[1], other);
      await languages.ensure(languages.roots[0], javascript);
      const sessions = [...languages.sessions.values()];
      const oldPython = sessions.find(
        (session) =>
          session.root.id === "first" && session.language === "python",
      )!.sessionId;
      const otherPython = sessions.find(
        (session) => session.root.id === "other",
      )!.sessionId;
      const javascriptId = sessions.find(
        (session) => session.language === "javascript",
      )!.sessionId;
      await attachWorkspaceRoot(
        { hostId: "local", path: project },
        languages,
        transport,
      );
      assert.ok(
        [...languages.sessions.values()].some(
          (session) => session.sessionId === oldPython,
        ),
      );
      await attachWorkspaceRoot(
        { hostId: "local", path: project, interpreter: interpreters[1] },
        languages,
        transport,
      );
      const second = await languages.request(
        document,
        "textDocument/completion",
        source.length,
      );
      assert.ok(
        (second.items || second).some(
          (item: any) => item.label === "second_environment_marker",
        ),
      );
      assert.ok(
        !(second.items || second).some(
          (item: any) => item.label === "first_environment_marker",
        ),
      );
      assert.equal(languages.interpreterFor(document), interpreters[1]);
      assert.equal(languages.interpreterFor(other), interpreters[0]);
      assert.ok(
        ![...languages.sessions.values()].some(
          (session) => session.sessionId === oldPython,
        ),
      );
      assert.ok(
        [...languages.sessions.values()].some(
          (session) => session.sessionId === otherPython,
        ),
      );
      const unchangedJavascript = await languages.ensure(
        languages.roots[0],
        javascript,
      );
      assert.equal(unchangedJavascript?.sessionId, javascriptId);
      assert.ok(
        logs.some((message) =>
          message.includes("Assuming Python version " + version),
        ),
        "LSP reports selected Python version; logs: " + logs.join("\n"),
      );
    } finally {
      await languages.close();
      await engine.close();
      await fs.rm(temporary, { recursive: true, force: true });
    }
  },
);
