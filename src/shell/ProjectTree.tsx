import { useEffect, useRef, useState } from "react";
import { ChevronRight, ChevronDown, RefreshCw } from "lucide-react";
import {
  FILE_ITEM_MIME,
  droppedItem,
  type FileItem,
} from "../files/operations";
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
  folderOpenMode,
  onSelect,
  onDropItems,
  onCopy,
  onPaste,
  dropTarget,
  onReconnect,
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
  onDropItems?: (sources: FileItem[], target: FileItem) => void;
  onCopy?: (item: FileItem) => void;
  onPaste?: (target: FileItem) => void;
  dropTarget?: FileItem;
  onReconnect?: (hostId: string) => Promise<void>;
  folderOpenMode: "single" | "double";
  onSelect: (root: Root, path: string, folder: boolean) => void;
}) {
  const [hover, setHover] = useState(false);
  const loadVersion = useRef(0);
  const expansionKey = "islet.folder.expanded:" + root.hostId + ":" + path;
  const [expanded, setExpandedState] = useState(
      () => localStorage.getItem(expansionKey) === "true",
    ),
    [entries, setEntries] = useState<Entry[]>([]),
    [error, setError] = useState("");
  const setExpanded = (update: boolean | ((value: boolean) => boolean)) => {
    setExpandedState((value) => {
      const next = typeof update === "function" ? update(value) : update;
      localStorage.setItem(expansionKey, String(next));
      return next;
    });
  };
  async function load() {
    const version = ++loadVersion.current;
    try {
      const next = await request<Entry[]>("fs.list", {
        hostId: root.hostId,
        path,
      });
      if (version !== loadVersion.current) return;
      setEntries(next);
      setError("");
    } catch (e) {
      if (version === loadVersion.current)
        setError(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => {
    if (
      expanded &&
      folder &&
      (root.hostId === "local" || !root.state || root.state === "ready")
    )
      void load();
    return () => {
      loadVersion.current++;
    };
  }, [expanded, path, root]);
  const connecting = root.state === "connecting";
  const disconnected =
    root.hostId !== "local" &&
    !!root.state &&
    !["ready", "connecting"].includes(root.state);
  const problem = disconnected
    ? root.connectionError ||
      (root.hostId === "local" ? "Folder unavailable." : "Connection lost.")
    : error;
  async function retry() {
    try {
      if (root.hostId !== "local" && onReconnect)
        await onReconnect(root.hostId);
      else await load();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }
  return (
    <>
      <div
        className={`tree-row ${folder && (hover || (dropTarget?.hostId === root.hostId && dropTarget.path === path)) ? "drop-target" : ""} ${selected === root.hostId + ":" + path ? "selected" : ""}`}
        draggable
        data-drop-host={folder ? root.hostId : undefined}
        data-drop-path={folder ? path : undefined}
        onDragStart={(event) => {
          event.dataTransfer.setData(
            FILE_ITEM_MIME,
            JSON.stringify({ hostId: root.hostId, path }),
          );
          event.dataTransfer.effectAllowed = "copy";
        }}
        onDragOver={(event) => {
          if (folder && event.dataTransfer.types.includes(FILE_ITEM_MIME)) {
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "copy";
            setHover(true);
          }
        }}
        onDragLeave={() => setHover(false)}
        onDrop={(event) => {
          const item = droppedItem(event.dataTransfer);
          setHover(false);
          if (folder && item) {
            event.preventDefault();
            event.stopPropagation();
            onDropItems?.([item], { hostId: root.hostId, path });
          }
        }}
        role="treeitem"
        data-root={depth === 0 ? "true" : undefined}
        tabIndex={0}
        aria-label={name}
        aria-expanded={folder ? expanded : undefined}
        aria-selected={selected === root.hostId + ":" + path}
        style={{ paddingLeft: 10 + depth * 15 }}
        onContextMenu={(e) => {
          e.preventDefault();
          onMenu(e, root, path, folder);
        }}
        onClick={(e) => {
          onSelect(root, path, folder);
          if (folder) {
            if (folderOpenMode === "single" && e.detail === 1)
              setExpanded((value) => !value);
          } else onOpen(root.hostId, path, true);
        }}
        onDoubleClick={() => {
          if (folder) {
            if (folderOpenMode === "double") setExpanded((value) => !value);
          } else onOpen(root.hostId, path, false);
        }}
        onKeyDown={(e) => {
          if (
            (e.metaKey || e.ctrlKey) &&
            root.hostId === "local" &&
            ["c", "v"].includes(e.key.toLowerCase())
          ) {
            e.preventDefault();
            e.stopPropagation();
            if (e.key.toLowerCase() === "c")
              onCopy?.({ hostId: root.hostId, path });
            else
              onPaste?.({
                hostId: root.hostId,
                path: folder
                  ? path
                  : path.slice(0, path.lastIndexOf("/")) || "/",
              });
            return;
          }
          if (
            folder &&
            ["Enter", " ", "ArrowRight", "ArrowLeft"].includes(e.key)
          ) {
            e.preventDefault();
            e.stopPropagation();
            onSelect(root, path, folder);
            setExpanded((value) =>
              e.key === "ArrowRight"
                ? true
                : e.key === "ArrowLeft"
                  ? false
                  : !value,
            );
          } else if (!folder && e.key === "Enter") {
            e.preventDefault();
            onOpen(root.hostId, path, false);
          }
        }}
        title={`${root.hostId} · ${path}`}
      >
        <span
          className="tree-chevron"
          onClick={(e) => {
            if (folder) {
              e.stopPropagation();
              onSelect(root, path, folder);
              setExpanded((value) => !value);
            }
          }}
          aria-hidden="true"
        >
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
          {connecting ? (
            depth === 0 && (
              <div className="connection-state" role="status">
                Connecting…
              </div>
            )
          ) : problem ? (
            <div className="tree-error" role="status">
              <span>{problem}</span>
              <button
                onClick={() => void retry()}
                aria-label={
                  root.hostId === "local" ? "Retry folder" : "Reconnect SSH"
                }
              >
                <RefreshCw size={12} />{" "}
                {root.hostId === "local" ? "Retry" : "Reconnect"}
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
                  folderOpenMode={folderOpenMode}
                  onSelect={onSelect}
                  onDropItems={onDropItems}
                  onCopy={onCopy}
                  onPaste={onPaste}
                  dropTarget={dropTarget}
                  onReconnect={onReconnect}
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
  folderOpenMode = "double",
  onSelect = () => {},
  onDropItems,
  onCopy,
  onPaste,
  dropTarget,
  onReconnect,
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
  folderOpenMode?: "single" | "double";
  onDropItems?: (sources: FileItem[], target: FileItem) => void;
  onCopy?: (item: FileItem) => void;
  onPaste?: (target: FileItem) => void;
  dropTarget?: FileItem;
  onReconnect?: (hostId: string) => Promise<void>;
  onSelect?: (root: Root, path: string, folder: boolean) => void;
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
              folderOpenMode={folderOpenMode}
              onSelect={onSelect}
              onDropItems={onDropItems}
              onCopy={onCopy}
              onPaste={onPaste}
              dropTarget={dropTarget}
              onReconnect={onReconnect}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
