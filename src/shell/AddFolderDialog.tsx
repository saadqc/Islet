import { useEffect, useState } from "react";
import { Folder, ChevronUp } from "lucide-react";
import { request } from "../core/bridge";
import { Modal } from "./Modal";
export function AddFolderDialog({
  remote = false,
  onClose,
  onAdd,
  onError,
}: {
  remote?: boolean;
  onClose: () => void;
  onAdd: (path: string, host?: string) => Promise<any>;
  onError: (e: unknown) => void;
}) {
  const [location, setLocation] = useState(remote ? "ssh" : "local"),
    [target, setTarget] = useState(""),
    [folder, setFolder] = useState(""),
    [helper, setHelper] = useState(""),
    [approved, setApproved] = useState(false),
    [aliases, setAliases] = useState<any[]>([]),
    [entries, setEntries] = useState<any[] | null>(null),
    [probe, setProbe] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    void request<any[]>("remote.aliases", {})
      .then(setAliases)
      .catch(() => {});
  }, []);
  const hostId = "ssh:" + target.replace(/^ssh:/, "");
  async function connect() {
    if (!target.trim()) throw Error("Enter an SSH alias or host.");
    if (helper) {
      await request("remote.connect", {
        hostId,
        target,
        helperPath: helper,
        interactive: true,
      });
      return;
    }
    const info: any = await request("remote.probe", {
      hostId,
      target,
      interactive: true,
    });
    setProbe(info);
    if (!info.helperInstalled) {
      if (!approved)
        throw Error(
          `Setup is needed on ${target} at ${info.cachePath}. Review the helper contents and approve setup below.`,
        );
      await request("remote.setup", {
        hostId,
        target,
        approve: true,
        interactive: true,
      });
    } else
      await request("remote.connect", { hostId, target, interactive: true });
  }
  async function browse(path = folder || "/") {
    setBusy(true);
    setError("");
    try {
      if (location === "local") {
        const paths = await request<string[] | string | null>("dialog.open", {
          directory: true,
          multiple: true,
        });
        for (const chosen of Array.isArray(paths)
          ? paths
          : paths
            ? [paths]
            : [])
          await onAdd(chosen);
        if (paths) onClose();
      } else {
        await connect();
        const items = await request<any[]>("fs.list", {
          hostId,
          path,
          browse: true,
        });
        setFolder(path);
        setEntries(items.filter((e) => e.isDirectory));
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function add() {
    setBusy(true);
    setError("");
    try {
      if (!folder.startsWith("/"))
        throw Error("Enter an absolute folder path.");
      if (location === "ssh") await connect();
      await onAdd(folder, location === "ssh" ? hostId : "local");
      onClose();
    } catch (e) {
      setError(String(e));
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Add Project / Folder" onClose={onClose}>
      <div className="dialog-body">
        <label>
          Location
          <select
            value={location}
            onChange={(e) => {
              setLocation(e.target.value);
              setEntries(null);
            }}
          >
            <option value="local">Local Folder</option>
            <option value="ssh">SSH Folder</option>
          </select>
        </label>
        {location === "ssh" && (
          <>
            <label>
              SSH alias or user@host:port
              <input
                list="ssh-aliases"
                value={target}
                placeholder="staging"
                onChange={(e) => {
                  setTarget(e.target.value);
                  setProbe(null);
                  setEntries(null);
                  setApproved(false);
                }}
              />
            </label>
            <datalist id="ssh-aliases">
              {aliases.map((a) => (
                <option key={a.hostId} value={a.target} />
              ))}
            </datalist>
            <label>
              Existing compatible helper folder (optional)
              <input
                value={helper}
                onChange={(e) => setHelper(e.target.value)}
                placeholder="Leave blank for automatic setup"
              />
            </label>
            <p>
              Connect using OpenSSH, your SSH configuration and key agent. A new
              helper installs only in{" "}
              <b>
                {target || "the selected host"}:~/.cache/islet/
                {probe?.version || "<version>"}
              </b>
              . It includes the versioned file helper, Node runtime,
              basedpyright and TypeScript language service. No root access or
              permanent daemon is needed.
            </p>
            {probe && (
              <p>
                {probe.os} · {probe.arch} · {probe.cachePath} ·{" "}
                {probe.helperInstalled ? "Helper ready" : "Setup needed"}
              </p>
            )}
            {!helper && (
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={approved}
                  onChange={(e) => setApproved(e.target.checked)}
                />
                Allow this host’s versioned helper setup
              </label>
            )}
          </>
        )}
        <label>
          Absolute folder path
          <input
            value={folder}
            placeholder={
              location === "ssh" ? "/srv/project" : "/path/to/project"
            }
            onChange={(e) => setFolder(e.target.value)}
          />
        </label>
        <button onClick={() => void browse()} disabled={busy}>
          <Folder size={15} />
          {busy
            ? "Connecting…"
            : location === "ssh"
              ? "Browse Remote Folders…"
              : "Browse Local Folders…"}
        </button>
        {entries && (
          <div className="folder-picker">
            <button
              onClick={() =>
                void browse(folder.replace(/\/[^/]+\/?$/, "") || "/")
              }
            >
              <ChevronUp size={14} />
              Parent Folder
            </button>
            {entries.map((entry) => (
              <button key={entry.path} onClick={() => void browse(entry.path)}>
                <Folder size={14} />
                {entry.name}
              </button>
            ))}
          </div>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            disabled={busy}
            onClick={() => void add()}
          >
            Add Folder
          </button>
        </footer>
      </div>
    </Modal>
  );
}
