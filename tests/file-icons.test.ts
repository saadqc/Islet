import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileIcon } from "../src/icons/fileIcons";
import catalog from "../src/icons/catalog.json";

test("file icons distinguish languages, compound extensions and config variants", () => {
  for (const theme of ["dark", "light"] as const) {
    const icon = (name: string) => fileIcon(name, false, theme);
    assert.equal(icon("/workspace/__init__.py"), icon("main.py"));
    assert.notEqual(icon("main.py"), icon("main.js"));
    assert.notEqual(icon("AuthProvider.jsx"), icon("main.js"));
    assert.notEqual(icon("main.ts"), icon("main.js"));
    assert.notEqual(icon("component.test.tsx"), icon("component.tsx"));
    assert.notEqual(icon("test_api.py"), icon("api.py"));
    assert.equal(icon(".env_example"), icon(".env"));
    assert.equal(icon(".env.custom"), icon(".env"));
    assert.equal(icon("Dockerfile.custom"), icon("Dockerfile"));
    assert.equal(icon("README.MD"), icon("readme.md"));
    assert.equal(icon("schema.JSON"), icon("schema.json"));
    assert.notEqual(icon(".gitignore"), icon("unknown"));
    assert.notEqual(icon("pyproject.toml"), icon("unknown"));
    assert.notEqual(icon("uv.lock"), icon("unknown"));
    assert.notEqual(icon("environment.yaml"), icon("unknown"));
    for (const name of [
      "constructor",
      "__proto__",
      "toString",
      "unknown.constructor",
    ])
      assert.equal(icon(name), icon("unknown"));
    assert.equal(icon("ssh://host/work/main.py"), icon("main.py"));
    assert.equal(icon("C:\\work\\main.py"), icon("main.py"));
    assert.notEqual(
      fileIcon("tests", true, theme),
      fileIcon("plain", true, theme),
    );
  }
});

test("every bundled association resolves to an intact, passive SVG in both themes", async () => {
  const hashes = new Map(
    (await fs.readFile("public/icons/jetbrains/SHA256SUMS", "utf8"))
      .trim()
      .split("\n")
      .map((line) => {
        const [hash, name] = line.split("  ");
        return [name, hash];
      }),
  );
  assert.equal(hashes.size, 241);
  for (const theme of Object.values(catalog)) {
    const keys = [
      theme.file,
      theme.folder,
      ...Object.values(theme.fileNames),
      ...Object.values(theme.folderNames),
      ...Object.values(theme.fileExtensions),
    ];
    for (const key of keys) assert.ok(Object.hasOwn(theme.icons, key), key);
    for (const asset of Object.values(theme.icons)) {
      assert.match(asset, /^(file|folder)\/[\w.-]+\.svg$/);
      const content = await fs.readFile(`public/icons/jetbrains/${asset}`);
      assert.equal(
        createHash("sha256").update(content).digest("hex"),
        hashes.get(asset),
      );
      assert.match(content.toString(), /<svg\b/);
      assert.doesNotMatch(
        content.toString(),
        /<script\b|<foreignObject\b|\bon\w+\s*=|(?:href|src)\s*=\s*["'](?:https?:|\/\/|data:|javascript:)/i,
      );
    }
  }
});
