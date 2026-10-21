import { useEffect, useState } from "react";
import { ChevronRight, ChevronDown, RefreshCw } from "lucide-react";
import { FileIcon } from "../icons/FileIcon";
import { request } from "../core/bridge";
import { Root, Entry, base } from "../workspaces/model";
function Node({
  root,
  path,
  name,
  depth,
  onOpen,
  onMenu,
  selected,
  folder = true,
}: {
  root: Root;
  path: string;
  name: string;
  depth: number;
  onOpen: (host: string, path: string, preview?: boolean) => void;
  onMenu: (
    e: React.MouseEvent,
    root: Root,
    path: string,
    folder: boolean,
  ) => void;
  selected?: string;
  folder?: boolean;
}) {
  const [expanded, setExpanded] = useState(depth === 0),
    [entries, setEntries] = useState<Entry[]>([]),
    [error, setError] = useState("");
  async function load() {
    try {
      setEntries(await request("fs.list", { hostId: root.hostId, path }));
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    if (expanded && folder) void load();
  }, [expanded, path, root]);
  return (
    <>
      <div
        className={`tree-row ${selected === root.hostId + ":" + path ? "selected" : ""}`}
        style={{ paddingLeft: 10 + depth * 15 }}
        onContextMenu={(e) => {
          e.preventDefault();
          onMenu(e, root, path, folder);
        }}
        onClick={() =>
          folder ? setExpanded(!expanded) : onOpen(root.hostId, path, true)
        }
        onDoubleClick={() => !folder && onOpen(root.hostId, path, false)}
        title={`${root.hostId} · ${path}`}
      >
        <span className="tree-chevron">
          {folder ? (
            expanded ? (
              <ChevronDown size={13} />
            ) : (
              <ChevronRight size={13} />
            )
          ) : null}
        </span>
        <FileIcon path={path} folder={folder} />
        <span className="tree-name">{name}</span>
        {depth === 0 && root.hostId !== "local" && (
          <small className="host-badge">SSH</small>
        )}
      </div>
      {expanded && folder && (
        <>
          {error ? (
            <div className="tree-error">
              {error}
              <button onClick={load} aria-label="Retry folder">
                <RefreshCw size={12} />
              </button>
            </div>
          ) : (
            entries
              .filter(
                (e) =>
                  ![
                    "node_modules",
                    ".git",
                    ".venv",
                    "venv",
                    "__pycache__",
                    "target",
                  ].includes(e.name),
              )
              .sort(
                (a, b) =>
                  Number(b.isDirectory) - Number(a.isDirectory) ||
                  a.name.localeCompare(b.name),
              )
              .map((e) => (
                <Node
                  key={e.path}
                  root={root}
                  path={e.path}
                  name={e.name}
                  depth={depth + 1}
                  folder={e.isDirectory}
                  onOpen={onOpen}
                  onMenu={onMenu}
                  selected={selected}
                />
              ))
          )}
        </>
      )}
    </>
  );
}
export function ProjectTree({
  roots,
  onOpen,
  onMenu,
  selected,
}: {
  roots: Root[];
  onOpen: (host: string, path: string, preview?: boolean) => void;
  onMenu: (
    e: React.MouseEvent,
    root: Root,
    path: string,
    folder: boolean,
  ) => void;
  selected?: string;
}) {
  return (
    <div className="tree" role="tree" aria-label="Workspace projects">
      <div className="tree-content">
        {roots.map((root) => (
          <div key={root.id}>
            <Node
              root={root}
              path={root.path}
              name={root.label || base(root.path)}
              depth={0}
              onOpen={onOpen}
              onMenu={onMenu}
              selected={selected}
            />
            {root.state && root.state !== "ready" && (
              <div className="connection-state">{root.state}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
