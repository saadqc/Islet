import { onHostEvent } from "../core/bridge";
import { DocumentStore } from "../core/documents";
import { isWithin, ownerOf, type Root } from "../core/types";
import {
  TransactionService,
  type EditTransaction,
} from "../refactoring/transactions";
export interface SearchOptions {
  query: string;
  replacement?: string;
  regex?: boolean;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  fileMask?: string;
  include?: string;
  exclude?: string;
  includeHidden?: boolean;
  includeIgnored?: boolean;
  folder?: string;
  hostId?: string;
  rootIds?: string[];
  maxResults?: number;
}
export interface SearchMatch {
  hostId: string;
  path: string;
  rootId: string;
  from: number;
  to: number;
  line: number;
  column: number;
  snippet: string;
  match: string;
  replacement?: string;
  revision?: string;
  version?: number;
  selected?: boolean;
  [key: string]: any;
}
export function patternFor(options: SearchOptions): RegExp {
  const source = options.regex
    ? options.query
    : options.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    options.wholeWord
      ? "(?<![\\p{L}\\p{N}_])(?:" + source + ")(?![\\p{L}\\p{N}_])"
      : source,
    "gu" + (options.caseSensitive ? "" : "i"),
  );
}
export function replacementText(
  template: string,
  match: RegExpExecArray,
): string {
  return template.replace(/\$(\$|&|`|'|\d{1,2}|<[^>]+>)/g, (literal, part) => {
    if (part === "$") return "$";
    if (part === "&") return match[0];
    if (part === "`") return match.input.slice(0, match.index);
    if (part === "'") return match.input.slice(match.index + match[0].length);
    if (part[0] === "<") return match.groups?.[part.slice(1, -1)] ?? "";
    const index = Number(part);
    if (index > 0 && index < match.length) return match[index] ?? "";
    if (
      part.length === 2 &&
      Number(part[0]) > 0 &&
      Number(part[0]) < match.length
    )
      return (match[Number(part[0])] ?? "") + part[1];
    return literal;
  });
}
export function searchText(
  text: string,
  options: SearchOptions,
): Omit<SearchMatch, "hostId" | "path" | "rootId">[] {
  if (!options.query) return [];
  const regex = patternFor(options),
    results = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text))) {
    const from = m.index,
      to = from + m[0].length,
      line = text.slice(0, from).split("\n").length;
    const start = text.lastIndexOf("\n", from - 1) + 1,
      end = text.indexOf("\n", to);
    results.push({
      from,
      to,
      line,
      column: from - start + 1,
      snippet: text.slice(start, end < 0 ? text.length : end),
      match: m[0],
      replacement:
        options.replacement == null
          ? undefined
          : options.regex
            ? replacementText(options.replacement, m)
            : options.replacement,
      selected: true,
    });
    if (m[0].length === 0) {
      const cp = text.codePointAt(regex.lastIndex);
      regex.lastIndex += cp != null && cp > 0xffff ? 2 : 1;
    }
    if (results.length >= (options.maxResults || 10000)) break;
  }
  return results;
}
export class SearchService {
  generation = 0;
  requestId: string | undefined;
  constructor(
    public documents: DocumentStore,
    public roots: Root[],
    private scanText: typeof searchText = searchText,
  ) {}
  cancel() {
    this.generation++;
    void this.documents
      .transport("search.cancel", { requestId: this.requestId })
      .catch(() => {});
  }
  async run(
    options: SearchOptions,
    hooks: {
      onResults?: (results: SearchMatch[]) => void;
      onRootState?: (state: any) => void;
    } = {},
  ) {
    const generation = ++this.generation;
    patternFor(options);
    let roots = this.roots.filter(
      (r) => !options.rootIds?.length || options.rootIds.includes(r.id),
    );
    if (options.folder) {
      const host = options.hostId || "local";
      const root = ownerOf(roots, host, options.folder);
      if (!root)
        throw new Error(
          "Search folder is outside attached roots. Add Folder to Workspace first.",
        );
      roots = [root];
    }
    const openVersions = new Map(
      [...this.documents.documents.values()].map((d) => [
        d.id,
        { version: d.version, diskRevision: d.diskRevision },
      ]),
    );
    const overlays = [...this.documents.documents.values()]
      .filter(
        (d) =>
          d.dirty &&
          roots.some((r) => r.hostId === d.hostId && isWithin(d.path, r.path)),
      )
      .map((d) => ({
        hostId: d.hostId,
        path: d.path,
        text: d.text,
        version: d.version,
        revision: d.diskRevision,
      }));
    for (const root of roots)
      hooks.onRootState?.({ id: root.id, state: "running" });
    this.requestId = crypto.randomUUID();
    const requestId = this.requestId;
    const streamed: SearchMatch[] = [];
    const unsubscribe = await onHostEvent("host-event", (event) => {
      if (generation !== this.generation || event.requestId !== requestId)
        return;
      if (event.type === "search-results") {
        streamed.push(...(event.results || []));
        hooks.onResults?.([...streamed]);
      } else if (event.type === "search-root") hooks.onRootState?.(event);
    });
    const scopedRoots = options.folder
      ? roots.map((r) => ({ ...r, path: options.folder! }))
      : roots;
    let result: any;
    try {
      result = await this.documents.transport("search.start", {
        requestId: this.requestId,
        query: options.query,
        roots: scopedRoots,
        options: {
          ...options,
          hidden: options.includeHidden,
          ignored: options.includeIgnored,
        },
        overlays,
      });
    } finally {
      unsubscribe();
    }
    if (generation !== this.generation)
      throw new DOMException("Canceled obsolete search", "AbortError");
    const results: SearchMatch[] = (result.results || []).map(
      (r: SearchMatch) => {
        const opened = openVersions.get(JSON.stringify([r.hostId, r.path]));
        return opened && opened.diskRevision === r.revision
          ? { ...r, version: opened.version }
          : r;
      },
    );
    hooks.onResults?.(results);
    for (const state of result.roots || []) hooks.onRootState?.(state);
    return { ...result, results };
  }
  async replacementPreview(
    options: SearchOptions,
    results: SearchMatch[],
    transactions: TransactionService,
  ): Promise<EditTransaction> {
    const changes = new Map<string, { document: any; edits: any[] }>();
    const freshMatches = new Map<string,{version:number;matches:Map<string,ReturnType<typeof searchText>[number]>}>();
    const snapshots = new Map<
      string,
      { document: any; text: string; version: number; diskRevision: string }
    >();
    for (const result of results.filter((r) => r.selected !== false)) {
      const document = await this.documents.open(result.hostId, result.path);
      if (
        (result.version != null && result.version !== document.version) ||
        (result.revision && result.revision !== document.diskRevision)
      )
        throw new Error("Search preview is stale. Search again.");
      let cache=freshMatches.get(document.id);
      if(!cache||cache.version!==document.version){
        cache={version:document.version,matches:new Map(this.scanText(document.text,options).map(match=>[`${match.from}:${match.to}`,match]))};
        freshMatches.set(document.id,cache);
      }
      const fresh=cache.matches.get(`${result.from}:${result.to}`);
      if(fresh?.match!==result.match)throw new Error("Search preview changed. Search again.");
      if (!fresh) throw new Error("Search preview changed. Search again.");
      let change = changes.get(document.id);
      if (!change) {
        snapshots.set(document.id, {
          document,
          text: document.text,
          version: document.version,
          diskRevision: document.diskRevision,
        });
        changes.set(document.id, (change = { document, edits: [] }));
      }
      change.edits.push({
        from: result.from,
        to: result.to,
        text: fresh.replacement ?? "",
      });
    }
    for (const s of snapshots.values())
      if (
        s.document.version !== s.version ||
        s.document.text !== s.text ||
        s.document.diskRevision !== s.diskRevision
      )
        throw new Error(
          "Search preview is stale; document changed while loading edits",
        );
    return transactions.preview("Replace in Files", [...changes.values()]);
  }
}
