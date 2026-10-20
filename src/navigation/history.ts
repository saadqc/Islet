import type { LocationSnapshot } from "../core/types";
export class NavigationHistory {
  entries: LocationSnapshot[] = [];
  index = -1;
  push(origin: LocationSnapshot | undefined, destination: LocationSnapshot) {
    if (origin) {
      if (this.index < 0 || !same(this.entries[this.index], origin)) {
        this.entries = this.entries.slice(0, this.index + 1);
        this.entries.push({ ...origin });
        this.index++;
      } else this.entries[this.index] = { ...origin };
    }
    if (same(this.entries[this.index], destination)) return;
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push({ ...destination });
    this.index = this.entries.length - 1;
  }
  back(current?: LocationSnapshot) {
    if (this.index <= 0) return;
    if (current) this.entries[this.index] = { ...current };
    return { ...this.entries[--this.index] };
  }
  forward(current?: LocationSnapshot) {
    if (this.index >= this.entries.length - 1) return;
    if (current) this.entries[this.index] = { ...current };
    return { ...this.entries[++this.index] };
  }
  get canBack() {
    return this.index > 0;
  }
  get canForward() {
    return this.index < this.entries.length - 1;
  }
  map(documentId: string, from: number, to: number, inserted: number) {
    for (const e of this.entries)
      if (e.documentId === documentId) {
        e.anchor = map(e.anchor, from, to, inserted);
        e.head = map(e.head, from, to, inserted);
      }
  }
}
function same(a: LocationSnapshot | undefined, b: LocationSnapshot) {
  return (
    !!a &&
    a.documentId === b.documentId &&
    a.mode === b.mode &&
    a.anchor === b.anchor &&
    a.head === b.head &&
    a.scrollTop === b.scrollTop &&
    a.scrollLeft === b.scrollLeft
  );
}
function map(pos: number, from: number, to: number, inserted: number) {
  return pos < from
    ? pos
    : pos > to
      ? pos + inserted - (to - from)
      : from + inserted;
}
