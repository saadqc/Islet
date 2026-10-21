import test from "node:test";
import assert from "node:assert/strict";
import { sshFolderCommand } from "../src/shell/desktopActions";
import { validatePreferences } from "../src/settings/preferences";

test("SSH folder commands preserve quoted paths and nonstandard ports", () => {
  const command = sshFolderCommand(
    "ssh:developer@example.test:2222",
    "/srv/a 'quoted' $(folder)",
  );
  assert.ok(command.startsWith("ssh -t -p 2222 -- 'developer@example.test' "));
  assert.ok(command.includes("cd -- "));
  assert.ok(command.includes("$(folder)"));
  assert.ok(command.endsWith(' && exec "${SHELL:-/bin/sh}" -l\''));
  assert.throws(() => sshFolderCommand("ssh:-oProxyCommand=bad", "/srv/app"));
  assert.throws(() => sshFolderCommand("ssh:example.test", "/srv/app\nbad"));
  assert.throws(() => sshFolderCommand("codespace:sample", "/srv/app"));
});

test("older preferences receive a system terminal without losing editor choices", () => {
  const value = validatePreferences({ fontSize: 16 });
  assert.deepEqual(value.terminal, { id: "system", path: "" });
  assert.equal(value.fontSize, 16);
  assert.deepEqual(
    validatePreferences({
      terminal: { id: "marinashell", path: "/Applications/MarinaShell.app" },
    }).terminal,
    { id: "marinashell", path: "/Applications/MarinaShell.app" },
  );
});
