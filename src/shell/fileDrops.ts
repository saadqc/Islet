export async function openDroppedPaths(
  paths: string[],
  actions: {
    stat: (path: string) => Promise<{ path: string; isDirectory: boolean }>;
    contains: (path: string) => boolean;
    addRoot: (path: string) => Promise<unknown>;
    open: (path: string) => Promise<unknown>;
  },
) {
  for (const input of [...new Set(paths)]) {
    if (
      typeof input !== "string" ||
      !input.startsWith("/") ||
      /[\0\r\n]/.test(input)
    )
      throw Error("Dropped files must have absolute local paths.");
    const entry = await actions.stat(input);
    if (entry.isDirectory) {
      if (!actions.contains(entry.path)) await actions.addRoot(entry.path);
    } else {
      if (!actions.contains(entry.path))
        await actions.addRoot(
          entry.path.slice(0, entry.path.lastIndexOf("/")) || "/",
        );
      await actions.open(entry.path);
    }
  }
}
