import type { DocumentModel } from "../core/types";
export interface Bookmark {
  id: string;
  documentId: string;
  hostId: string;
  path: string;
  offset: number;
  line: number;
  label: string;
  context: string;
  before: string;
  after: string;
  unresolved?: boolean;
}
export class BookmarkStore {
  bookmarks: Bookmark[] = [];
  toggle(document: DocumentModel, offset: number) {
    const start = document.text.lastIndexOf("\n", offset - 1) + 1;
    const existing = this.bookmarks.find(
      (b) => b.documentId === document.id && b.offset === start,
    );
    if (existing) {
      this.bookmarks = this.bookmarks.filter((b) => b !== existing);
      return;
    }
    const lines = document.text.split("\n"),
      line = document.text.slice(0, start).split("\n").length - 1;
    this.bookmarks.push({
      id: crypto.randomUUID(),
      documentId: document.id,
      hostId: document.hostId,
      path: document.path,
      offset: start,
      line,
      label: "",
      context: lines[line],
      before: lines[line - 1] || "",
      after: lines[line + 1] || "",
    });
  }
  map(document: DocumentModel, from: number, to: number, inserted: number) {
    for (const b of this.bookmarks)
      if (b.documentId === document.id) {
        b.offset =
          b.offset < from
            ? b.offset
            : b.offset > to
              ? b.offset + inserted - (to - from)
              : from + inserted;
        b.line = document.text.slice(0, b.offset).split("\n").length - 1;
      }
  }
  relocate(document: DocumentModel) {
    const lines = document.text.split("\n");
    for (const b of this.bookmarks)
      if (b.documentId === document.id) {
        const candidates = lines.flatMap((line, i) =>
          line === b.context ? [i] : [],
        );
        const exact = candidates.filter(
          (i) =>
            (!b.before || lines[i - 1] === b.before) &&
            (!b.after || lines[i + 1] === b.after),
        );
        const chosen =
          exact.length === 1
            ? exact[0]
            : candidates.length === 1
              ? candidates[0]
              : undefined;
        b.unresolved = chosen === undefined;
        if (chosen !== undefined) {
          b.line = chosen;
          b.offset = lines
            .slice(0, chosen)
            .reduce((n, l) => n + l.length + 1, 0);
        }
      }
  }
  next(documentId: string, offset: number, direction: 1 | -1) {
    return this.bookmarks
      .filter(
        (b) =>
          b.documentId === documentId &&
          !b.unresolved &&
          (direction === 1 ? b.offset > offset : b.offset < offset),
      )
      .sort((a, b) => direction * (a.offset - b.offset))[0];
  }
}
