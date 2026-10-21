import { useEffect, useState } from "react";
import { X, RefreshCw, CornerUpLeft } from "lucide-react";
import type { DocumentModel, Root } from "../core/types";
import {
  languageFor,
  type LanguageManager,
  type LanguageLocation,
} from "../languages/client";
import type { CallerNode, CallerTree } from "../languages/callers";
import "./callerPanel.css";

export function CallerPanel({
  document: doc,
  offset,
  languages,
  roots,
  onNavigate,
  onClose,
}: {
  document: DocumentModel;
  offset: number;
  languages: LanguageManager;
  roots: Root[];
  onNavigate: (location: LanguageLocation) => void;
  onClose: () => void;
}) {
  const [tree, setTree] = useState<CallerTree>();
  const [message, setMessage] = useState(
    "Select a function to see its callers.",
  );
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const projectKey = roots
    .map(
      (root) =>
        `${root.hostId}:${root.path}:${root.interpreter || ""}:${root.state || ""}`,
    )
    .join("|");
  useEffect(() => {
    const controller = new AbortController();
    setTree(undefined);
    if (!languageFor(doc.path)) {
      setLoading(false);
      setMessage(
        "Caller analysis is available for Python and JavaScript/TypeScript.",
      );
      return;
    }
    if (doc.text.length > 5 * 1024 * 1024) {
      setLoading(false);
      setMessage("Caller analysis is paused for files over 5 MB.");
      return;
    }
    setLoading(true);
    setMessage("Finding callers…");
    const timer = setTimeout(() => {
      void languages
        .callers(doc, offset, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return;
          setTree(result);
          setLoading(false);
          setMessage(
            result
              ? result.target.children.length
                ? ""
                : "No callers found in this language project."
              : "Place the cursor on a function or inside its body.",
          );
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          setTree(undefined);
          setLoading(false);
          setMessage(error.message || "Caller analysis is unavailable.");
        });
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [doc.id, doc.version, offset, projectKey, refresh, languages]);
  function rows(nodes: CallerNode[], depth = 1) {
    return nodes.map((node) => (
      <div key={node.key} className="caller-branch">
        <button
          className="caller-row"
          style={{ paddingLeft: 12 + depth * 14 }}
          title={`${node.detail || node.name}\n${node.location.hostId}:${node.location.path}\nCalls at lines ${node.callLines.join(", ")}`}
          onClick={() => onNavigate(node.location)}
        >
          <CornerUpLeft size={12} />
          <span className="caller-name">{node.name}</span>
          <span className="caller-file">
            {node.location.path.split("/").pop()}:
            {node.location.range.start.line + 1}
          </span>
          {node.recursive && <span className="muted">recursive</span>}
        </button>
        {rows(node.children, depth + 1)}
        {node.truncated && (
          <span className="caller-limit">
            More callers omitted; select this function to explore them.
          </span>
        )}
      </div>
    ));
  }
  return (
    <section
      className="caller-panel"
      aria-label="Function callers"
      aria-busy={loading}
    >
      <header>
        <strong>Callers</strong>
        <span className="muted">5 levels</span>
        {tree && (
          <span className="caller-target">
            {tree.target.name} · {tree.target.location.path.split("/").pop()}:
            {tree.target.location.range.start.line + 1}
          </span>
        )}
        <div className="caller-actions">
          <button
            className="icon"
            title="Refresh callers"
            aria-label="Refresh callers"
            onClick={() => setRefresh((value) => value + 1)}
          >
            <RefreshCw size={13} />
          </button>
          <button
            className="icon"
            title="Hide callers"
            aria-label="Hide callers"
            onClick={onClose}
          >
            <X size={13} />
          </button>
        </div>
      </header>
      <div className="caller-list">
        {message && <p role="status">{message}</p>}
        {tree && rows(tree.target.children)}
        {tree?.truncated && (
          <p className="muted">
            Showing up to 60 functions. Select a caller to explore its branch.
          </p>
        )}
      </div>
    </section>
  );
}
