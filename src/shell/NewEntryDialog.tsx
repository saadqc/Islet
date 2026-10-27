import { useState } from "react";
import { request } from "../core/bridge";
import type { Root } from "../workspaces/model";
import { isDocx, blankDocx } from "../docx/formats";
import { isBinaryWorkbook } from "../spreadsheets/formats";
import { Modal } from "./Modal";

export function entryPath(folder: string, name: string) {
  if (
    !name ||
    name.trim() !== name ||
    name === "." ||
    name === ".." ||
    /[\\/\x00-\x1f\x7f]/.test(name)
  )
    throw new Error(
      "Enter a file or folder name without slashes, surrounding spaces, or control characters.",
    );
  return folder.replace(/\/$/, "") + "/" + name;
}
export function NewEntryDialog({
  roots,
  initial,
  directory,
  initialName = "",
  content,
  onCreated,
  onClose,
}: {
  roots: Root[];
  initial: { hostId: string; path: string };
  directory: boolean;
  initialName?: string;
  content?: { text: string; binary: boolean };
  onCreated: (hostId: string, path: string, directory: boolean) => void;
  onClose: () => void;
}) {
  const [hostId, setHostId] = useState(initial.hostId),
    [folder, setFolder] = useState(initial.path);
  const [name, setName] = useState(initialName),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function create() {
    if (busy) return;
    setError("");
    try {
      const path = entryPath(folder, name);
      if (
        !roots.some(
          (root) =>
            root.hostId === hostId &&
            (folder === root.path ||
              folder.startsWith(root.path.replace(/\/$/, "") + "/")),
        )
      )
        throw new Error("Choose a folder inside an attached project.");
      setBusy(true);
      if (content && !/\.xlsx$/i.test(path))
        throw new Error("Use the .xlsx extension for this copy.");
      const fileContent =
        content ||
        (directory
          ? {}
          : isDocx(path)
            ? await blankDocx()
            : !isBinaryWorkbook(path)
              ? { text: "" }
              : await import("../spreadsheets/workbook").then((m) =>
                  m.blankSpreadsheet(path),
                ));
      const created = await request<{ path: string }>("fs.create", {
        hostId,
        path,
        directory,
        ...fileContent,
      });
      onCreated(hostId, created.path, directory);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={content ? "Save XLSX Copy" : directory ? "New Folder" : "New File"}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="dialog-body"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <label>
          {directory ? "Folder name" : "File name"}
          <input
            aria-label={directory ? "Folder name" : "File name"}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
          />
        </label>
        <label>
          Project
          <select
            value={
              roots.find(
                (r) =>
                  r.hostId === hostId &&
                  (folder === r.path ||
                    folder.startsWith(r.path.replace(/\/$/, "") + "/")),
              )?.id || ""
            }
            disabled={busy}
            onChange={(e) => {
              const root = roots.find((r) => r.id === e.target.value);
              if (root) {
                setHostId(root.hostId);
                setFolder(root.path);
              }
            }}
          >
            {roots.map((root) => (
              <option value={root.id} key={root.id}>
                {root.label} · {root.hostId}
              </option>
            ))}
          </select>
        </label>
        <label>
          Parent folder
          <input
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            disabled={busy}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <footer>
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="primary" disabled={busy || !name}>
            {busy ? "Creating…" : "Create"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
