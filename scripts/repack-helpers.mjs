import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
const root = path.resolve(import.meta.dirname, "..");
for (const arch of ["x64", "arm64"]) {
  const stage = path.join(root, ".tools", "remote-" + arch);
  await fs.access(path.join(stage, "node"));
  for (const name of [
    "host.mjs",
    "engine.mjs",
    "askpass.mjs",
    "regex-worker.mjs",
  ])
    await fs.copyFile(
      path.join(root, "remote-helper", name),
      path.join(stage, name),
    );
  const target = path.join(
    root,
    "src-tauri/resources/remote",
    `islet-0.1.0-linux-${arch}.tar.gz`,
  );
  await new Promise((resolve, reject) => {
    const p = spawn("tar", ["-czf", target, "-C", stage, "."], {
      stdio: "inherit",
    });
    p.on("error", reject);
    p.on("exit", (c) =>
      c === 0 ? resolve() : reject(new Error("Tar failed")),
    );
  });
  await fs.writeFile(
    target + ".sha256",
    crypto
      .createHash("sha256")
      .update(await fs.readFile(target))
      .digest("hex") + "\n",
  );
  console.log("Refreshed remote " + arch + " helper package");
}
