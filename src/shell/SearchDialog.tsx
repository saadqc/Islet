import { useEffect, useRef, useState } from "react";
import { FolderOpen, Search, Square } from "lucide-react";
import { Modal } from "./Modal";
import { request, onHostEvent } from "../core/bridge";
import { Root, isWithin, parseLocation } from "../workspaces/model";
import { SearchService, type SearchOptions } from "../search/search";
import { DocumentStore } from "../core/documents";
import {
  TransactionService,
  type EditTransaction,
} from "../refactoring/transactions";
export function SearchDialog({
  roots,
  documents,
  transactions,
  replace,
  initial,
  onClose,
  onOpen,
  onPreview,
}: {
  roots: Root[];
  documents: DocumentStore;
  transactions: TransactionService;
  replace: boolean;
  initial?: { root: Root; path: string };
  onClose: () => void;
  onOpen: (host: string, path: string, offset?: number) => void;
  onPreview: (tx: EditTransaction) => void;
}) {
  const [query, setQuery] = useState(""),
    [replacement, setReplacement] = useState(""),
    [folder, setFolder] = useState(initial?.path || ""),
    [host, setHost] = useState(initial?.root.hostId || "local"),
    [scope, setScope] = useState(initial ? "folder" : "workspace"),
    [regex, setRegex] = useState(false),
    [caseSensitive, setCase] = useState(false),
    [wholeWord, setWord] = useState(false),
    [mask, setMask] = useState(""),
    [include, setInclude] = useState(""),
    [exclude, setExclude] = useState(""),
    [hidden, setHidden] = useState(false),
    [ignored, setIgnored] = useState(false),
    [results, setResults] = useState<any[]>([]),
    [states, setStates] = useState<any[]>([]),
    [error, setError] = useState(""),
    [running, setRunning] = useState(false),
    [selected, setSelected] = useState<Set<number>>(new Set()),
    [browsing, setBrowsing] = useState(false),
    [folders, setFolders] = useState<any[]>([]);
  const service = useRef(new SearchService(documents, roots));
  service.current.roots = roots;
  const [selectedRoots, setSelectedRoots] = useState<string[]>(
    roots.map((r) => r.id),
  );
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [searchedOptions, setSearchedOptions] = useState<SearchOptions | null>(
    null,
  );
  const current = useRef("");
  const queryVersion = useRef(0);
  const hosts = [...new Set(["local", ...roots.map((r) => r.hostId)])];
  useEffect(
    () => () => {
      service.current.cancel();
    },
    [],
  );
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (!folder || folder.startsWith("ssh://")) return;
      const parent = folder.slice(0, folder.lastIndexOf("/")) || "/";
      if (
        !roots.some(
          (root) => root.hostId === host && isWithin(parent, root.path),
        )
      )
        return;
      try {
        const list: any[] = await request("fs.list", {
          hostId: host,
          path: parent,
        });
        setSuggestions(
          list.filter((entry) => entry.isDirectory).map((entry) => entry.path),
        );
      } catch {}
    }, 180);
    return () => clearTimeout(timer);
  }, [folder, host, roots]);
  function resolvedRoots() {
    if (folder) {
      const parsed = folder.startsWith("ssh://")
        ? parseLocation(folder)
        : { hostId: host, path: folder };
      const root = roots
        .filter(
          (r) => r.hostId === parsed.hostId && isWithin(parsed.path, r.path),
        )
        .sort((a, b) => b.path.length - a.path.length)[0];
      if (!root)
        throw Error(
          "This folder is outside the workspace. Add Folder to Workspace before searching it.",
        );
      return [{ ...root, path: parsed.path }];
    }
    return scope === "workspace"
      ? roots
      : roots.filter((r) =>
          scope === "selected" ? selectedRoots.includes(r.id) : r.id === scope,
        );
  }
  const options = (): SearchOptions => ({
    query,
    replacement,
    regex,
    caseSensitive,
    wholeWord,
    fileMask: mask,
    include,
    exclude,
    includeHidden: hidden,
    includeIgnored: ignored,
    folder: folder
      ? folder.startsWith("ssh://")
        ? parseLocation(folder).path
        : folder
      : undefined,
    hostId: folder.startsWith("ssh://") ? parseLocation(folder).hostId : host,
    rootIds:
      !folder && scope !== "workspace"
        ? scope === "selected"
          ? selectedRoots
          : [scope]
        : undefined,
  });
  useEffect(() => {
    queryVersion.current++;
    service.current.cancel();
    setSearchedOptions(null);
    setResults([]);
    setStates([]);
    setSelected(new Set());
    setRunning(false);
  }, [
    query,
    replacement,
    folder,
    host,
    scope,
    regex,
    caseSensitive,
    wholeWord,
    mask,
    include,
    exclude,
    hidden,
    ignored,
    selectedRoots,
  ]);
  async function run() {
    const gen = ++queryVersion.current;
    setError("");
    if (!query) {
      setError("Enter text to search.");
      return;
    }
    try {
      resolvedRoots();
      const snapshot = options();
      if (folder) {
        const recent = JSON.parse(
          sessionStorage.getItem("islet-recent-folders") || "[]",
        );
        sessionStorage.setItem(
          "islet-recent-folders",
          JSON.stringify(
            [
              { host, folder },
              ...recent.filter(
                (item: any) => item.host !== host || item.folder !== folder,
              ),
            ].slice(0, 20),
          ),
        );
      }
      setResults([]);
      setStates([]);
      setRunning(true);
      const data: any = await service.current.run(snapshot, {
        onResults: (matches) => {
          if (gen === queryVersion.current) setResults(matches);
        },
        onRootState: (state) => {
          if (gen === queryVersion.current)
            setStates((states) => [
              ...states.filter((s) => s.id !== state.id),
              state,
            ]);
        },
      });
      if (gen !== queryVersion.current) return;
      setResults(data.results || []);
      setStates(data.roots || []);
      setSelected(new Set((data.results || []).map((_: any, i: number) => i)));
      setSearchedOptions(snapshot);
      if (!data.complete)
        setError("Search is incomplete. Review unavailable roots and limits.");
      else if (data.limits?.truncated || data.limits?.skippedLarge)
        setError(
          `Search limits: ${data.limits.skippedLarge || 0} oversized files skipped; ${data.limits.truncated ? "result limit reached" : "result limit not reached"}.`,
        );
    } catch (e) {
      if (gen === queryVersion.current) setError(String(e));
    } finally {
      if (gen === queryVersion.current) setRunning(false);
    }
  }
  async function browse(pathOverride?: string) {
    setError("");
    try {
      if (host === "local") {
        const chosen: any = await request("dialog.open", {
          directory: true,
          multiple: false,
        });
        const p = Array.isArray(chosen) ? chosen[0] : chosen;
        if (p) {
          setFolder(typeof p === "string" ? p : p.path);
          setScope("folder");
        }
      } else {
        const path =
          pathOverride ||
          folder ||
          roots.find((r) => r.hostId === host)?.path ||
          "/";
        setFolders(
          (await request<any[]>("fs.list", { hostId: host, path })).filter(
            (e) => e.isDirectory,
          ),
        );
        setBrowsing(true);
      }
    } catch (e) {
      setError(String(e));
    }
  }
  async function preview(all = false) {
    try {
      if (!searchedOptions)
        throw Error("Run the search before previewing replacements.");
      const tx = await service.current.replacementPreview(
        searchedOptions,
        results.map((r, i) => ({ ...r, selected: all || selected.has(i) })),
        transactions,
      );
      if (!tx.files.length) throw Error("Select at least one match.");
      onPreview(tx);
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <Modal
      title={replace ? "Replace in Files" : "Find in Files"}
      onClose={onClose}
      wide
    >
      <div className="dialog-body search-dialog">
        <div className="input-row">
          <label>
            Search text
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void run();
              }}
              placeholder="Text or regular expression"
            />
          </label>
          {replace && (
            <label>
              Replace with
              <input
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
                placeholder="Replacement · $1 capture groups"
              />
            </label>
          )}
        </div>
        <div className="input-row folder-row">
          <label className="location-field">
            Location
            <select value={host} onChange={(e) => setHost(e.target.value)}>
              {hosts.map((h) => (
                <option key={h} value={h}>
                  {h === "local" ? "Local" : h}
                </option>
              ))}
            </select>
          </label>
          <label className="folder-field">
            Search in folder
            <input
              list="workspace-folders"
              value={folder}
              onChange={(e) => {
                setFolder(e.target.value);
                setScope(e.target.value ? "folder" : "workspace");
              }}
              placeholder="Blank searches the entire workspace"
            />
          </label>
          <button onClick={() => void browse()}>
            <FolderOpen size={15} />
            Browse…
          </button>
        </div>
        <datalist id="workspace-folders">
          {roots
            .filter((r) => r.hostId === host)
            .map((r) => (
              <option key={r.id} value={r.path} />
            ))}
          {suggestions.map((path) => (
            <option key={path} value={path} />
          ))}
          {JSON.parse(sessionStorage.getItem("islet-recent-folders") || "[]")
            .filter((item: any) => item.host === host)
            .map((item: any) => (
              <option key={item.folder} value={item.folder} />
            ))}
        </datalist>
        {browsing && (
          <div className="folder-picker">
            <button
              onClick={() => {
                const parent = folder.slice(0, folder.lastIndexOf("/")) || "/";
                setFolder(parent);
                void browse(parent);
              }}
            >
              Parent folder
            </button>
            {folders.map((f) => (
              <button
                key={f.path}
                onClick={() => {
                  setFolder(f.path);
                  setScope("folder");
                  setBrowsing(false);
                }}
              >
                <FolderOpen size={14} />
                {f.name}
              </button>
            ))}
          </div>
        )}
        <div className="input-row">
          <label>
            Scope
            <select
              value={folder ? "folder" : scope}
              onChange={(e) => {
                setScope(e.target.value);
                if (e.target.value !== "folder") setFolder("");
              }}
            >
              <option value="workspace">Entire Workspace</option>
              <option value="selected">Selected Roots</option>
              {folder && <option value="folder">Selected Folder</option>}
              {roots.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label} · {r.hostId}
                </option>
              ))}
            </select>
          </label>
          <label>
            File mask
            <input
              value={mask}
              onChange={(e) => setMask(e.target.value)}
              placeholder="*.py, *.{js,jsx}"
            />
          </label>
        </div>
        {scope === "selected" && !folder && (
          <div className="check-row">
            {roots.map((root) => (
              <label key={root.id}>
                <input
                  type="checkbox"
                  checked={selectedRoots.includes(root.id)}
                  onChange={(e) =>
                    setSelectedRoots((ids) =>
                      e.target.checked
                        ? [...ids, root.id]
                        : ids.filter((id) => id !== root.id),
                    )
                  }
                />
                {root.label} · {root.hostId}
              </label>
            ))}
          </div>
        )}
        <div className="check-row">
          <label>
            <input
              type="checkbox"
              checked={caseSensitive}
              onChange={(e) => setCase(e.target.checked)}
            />
            Match case
          </label>
          <label>
            <input
              type="checkbox"
              checked={wholeWord}
              onChange={(e) => setWord(e.target.checked)}
            />
            Whole words
          </label>
          <label>
            <input
              type="checkbox"
              checked={regex}
              onChange={(e) => setRegex(e.target.checked)}
            />
            Regex
          </label>
          <label>
            <input
              type="checkbox"
              checked={hidden}
              onChange={(e) => setHidden(e.target.checked)}
            />
            Hidden files
          </label>
          <label>
            <input
              type="checkbox"
              checked={ignored}
              onChange={(e) => setIgnored(e.target.checked)}
            />
            Ignored files
          </label>
        </div>
        <div className="input-row">
          <label>
            Include folders
            <input
              value={include}
              onChange={(e) => setInclude(e.target.value)}
              placeholder="Optional semicolon-separated paths"
            />
          </label>
          <label>
            Exclude folders
            <input
              value={exclude}
              onChange={(e) => setExclude(e.target.value)}
              placeholder="Optional semicolon-separated paths"
            />
          </label>
        </div>
        <div className="search-actions">
          <span>
            {folder
              ? `${host} · ${folder}`
              : "Scope: " +
                (scope === "workspace"
                  ? "Entire Workspace"
                  : roots.find((r) => r.id === scope)?.label)}
          </span>
          <button className="primary" onClick={run} disabled={running}>
            <Search size={14} />
            {running ? "Searching…" : "Search"}
          </button>
          {running && (
            <button
              onClick={() => {
                queryVersion.current++;
                service.current.cancel();
                setRunning(false);
                setError("Search cancelled. Results may be incomplete.");
              }}
            >
              <Square size={13} />
              Cancel
            </button>
          )}
        </div>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="search-states">
          {states.map((s: any, i: number) => (
            <span key={i}>
              {s.label ||
                roots.find((r) => r.id === (s.rootId || s.id))?.label ||
                s.rootId ||
                s.id}
              : {s.state || s.status}
              {s.error ? " — " + s.error : ""}
            </span>
          ))}
        </div>
        <div className="search-results">
          {results.map((r, i) => (
            <div className="search-result" key={i}>
              {replace && (
                <input
                  type="checkbox"
                  checked={selected.has(i)}
                  onChange={(e) =>
                    setSelected((prev) => {
                      const n = new Set(prev);
                      if (e.target.checked) n.add(i);
                      else n.delete(i);
                      return n;
                    })
                  }
                />
              )}
              <button
                onClick={() => {
                  onOpen(r.hostId, r.path, r.from ?? r.offset);
                  onClose();
                }}
              >
                <span>
                  <b>{r.hostId === "local" ? "Local" : r.hostId}</b> · {r.path}:
                  {r.line ?? 1}
                </span>
                <code>
                  {(() => {
                    const snippet = r.snippet || r.lineText || r.match || "";
                    const at = snippet.indexOf(r.match);
                    return at >= 0 && r.match ? (
                      <>
                        {snippet.slice(0, at)}
                        <mark>{r.match}</mark>
                        {snippet.slice(at + r.match.length)}
                      </>
                    ) : (
                      snippet
                    );
                  })()}
                </code>
              </button>
            </div>
          ))}
        </div>
        <footer>
          <span>
            {results.length} matches{running ? " · in progress" : ""}
          </span>
          {replace && (
            <>
              <button
                onClick={() => setSelected(new Set(results.map((_, i) => i)))}
              >
                Select All
              </button>
              <button
                className="primary"
                disabled={!selected.size || running || !searchedOptions}
                onClick={() => void preview()}
              >
                Preview {selected.size} replacements
              </button>
              <button
                disabled={!results.length || running || !searchedOptions}
                onClick={() => void preview(true)}
              >
                Replace All in Scope…
              </button>
            </>
          )}
        </footer>
      </div>
    </Modal>
  );
}
