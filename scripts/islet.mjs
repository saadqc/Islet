#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
function parseRoot(input, cwd) {
  if (typeof input !== "string" || !input || input.includes("\0"))
    throw new Error("A folder path without NUL characters is required.");
  if (/^ssh:\/\//i.test(input)) {
    const url = new URL(input);
    const username = decodeURIComponent(url.username);
    if (
      url.password ||
      !url.hostname ||
      url.hostname.includes("%") ||
      /[\s@:/\\\0]/.test(username) ||
      !url.pathname.startsWith("/") ||
      url.pathname === "/"
    )
      throw new Error(
        "SSH URI requires a host and absolute folder path, without a password.",
      );
    if (url.search || url.hash)
      throw new Error("SSH URI cannot contain query or fragment.");
    const remotePath = decodeURIComponent(url.pathname);
    if (remotePath.includes("\0"))
      throw new Error("Folder paths cannot contain NUL characters.");
    const target =
      (username ? username + "@" : "") + url.hostname.toLowerCase();
    if (target.startsWith("-"))
      throw new Error("Invalid SSH host or username.");
    return {
      hostId: "ssh:" + target + (url.port ? ":" + Number(url.port) : ""),
      target,
      port: url.port ? Number(url.port) : undefined,
      path: path.posix.normalize(remotePath).replace(/\/+$/, "") || "/",
    };
  }
  if (path.win32.isAbsolute(input) && !path.isAbsolute(input))
    throw new Error("Windows folder paths are not supported on this host.");
  return {
    hostId: "local",
    path: path.resolve(cwd, input.replace(/^~(?=\/|$)/, os.homedir())),
  };
}
const rootKey = (root) => JSON.stringify([root.hostId, root.path]);
export function parseArgs(args, cwd = process.cwd()) {
  let operation = "open",
    windowId,
    workspace,
    newWindow = false,
    json = false,
    stop = false;
  const roots = [],
    bindings = new Map(),
    errors = [];
  if (["open", "add", "windows"].includes(args[0])) operation = args.shift();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!stop && arg === "--") {
      stop = true;
      continue;
    }
    if (!stop && arg === "--window") {
      windowId = args[++i];
      if (!windowId || windowId.startsWith("--"))
        throw new Error("--window requires a window ID.");
      continue;
    }
    if (!stop && arg === "--workspace") {
      workspace = args[++i];
      if (!workspace || workspace.startsWith("--"))
        throw new Error("--workspace requires a path.");
      workspace = path.resolve(cwd, workspace);
      continue;
    }
    if (!stop && arg === "--python-interpreter") {
      const selector = args[++i],
        interpreter = args[++i];
      if (
        !selector ||
        selector.startsWith("--") ||
        !interpreter ||
        interpreter.startsWith("--")
      )
        throw new Error(
          "--python-interpreter requires a folder or SSH URI and an absolute executable path.",
        );
      const root = parseRoot(selector, cwd);
      const absolute =
        root.hostId === "local"
          ? path.isAbsolute(interpreter)
          : path.posix.isAbsolute(interpreter);
      if (!absolute || interpreter.includes("\0"))
        throw new Error(
          "--python-interpreter requires a nonempty absolute executable path on the selected host.",
        );
      const key = rootKey(root),
        previous = bindings.get(key);
      if (previous && previous.interpreter !== interpreter)
        throw new Error(
          "Conflicting Python interpreters were supplied for the same root.",
        );
      bindings.set(key, { ...root, interpreter });
      continue;
    }
    if (!stop && arg === "--new-window") {
      newWindow = true;
      continue;
    }
    if (!stop && arg === "--json") {
      json = true;
      continue;
    }
    if (!stop && arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    try {
      roots.push(parseRoot(arg, cwd));
    } catch (e) {
      errors.push({ input: arg, error: e.message });
    }
  }
  const unique = [...new Map(roots.map((r) => [rootKey(r), r])).values()];
  if (!workspace)
    for (const [key, binding] of bindings) {
      const root = unique.find((r) => rootKey(r) === key);
      if (root) root.interpreter = binding.interpreter;
      else unique.push(binding);
    }
  if (operation === "windows" && (unique.length || workspace || bindings.size))
    throw new Error("windows does not accept roots.");
  if (operation === "add" && workspace)
    throw new Error("Use open --workspace to restore a workspace.");
  return {
    operation,
    windowId,
    workspace,
    newWindow: operation === "open" ? newWindow || !windowId : false,
    json,
    roots: unique,
    ...(workspace
      ? {
          interpreterOverrides: [...bindings.values()].map(
            ({ hostId, path, interpreter }) => ({ hostId, path, interpreter }),
          ),
        }
      : {}),
    errors,
    requestId: crypto.randomUUID(),
  };
}
const dataDir = () =>
  process.env.ISLET_DATA_DIR ||
  path.join(
    os.homedir(),
    process.platform === "darwin"
      ? "Library/Application Support/Islet"
      : ".local/share/islet",
  );
const send = (registry, operation, request) =>
  new Promise((resolve, reject) => {
    const client = net.createConnection(registry.socket);
    let data = "";
    const timer = setTimeout(() => {
      client.destroy();
      reject(new Error("Application did not acknowledge the request."));
    }, 5000);
    client.on("connect", () =>
      client.write(
        JSON.stringify({ token: registry.token, operation, request }) + "\n",
      ),
    );
    client.on("data", (d) => (data += d));
    client.on("end", () => {
      clearTimeout(timer);
      try {
        const response = JSON.parse(data);
        response.error
          ? reject(
              Object.assign(new Error(response.error.message), response.error),
            )
          : resolve(response.result);
      } catch (e) {
        reject(e);
      }
    });
    client.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
export async function main(args) {
  const request = parseArgs([...args]);
  for (const error of request.errors)
    console.error(`${error.input}: ${error.error}`);
  if (request.errors.length && !request.roots.length)
    throw new Error("No valid roots to open.");
  const registries = [];
  try {
    for (const filename of await fs.readdir(dataDir()))
      if (/^ipc-\d+\.json$/.test(filename)) {
        try {
          const r = JSON.parse(
            await fs.readFile(path.join(dataDir(), filename), "utf8"),
          );
          process.kill(r.pid, 0);
          registries.push(r);
        } catch {}
      }
  } catch {}
  if (request.operation === "windows") {
    const windows = (
      await Promise.all(
        registries.map((r) => send(r, "windows").catch(() => [])),
      )
    ).flat();
    console.log(
      request.json
        ? JSON.stringify(windows)
        : windows.map((w) => `${w.id}\t${w.name}`).join("\n"),
    );
    return;
  }
  if (!registries.length) {
    if (request.operation === "add")
      throw new Error("Islet is not running. Open a workspace first.");
    const app = process.env.ISLET_APP_PATH || "/Applications/Islet.app";
    if (process.platform === "darwin") {
      await new Promise((resolve, reject) => {
        const child = spawn("/usr/bin/open", ["-a", app, "--args", ...args], {
          stdio: "inherit",
        });
        child.on("error", reject);
        child.on("exit", (code) =>
          code === 0
            ? resolve()
            : reject(
                new Error(
                  "Could not launch Islet. Set ISLET_APP_PATH to the built application.",
                ),
              ),
        );
      });
      return;
    }
    throw new Error("Islet is not running. Launch the application first.");
  }
  let choices = registries;
  if (request.windowId) {
    choices = [];
    for (const r of registries) {
      const windows = await send(r, "windows");
      if (windows.some((w) => w.id === request.windowId)) choices.push(r);
    }
  }
  if (choices.length !== 1)
    throw new Error(
      choices.length
        ? "Several Islet instances are running. Target a window explicitly."
        : "Requested window was not found.",
    );
  const result = await send(choices[0], "deliver", request);
  console.log(
    `Delivered ${result.requestId}${result.windowId ? " to " + result.windowId : ""}`,
  );
  if (request.errors.length) process.exitCode = 1;
}
if (import.meta.url === new URL(process.argv[1], "file://").href)
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    if (e.details?.windows) console.error(JSON.stringify(e.details.windows));
    process.exitCode = 1;
  });
