import { uriPath, type Range } from "../core/types";
import type { LanguageLocation } from "./client";

export interface CallItem {
  name: string;
  kind: number;
  uri: string;
  range: Range;
  selectionRange: Range;
  detail?: string;
  data?: unknown;
}
export interface CallerNode {
  key: string;
  name: string;
  detail?: string;
  location: LanguageLocation;
  callLines: number[];
  children: CallerNode[];
  recursive?: boolean;
  truncated?: boolean;
}
export interface CallerTree {
  target: CallerNode;
  truncated: boolean;
}
export function callKey(item: CallItem) {
  return JSON.stringify([
    item.uri,
    item.selectionRange.start.line,
    item.selectionRange.start.character,
  ]);
}
export async function loadCallerTree(
  target: CallItem,
  hostId: string,
  incoming: (
    item: CallItem,
  ) => Promise<{ from: CallItem; fromRanges: Range[] }[]>,
  signal?: AbortSignal,
): Promise<CallerTree> {
  let remaining = 60,
    truncated = false;
  const check = () => {
    if (signal?.aborted) throw new DOMException("Canceled", "AbortError");
  };
  const node = (item: CallItem): CallerNode => ({
    key: callKey(item),
    name: item.name,
    detail: item.detail,
    location: { hostId, path: uriPath(item.uri), range: item.selectionRange },
    callLines: [],
    children: [],
  });
  const root = node(target);
  async function visit(
    parent: CallerNode,
    item: CallItem,
    depth: number,
    ancestors: Set<string>,
  ) {
    check();
    const calls = await incoming(item);
    check();
    const unique = new Map<string, { from: CallItem; fromRanges: Range[] }>();
    for (const call of calls || []) {
      const key = callKey(call.from),
        prior = unique.get(key);
      if (prior) prior.fromRanges.push(...(call.fromRanges || []));
      else
        unique.set(key, { ...call, fromRanges: [...(call.fromRanges || [])] });
    }
    for (const call of unique.values()) {
      if (remaining === 0 || parent.children.length === 20) {
        parent.truncated = truncated = true;
        break;
      }
      remaining--;
      const child = node(call.from);
      child.callLines = [
        ...new Set(call.fromRanges.map((range) => range.start.line + 1)),
      ];
      parent.children.push(child);
      if (ancestors.has(child.key)) {
        child.recursive = true;
        continue;
      }
      if (depth < 5)
        await visit(
          child,
          call.from,
          depth + 1,
          new Set([...ancestors, child.key]),
        );
    }
  }
  await visit(root, target, 1, new Set([root.key]));
  return { target: root, truncated };
}
