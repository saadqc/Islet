import { request } from "../core/bridge";
export interface FileItem {
  hostId: string;
  path: string;
}
export const FILE_ITEM_MIME = "application/x-islet-file";
export function droppedItem(data: DataTransfer): FileItem | undefined {
  try {
    const item = JSON.parse(data.getData(FILE_ITEM_MIME));
    if (
      typeof item.hostId === "string" &&
      typeof item.path === "string" &&
      item.path.startsWith("/") &&
      !/[\0\r\n]/.test(item.path)
    )
      return item;
  } catch {}
}
export function folderAtPoint(
  x: number,
  y: number,
  scale = 1,
): FileItem | undefined {
  const folder = document
    .elementFromPoint(x / scale, y / scale)
    ?.closest<HTMLElement>("[data-drop-host][data-drop-path]");
  return folder
    ? { hostId: folder.dataset.dropHost!, path: folder.dataset.dropPath! }
    : undefined;
}
export const copyFiles = (sources: FileItem[], target: FileItem) =>
  request("files.copy", { sources, target });
export const copyToClipboard = (item: FileItem) =>
  request("desktop.clipboard.copyFiles", {
    hostId: item.hostId,
    paths: [item.path],
  });
export async function pasteFiles(target: FileItem) {
  if (target.hostId !== "local")
    throw new Error(
      "Use drag-and-drop to copy local files into an SSH folder.",
    );
  const paths = await request<string[]>("desktop.clipboard.readFiles");
  if (!paths.length)
    throw new Error("Copy a file or folder in Islet or Finder first.");
  return copyFiles(
    paths.map((path) => ({ hostId: "local", path })),
    target,
  );
}
export async function downloadFile(item: FileItem, folder: boolean) {
  const name = item.path.replace(/\/$/, "").split("/").pop() || "download";
  const destination = await request<string | null>("dialog.save", {
    title: folder ? "Download Folder as ZIP" : "Download File",
    defaultName: name + (folder ? ".zip" : ""),
  });
  if (!destination) return;
  return request("files.download", { ...item, destination, overwrite: true });
}
