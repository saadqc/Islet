import { useEffect, useRef, useState } from "react";
import type { SuperDoc } from "superdoc";

type Editor = NonNullable<SuperDoc["activeEditor"]>;
type Match = { from: number; to: number; text: string; id: string };
type Session = { matches: Match[]; activeMatchIndex: number };
// These native session commands ship in pinned SuperDoc 1.46.2, but its
// command declarations only expose the older search/goToSearchResult pair.
type SearchCommands = {
  setSearchSession: (query: string, options: object) => Session;
  clearSearchSession: () => void;
  goToSearchResult: (match: Match) => void;
  nextSearchMatch: () => void;
  previousSearchMatch: () => void;
  replaceSearchMatch: (text: string) => void;
  replaceAllSearchMatches: (text: string) => { skippedCount: number };
};

export default function DocumentSearch({
  editor,
  request,
  readonly,
  onClose,
}: {
  editor: Editor;
  request: { replace: boolean; sequence: number };
  readonly: boolean;
  onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [result, setResult] = useState({ count: 0, index: -1 });
  const [message, setMessage] = useState("");
  // Commands capture a transaction when read; always request a fresh set.
  const commands = () => editor.commands as unknown as SearchCommands;
  function sync() {
    // The extension has a generated storage key. Resolve its shape the same
    // way SuperDoc's own find/replace surface does.
    const state = Object.values(editor.extensionStorage).find(
      (value) =>
        value &&
        typeof value === "object" &&
        "searchIndex" in value &&
        "searchResults" in value,
    ) as (Session & { searchResults: Match[] }) | undefined;
    if (state)
      setResult({
        count: state.searchResults.length,
        index: state.activeMatchIndex,
      });
  }
  function act(action: () => void) {
    const focused = window.document.activeElement;
    action();
    sync();
    if (focused instanceof HTMLElement && panel.current?.contains(focused))
      focused.focus({ preventScroll: true });
  }
  function close() {
    onClose();
    editor.focus();
  }
  useEffect(() => {
    input.current?.focus({ preventScroll: true });
    input.current?.select();
  }, [request.sequence]);
  useEffect(() => {
    const focused = window.document.activeElement;
    const session = commands().setSearchSession(query, {
      caseSensitive: matchCase,
      searchModel: "visible",
    });
    if (session.matches[0]) commands().goToSearchResult(session.matches[0]);
    setResult({
      count: session.matches.length,
      index: session.activeMatchIndex,
    });
    setMessage("");
    if (focused instanceof HTMLElement && panel.current?.contains(focused))
      focused.focus({ preventScroll: true });
  }, [editor, query, matchCase]);
  useEffect(() => {
    let mounted = true;
    const update = () =>
      queueMicrotask(() => {
        if (mounted) sync();
      });
    editor.on("transaction", update);
    return () => {
      mounted = false;
      editor.off("transaction", update);
      commands().clearSearchSession();
    };
  }, [editor]);
  return (
    <div
      className="docx-search"
      role="search"
      aria-label="Find in document"
      ref={panel}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <div className="docx-search-row">
        <input
          ref={input}
          aria-label="Find in document"
          placeholder="Find in document"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            act(() =>
              event.shiftKey
                ? commands().previousSearchMatch()
                : commands().nextSearchMatch(),
            );
          }}
        />
        <output aria-live="polite" aria-label="Document search results">
          {query
            ? result.count
              ? `${result.index + 1} of ${result.count}`
              : "No results"
            : ""}
        </output>
        <button
          type="button"
          aria-label="Previous document match"
          disabled={!result.count}
          onClick={() => act(() => commands().previousSearchMatch())}
        >
          ↑
        </button>
        <button
          type="button"
          aria-label="Next document match"
          disabled={!result.count}
          onClick={() => act(() => commands().nextSearchMatch())}
        >
          ↓
        </button>
        <label>
          <input
            type="checkbox"
            checked={matchCase}
            onChange={(event) => setMatchCase(event.target.checked)}
          />{" "}
          Match case
        </label>
        <button
          type="button"
          aria-label="Close document search"
          onClick={close}
        >
          ×
        </button>
      </div>
      {request.replace && !readonly && (
        <div className="docx-search-row">
          <input
            aria-label="Replace with"
            placeholder="Replace with"
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              act(() => commands().replaceSearchMatch(replacement));
            }}
          />
          <button
            type="button"
            disabled={!result.count}
            onClick={() =>
              act(() => commands().replaceSearchMatch(replacement))
            }
          >
            Replace
          </button>
          <button
            type="button"
            disabled={!result.count}
            onClick={() =>
              act(() => {
                const { skippedCount } =
                  commands().replaceAllSearchMatches(replacement);
                // Replace all clears the native session. Keep our visible
                // query live so subsequent edits and Undo refresh its matches.
                commands().setSearchSession(query, {
                  caseSensitive: matchCase,
                  searchModel: "visible",
                });
                setMessage(
                  skippedCount ? `${skippedCount} locked matches skipped` : "",
                );
              })
            }
          >
            Replace all
          </button>
          <span role="status">{message}</span>
        </div>
      )}
    </div>
  );
}
