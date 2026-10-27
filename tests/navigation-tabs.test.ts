import test from "node:test";
import assert from "node:assert/strict";
import { NavigationHistory } from "../src/navigation/history";
import { openDroppedPaths } from "../src/shell/fileDrops";

test("semantic destinations remain unique across A B A B and retain latest exact viewport", () => {
  const history = new NavigationHistory();
  const a = {
    documentId: "a",
    hostId: "local",
    path: "/a.py",
    anchor: 10,
    head: 10,
    scrollTop: 20,
    scrollLeft: 0,
  };
  const b = {
    ...a,
    documentId: "b",
    path: "/b.py",
    anchor: 90,
    head: 90,
    scrollTop: 800,
  };
  history.push(a, b);
  history.push({ ...b, scrollTop: 900 }, { ...a, scrollTop: 30 });
  history.push({ ...a, scrollTop: 40 }, { ...b, scrollTop: 1000 });
  assert.equal(history.entries.length, 2);
  assert.deepEqual(history.back(), { ...a, scrollTop: 40 });
  assert.deepEqual(history.forward(), { ...b, scrollTop: 1000 });
  const reader = { ...a, mode: "preview" as const, anchor: 0, head: 0 };
  history.push(reader, { ...reader, scrollTop: 600 });
  assert.equal(history.back()?.scrollTop, reader.scrollTop);
});

test("explicit native multi-file drops open files standalone, add only dropped folders and preserve tabs", async () => {
  const roots = ["/existing"],
    tabs = ["/existing/original.py"],
    calls: string[] = [];
  const actions = {
    stat: async (path: string) => ({
      path,
      isDirectory: path === "/other/folder",
    }),
    contains: (path: string) =>
      roots.some((root) => path === root || path.startsWith(root + "/")),
    addRoot: async (path: string) => {
      roots.push(path);
      calls.push(path);
    },
    open: async (path: string) => {
      if (!tabs.includes(path)) tabs.push(path);
    },
  };
  await openDroppedPaths(
    [
      "/existing/a.py",
      "/outside/b.py",
      "/outside/c.py",
      "/other/folder",
      "/outside/b.py",
    ],
    actions,
  );
  assert.deepEqual(tabs, [
    "/existing/original.py",
    "/existing/a.py",
    "/outside/b.py",
    "/outside/c.py",
  ]);
  assert.deepEqual(calls, ["/other/folder"]);
  await assert.rejects(
    () => openDroppedPaths(["relative.py"], actions),
    /absolute local paths/,
  );
});
