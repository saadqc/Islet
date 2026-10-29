import type { OffsetChange } from "./edits";
export type HostId = string;
export interface Root {
  id: string;
  hostId: string;
  path: string;
  label: string;
  state?: string;
  connectionError?: string;
  interpreter?: string;
}
export interface Position {
  line: number;
  character: number;
}
export interface Range {
  start: Position;
  end: Position;
}
export interface TextEdit {
  range: Range;
  newText: string;
}
export interface FileSnapshot {
  hostId: string;
  path: string;
  text: string;
  revision: string;
  newline?: string;
  bom?: boolean;
  encoding?: string;
  readonly?: boolean;
  image?: boolean;
  /** XLS/XLSX/DOCX bytes are held as base64, including unsaved recovery snapshots. */
  binary?: boolean;
  spreadsheet?: boolean;
  docx?: boolean;
  /** Explicitly opened local file; does not attach its parent project. */
  standalone?: boolean;
  size?: number;
}
export interface LocationSnapshot {
  mode?: "preview" | "source";
  documentId: string;
  hostId: string;
  path: string;
  anchor: number;
  head: number;
  scrollTop: number;
  scrollLeft: number;
}
export interface DocumentModel extends FileSnapshot {
  id: string;
  version: number;
  diskRevision: string;
  savedText: string;
  dirty: boolean;
  pinned?: boolean;
  preview?: boolean;
  markdownMode?: "preview" | "source";
  spreadsheetMode?: "grid" | "source";
  docxZoom?: { value: number; mode: "manual" | "fit-width" };
  location?: LocationSnapshot;
  conflict?: FileSnapshot;
  pendingSaveText?: string;
  lastChange?: {
    version: number;
    before: string;
    edits: OffsetChange[];
    location?: LocationSnapshot;
  };
  saveState?: "saved" | "pending" | "conflicted" | "uncertain";
}
export const documentId = (hostId: string, path: string) =>
  JSON.stringify([hostId, path]);
export function positionAt(text: string, offset: number): Position {
  offset = Math.max(0, Math.min(offset, text.length));
  const before = text.slice(0, offset);
  const line = (before.match(/\n/g) || []).length;
  const i = before.lastIndexOf("\n");
  return { line, character: offset - i - 1 };
}
export function offsetAt(text: string, position: Position): number {
  const lines = text.split("\n");
  let at = 0;
  const line = Math.max(0, Math.min(position.line, lines.length - 1));
  for (let i = 0; i < line; i++) at += lines[i].length + 1;
  return at + Math.max(0, Math.min(position.character, lines[line].length));
}
export function isWithin(path: string, root: string): boolean {
  return path === root || path.startsWith(root.replace(/\/$/, "") + "/");
}
export function ownerOf(
  roots: Root[],
  hostId: string,
  path: string,
): Root | undefined {
  return roots
    .filter((r) => r.hostId === hostId && isWithin(path, r.path))
    .sort((a, b) => b.path.length - a.path.length)[0];
}
export function fileUri(path: string): string {
  return "file://" + path.split("/").map(encodeURIComponent).join("/");
}
export function uriPath(uri: string): string {
  const u = new URL(uri);
  if (u.protocol !== "file:" || (u.hostname && u.hostname !== "localhost"))
    throw new Error("Unsupported language-service URI");
  return decodeURIComponent(u.pathname);
}
