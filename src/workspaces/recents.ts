import type { Root } from "../core/types";
export interface RecentProject {
  id: string;
  kind: "folder" | "workspace";
  hostId: string;
  path: string;
  name: string;
  interpreter?: string;
  updated: number;
}
export function windowTitle(roots: Root[], name: string) {
  return (
    roots[0]?.path.replace(/\/$/, "").split("/").pop() ||
    (name !== "Workspace" ? name : "Islet")
  );
}
