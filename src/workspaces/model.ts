export interface Root {
  id: string;
  hostId: string;
  path: string;
  label: string;
  state?: string;
  interpreter?: string;
}
export interface Entry {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
}
export function base(path: string) {
  return path.replace(/\/$/, "").split("/").pop() || path;
}
export function isWithin(path: string, root: string) {
  return path === root || path.startsWith(root.replace(/\/$/, "") + "/");
}
export function parseLocation(value: string): { hostId: string; path: string } {
  if (value.startsWith("ssh://")) {
    const uri = new URL(value);
    if (!uri.hostname || !uri.pathname.startsWith("/"))
      throw Error("Use an absolute SSH path.");
    return {
      hostId: `ssh:${uri.username ? decodeURIComponent(uri.username) + "@" : ""}${uri.hostname}${uri.port ? ":" + uri.port : ""}`,
      path: decodeURIComponent(uri.pathname),
    };
  }
  if (!value.startsWith("/")) throw Error("Enter an absolute folder path.");
  return { hostId: "local", path: value.replace(/\/$/, "") || "/" };
}
