import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = {
  ...process.env,
  ISLET_DEV_TOKEN: randomBytes(32).toString("hex"),
  ISLET_DATA_DIR:
    process.env.ISLET_DATA_DIR || path.join(cwd, ".tools", "dev-data"),
};
const children = [
  spawn(process.execPath, ["remote-helper/dev-host.mjs"], {
    cwd,
    env,
    stdio: "inherit",
  }),
  spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"],
    { cwd, env, stdio: "inherit" },
  ),
];
let closing = false;
function close() {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(), 1500).unref();
}
for (const child of children) child.on("exit", () => close());
process.on("SIGINT", close);
process.on("SIGTERM", close);
setTimeout(close, 60 * 60 * 1000).unref();
