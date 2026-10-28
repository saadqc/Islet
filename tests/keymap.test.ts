import test from "node:test";
import assert from "node:assert/strict";
import {
  bindingFor,
  matchesBinding,
  shortcuts,
  eventBinding,
  nativeAccelerator,
} from "../src/settings/shortcuts";
import { validatePreferences } from "../src/settings/preferences";
import { hoverMarkdown } from "../src/editor/hover";
import { LanguageManager } from "../src/languages/client";
const key = (key: string, extra: object = {}) => ({
  key,
  code: "",
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...extra,
});
test("JetBrains-style tab navigation has distinct Windows and Mac defaults", () => {
  assert.equal(bindingFor("switchTab", {}, "mac"), "Ctrl-Tab");
  assert.equal(bindingFor("nextTab", {}, "windows"), "Alt-ArrowRight");
  assert.equal(bindingFor("nextTab", {}, "mac"), "Meta-Shift-]");
  assert.equal(bindingFor("deleteLine", {}, "windows"), "Ctrl-y");
  assert.equal(bindingFor("find", {}, "windows"), "Ctrl-f");
  assert.equal(bindingFor("find", {}, "mac"), "Meta-f");
  for (const platform of ["mac", "windows"] as const) {
    const seen = new Map();
    for (const id of Object.keys(shortcuts)) {
      const b = bindingFor(id, {}, platform);
      if (!b) continue;
      assert.ok(
        !seen.has(b),
        `${platform}: ${id} conflicts with ${seen.get(b)}`,
      );
      seen.set(b, id);
    }
  }
});
test("overrides, disabling, alternatives and exact modifier matching", () => {
  assert.equal(
    bindingFor("nextTab", { nextTab: "Ctrl-PageDown" }, "mac"),
    "Ctrl-PageDown",
  );
  assert.equal(bindingFor("nextTab", { nextTab: "-" }, "mac"), "");
  assert.ok(matchesBinding(key("Tab", { ctrlKey: true }), "Ctrl-Tab", true));
  assert.equal(
    matchesBinding(key("Tab", { altKey: true }), "Ctrl-Tab", true),
    false,
  );
  assert.ok(
    matchesBinding(
      key("}", { code: "BracketRight", metaKey: true, shiftKey: true }),
      "Meta-Shift-]",
      true,
    ),
  );
  assert.ok(
    matchesBinding(
      key("ß", { code: "KeyS", ctrlKey: true, altKey: true }),
      "Ctrl-Alt-s",
      true,
    ),
  );
  assert.ok(
    matchesBinding(key("f", { metaKey: true }), "Ctrl-f; Meta-f", true),
  );
  assert.equal(
    matchesBinding(key("f", { metaKey: true, shiftKey: true }), "Meta-f", true),
    false,
  );
  assert.equal(matchesBinding(key("f", { metaKey: true }), "-", true), false);
  assert.equal(
    eventBinding(
      key("}", {
        code: "BracketRight",
        metaKey: true,
        shiftKey: true,
      }) as KeyboardEvent,
    ),
    "Meta-Shift-]",
  );
});
test("preference migration retains key mappings and filters invalid saved values", () => {
  assert.equal(validatePreferences({}).keymap, "auto");
  assert.equal(validatePreferences({ keymap: "mac" }).keymap, "mac");
  assert.deepEqual(
    validatePreferences({ shortcuts: { nextTab: "Ctrl-Tab", copy: 42 } as any })
      .shortcuts,
    { nextTab: "Ctrl-Tab" },
  );
});
test("LSP markup normalization keeps Markdown and language-tagged code distinct", () => {
  assert.equal(
    hoverMarkdown({ language: "python", value: "def typed() -> str" }),
    "```python\ndef typed() -> str\n```",
  );
  assert.equal(
    hoverMarkdown([{ kind: "markdown", value: "**Docs**" }, "plain"]),
    "**Docs**\n\nplain",
  );
});
test("an unresolved hover uses a language-service definition type without inventing one", async () => {
  const manager = new LanguageManager();
  manager.roots = [{ id: "root", hostId: "local", path: "/project" } as any];
  const doc = {
    id: "a",
    hostId: "local",
    path: "/project/main.py",
    text: "value",
    version: 1,
  } as any;
  const target = {
    id: "b",
    hostId: "local",
    path: "/project/types.py",
    text: "value: str",
    version: 1,
  } as any;
  const original = {
    contents: { kind: "markdown", value: "```python\nvalue: Unknown\n```" },
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
  };
  manager.request = async (d: any) =>
    d === doc
      ? original
      : { contents: { kind: "markdown", value: "```python\nvalue: str\n```" } };
  manager.locations = async () => [
    {
      hostId: "local",
      path: target.path,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 5 },
      },
    },
  ];
  manager.documents = { open: async () => target } as any;
  const hover = await manager.hover(doc, 0);
  assert.match(hover.contents.value, /value: str/);
  assert.deepEqual(hover.range, original.range);
  manager.request = async () => original;
  const unresolved = await manager.hover(doc, 0);
  assert.equal(unresolved.unresolvedType, true);
  assert.deepEqual(unresolved.contents, original.contents);
  let opened = false;
  manager.locations = async () => [
    { hostId: "local", path: "/private/secret.py", range: original.range },
  ];
  manager.documents = {
    open: async () => {
      opened = true;
      return target;
    },
  } as any;
  await manager.hover(doc, 0);
  assert.equal(opened, false);
});

test("native menu accelerators normalize punctuation and never steal unmodified typing", () => {
  assert.equal(nativeAccelerator("Meta-,"), "Cmd+Comma");
  assert.equal(nativeAccelerator("Meta-Shift-]"), "Cmd+Shift+BracketRight");
  assert.equal(nativeAccelerator("Alt-ArrowLeft"), "Alt+Left");
  assert.equal(nativeAccelerator("m"), undefined);
  assert.equal(nativeAccelerator("Ctrl-InvalidKey"), undefined);
});

test("definition navigation without a language project or supported file returns no targets", async () => {
  const manager = new LanguageManager();
  let requested = false;
  manager.request = async () => {
    requested = true;
    throw Error("must not request");
  };
  const doc = { hostId: "local", path: "/unowned/file.py" } as any;
  assert.deepEqual(await manager.definition(doc, 0), []);
  manager.roots = [{ id: "root", hostId: "local", path: "/project" } as any];
  assert.deepEqual(
    await manager.definition({ ...doc, path: "/project/notes.txt" }, 0),
    [],
  );
  assert.equal(requested, false);
});
