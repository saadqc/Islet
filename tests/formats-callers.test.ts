import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { highlightTree, classHighlighter } from "@lezer/highlight";
import { language, syntaxName } from "../src/editor/languages";
import { loadCallerTree, type CallItem } from "../src/languages/callers";
import { DocumentStore } from "../src/core/documents";
import { validatePreferences } from "../src/settings/preferences";

const samples = [
  ["settings.JSON", "JSON", '{"name":"islet","enabled":true,"count":3}'],
  ["config.yaml", "YAML", 'name: "islet"\nenabled: true\n'],
  ["config.yml", "YAML", 'name: "islet"\n'],
  ["pyproject.toml", "TOML", '[project]\nname = "islet"\nversion = "1.0"'],
  ["build.sh", "Shell", '#!/bin/bash\nif true; then echo "ready"; fi'],
  ["schema.xml", "XML", '<project name="islet"><item>value</item></project>'],
  ["query.sql", "SQL", "SELECT name FROM projects WHERE id = 2;"],
  ["config.ini", "INI", "[settings]\nname=islet\n# configuration"],
  ["Dockerfile", "Dockerfile", 'FROM node:24\nWORKDIR /app\nRUN echo "ready"'],
  [
    "requirements-dev.txt",
    "Requirements",
    "fastapi>=0.1\n-r requirements.txt\n# dependencies",
  ],
];
for (const [path, name, text] of samples)
  test(`${name} has a real syntax parser and colored tokens`, () => {
    assert.equal(syntaxName(path, text), name);
    const state = EditorState.create({
      doc: text,
      extensions: [language(path, text)],
    });
    const tree = ensureSyntaxTree(state, text.length, 1000)!;
    assert.ok(tree);
    const tokens: string[] = [];
    highlightTree(tree, classHighlighter, (_a, _b, classes) =>
      tokens.push(classes),
    );
    assert.ok(tokens.length > 1, `${path} has no syntax tokens`);
  });
test("extensionless scripts and common project filenames select appropriate syntax", () => {
  for (const [path, text, expected] of [
    ["deploy", "#!/usr/bin/env bash\necho ok", "Shell"],
    ["Dockerfile.dev", "", "Dockerfile"],
    ["Containerfile", "", "Dockerfile"],
    ["uv.lock", "", "TOML"],
    [".env.local", "", "INI"],
    ["unknown.txt", "", "Plain Text"],
  ])
    assert.equal(syntaxName(path, text), expected);
});
const item = (name: string): CallItem => ({
  name,
  kind: 12,
  uri: `file:///project/${name}.py`,
  range: { start: { line: 3, character: 0 }, end: { line: 8, character: 0 } },
  selectionRange: {
    start: { line: 3, character: 4 },
    end: { line: 3, character: 4 + name.length },
  },
});
test("caller graph deduplicates call sites, retains branches and terminates recursion", async () => {
  const leaf = item("leaf"),
    parent = item("parent");
  const tree = await loadCallerTree(leaf, "ssh:test", async (node) =>
    node.name === "leaf"
      ? [
          { from: parent, fromRanges: [leaf.range] },
          { from: parent, fromRanges: [parent.range] },
        ]
      : [{ from: leaf, fromRanges: [leaf.range] }],
  );
  assert.equal(tree.target.children.length, 1);
  assert.equal(tree.target.children[0].children[0].recursive, true);
  assert.equal(tree.target.children[0].location.hostId, "ssh:test");
  assert.equal(tree.target.children[0].location.range.start.line, 3);
});
test("caller expansion stops at five parent levels and enforces a bounded fan-out", async () => {
  let requests = 0;
  const tree = await loadCallerTree(item("0"), "local", async (node) => {
    requests++;
    return [{ from: item(String(Number(node.name) + 1)), fromRanges: [] }];
  });
  let node = tree.target,
    depth = 0;
  while (node.children.length) {
    depth++;
    node = node.children[0];
  }
  assert.equal(depth, 5);
  assert.equal(requests, 5);
  const wide = await loadCallerTree(item("leaf"), "local", async (node) =>
    node.name === "leaf"
      ? Array.from({ length: 70 }, (_, i) => ({
          from: item(String(i)),
          fromRanges: [],
        }))
      : [],
  );
  assert.equal(wide.target.children.length, 20);
  assert.equal(wide.truncated, true);
});
test("image tabs keep metadata only, remain read-only and refresh without text decoding", async () => {
  const calls: string[] = [];
  let revision = "1";
  const store = new DocumentStore(async (operation, payload) => {
    calls.push(operation);
    assert.equal(payload.metadataOnly, true);
    return {
      hostId: "local",
      path: "/project/photo.png",
      revision,
      size: 32,
    } as any;
  });
  const doc = await store.open("local", "/project/photo.png");
  assert.equal(doc.image, true);
  assert.equal(doc.readonly, true);
  assert.equal(doc.text, "");
  await assert.rejects(store.save(doc.id), /read-only/);
  revision = "2";
  assert.equal(await store.checkExternal(doc.id), true);
  assert.equal(doc.revision, "2");
  assert.deepEqual(calls, ["fs.stat", "fs.stat"]);
  assert.equal(JSON.stringify(store.snapshot()).includes("base64"), false);
});
test("caller panel is opt-in and validates persisted preference", () => {
  assert.equal(validatePreferences({}).callerPanel, false);
  assert.equal(validatePreferences({ callerPanel: true }).callerPanel, true);
  assert.equal(
    validatePreferences({ callerPanel: "false" as any }).callerPanel,
    false,
  );
});
