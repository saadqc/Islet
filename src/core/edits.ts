export interface OffsetChange { from: number; to: number; text: string; }
/** Smallest contiguous replacement; exact structured edits should be preferred for refactorings. */
export function minimalEdits(before: string, after: string): OffsetChange[] {
  if (before === after) return [];
  let from = 0, oldEnd = before.length, newEnd = after.length;
  while (from < oldEnd && from < newEnd && before[from] === after[from]) from++;
  while (oldEnd > from && newEnd > from && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd--; }
  return [{ from, to: oldEnd, text: after.slice(from, newEnd) }];
}
export function inverseEdits(before: string, edits: OffsetChange[]): OffsetChange[] {
  let delta = 0;
  return [...edits].sort((a,b)=>a.from-b.from||a.to-b.to).map(edit=> {
    const inverse = {from:edit.from+delta,to:edit.from+delta+edit.text.length,text:before.slice(edit.from,edit.to)};
    delta += edit.text.length-(edit.to-edit.from);
    return inverse;
  });
}
export function mapOffset(offset: number, edits: OffsetChange[]): number {
  let delta = 0;
  for (const edit of [...edits].sort((a,b)=>a.from-b.from||a.to-b.to)) {
    if (offset < edit.from) break;
    if (offset > edit.to || offset === edit.to && edit.to > edit.from) { delta += edit.text.length-(edit.to-edit.from); continue; }
    if (edit.from === edit.to) return edit.from+delta+edit.text.length;
    return edit.from+delta+Math.min(offset-edit.from,edit.text.length);
  }
  return offset+delta;
}
