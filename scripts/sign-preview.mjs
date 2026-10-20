import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
export const runSigningCommand = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Preview code signing failed (${code}).`)),
    );
  });
export async function signPreview(
  app,
  { platform = process.platform, run = runSigningCommand } = {},
) {
  if (platform !== "darwin")
    throw new Error("macOS preview signing requires macOS.");
  if (!app || !path.isAbsolute(app) || !app.endsWith(".app"))
    throw new Error("An absolute .app bundle path is required.");
  await run("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", app]);
  await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
  console.log("Locally ad-hoc signed and verified. Not notarized.");
  return app;
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  if (process.platform === "darwin")
    await signPreview(
      path.resolve(
        process.argv[2] ||
          path.join(
            import.meta.dirname,
            "../src-tauri/target/release/bundle/macos/Islet.app",
          ),
      ),
    );
  else console.log("macOS preview signing skipped on this platform.");
}
