import "./styles.css";
import { useCallback, useEffect, useState } from "react";
import { request } from "../../core/bridge";
import { Modal } from "../../shell/Modal";
import {
  CodespacesClient,
  type Codespace,
  type CodespacesStatus,
  type Discovery,
  type ForwardMapping,
  type SafetySnapshot,
} from "./client";

export function CodespacesPanel({
  client,
  onClose,
  onAdd,
  onConnected,
}: {
  client: CodespacesClient;
  onClose: () => void;
  onAdd: (path: string, hostId: string) => Promise<unknown>;
  onConnected: (hostId: string) => Promise<void>;
}) {
  const [items, setItems] = useState<Codespace[]>([]),
    [selectedId, setSelectedId] = useState(""),
    [status, setStatus] = useState<CodespacesStatus>(),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [create, setCreate] = useState(false),
    [repo, setRepo] = useState(""),
    [branch, setBranch] = useState(""),
    [machine, setMachine] = useState(""),
    [displayName, setDisplayName] = useState(""),
    [createApproved, setCreateApproved] = useState(false),
    [action, setAction] = useState<"stop" | "delete" | null>(null),
    [confirmId, setConfirmId] = useState(""),
    [safety, setSafety] = useState<SafetySnapshot>(),
    [discovery, setDiscovery] = useState<Discovery>(),
    [folder, setFolder] = useState(""),
    [folders, setFolders] = useState<{ name: string; path: string }[]>([]),
    [helperPath, setHelperPath] = useState(""),
    [approved, setApproved] = useState(false),
    [connected, setConnected] = useState(false),
    [forwards, setForwards] = useState<ForwardMapping[]>([]),
    [saved, setSaved] = useState<ForwardMapping[]>([]),
    [mode, setMode] = useState<"simple" | "ssh">("simple"),
    [localPort, setLocalPort] = useState(""),
    [remotePort, setRemotePort] = useState(""),
    [remoteHost, setRemoteHost] = useState("localhost"),
    [expiry, setExpiry] = useState("60"),
    [saveMapping, setSaveMapping] = useState(false);
  const selected = items.find((item) => item.id === selectedId);
  const refresh = useCallback(async () => {
    if (!client.settings.enabled) return;
    const current = await client.status();
    setStatus(current);
    if (!current.available || current.authenticated !== true) {
      setItems([]);
      return;
    }
    const [list, ports] = await Promise.all([client.list(), client.forwards()]);
    if (!client.settings.enabled) return;
    setItems(list.items);
    setForwards(ports.items);
    setSaved(ports.savedForwards);
    setSelectedId((id) =>
      list.items.some((item) => item.id === id) ? id : list.items[0]?.id || "",
    );
    if (!list.complete)
      throw Error(
        "The Codespaces list is incomplete. Refresh before choosing an action.",
      );
  }, [client]);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        await refresh();
      } catch (error) {
        if (!disposed) setError(String(error));
      }
      if (!disposed && client.settings.enabled)
        timer = setTimeout(() => void poll(), 15000);
    };
    void poll();
    const unsubscribe = client.subscribe(() => {
      if (!client.settings.enabled) {
        disposed = true;
        clearTimeout(timer);
        onClose();
      }
    });
    return () => {
      disposed = true;
      clearTimeout(timer);
      unsubscribe();
    };
  }, [client, refresh]);
  useEffect(() => {
    setDiscovery(undefined);
    setFolder("");
    setFolders([]);
    setHelperPath("");
    setApproved(false);
    setConnected(selected?.editorState === "connected");
    setSafety(undefined);
    setConfirmId("");
    setAction(null);
  }, [selectedId]);
  useEffect(() => {
    if (selected?.editorState === "disconnected") setConnected(false);
  }, [selected?.editorState]);
  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (error) {
      setError(String(error).replace(/^Error: /, ""));
    } finally {
      setBusy(false);
    }
  }
  async function connect() {
    if (!selected) return;
    if (!connected && selected.editorState !== "connected") {
      const result = await client.connect(selected.id, {
        approve: approved,
        ...(helperPath ? { helperPath } : {}),
      });
      if (result.state === "setup-needed") {
        setDiscovery((value) => ({
          hostId: selected.hostId,
          folders: value?.folders || [],
          defaultFolder: value?.defaultFolder || null,
          probe: result.probe,
        }));
        throw Error(
          "Review the remote helper details and allow versioned helper setup, or select an existing helper path, before connecting.",
        );
      }
      if (result.state !== "ready")
        throw Error(
          "The editor connection is not ready. Refresh and reconnect.",
        );
      setConnected(true);
      await onConnected(selected.hostId);
      await refresh();
    }
  }
  async function browse(path = folder) {
    if (!selected) return;
    if (!path.startsWith("/"))
      throw Error("Choose an absolute folder on the Codespace.");
    await connect();
    const entries = await request<
      { path: string; name: string; isDirectory: boolean }[]
    >("fs.list", {
      hostId: selected.hostId,
      path,
      browse: true,
    });
    setFolder(path);
    setFolders(entries.filter((entry) => entry.isDirectory));
  }
  async function inspect() {
    if (!selected) return;
    const value = await client.discover(selected.id);
    setDiscovery(value);
    setFolder(value.defaultFolder || value.folders[0]?.path || "");
    setFolders(value.folders);
  }
  async function previewLifecycle(kind: "stop" | "delete") {
    if (!selected) return;
    setAction(kind);
    setConfirmId("");
    setSafety(undefined);
    setSafety(await client.safety(selected.id));
  }
  async function applyLifecycle() {
    if (!selected || !action || !safety) return;
    await client.lifecycle(action, selected.id, confirmId, safety.token);
    setAction(null);
    setSafety(undefined);
    setNotice(
      action === "delete" ? "Codespace deleted." : "Codespace stopped.",
    );
    await refresh();
  }
  const available = selected?.state.toLowerCase() === "available";
  return (
    <Modal title="GitHub Codespaces" onClose={onClose} wide>
      <div className="dialog-body codespaces-panel">
        <div className="codespaces-toolbar">
          <span className="muted">
            {status?.available
              ? status.authenticated
                ? "GitHub CLI connected"
                : "Sign in required"
              : "GitHub CLI setup"}
          </span>
          <button disabled={busy} onClick={() => void run(refresh)}>
            Refresh
          </button>
          <button
            disabled={busy || status?.authenticated !== true}
            onClick={() => {
              setCreate((value) => !value);
              setAction(null);
            }}
          >
            Create Codespace…
          </button>
        </div>
        {status?.loginGuidance && (
          <p className="codespaces-guidance">{status.loginGuidance}</p>
        )}
        <p className="muted">
          Authentication stays with GitHub CLI. Islet does not store a GitHub
          token. Only this open manager polls the list.
        </p>
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {create && (
          <section className="codespaces-section" aria-label="Create Codespace">
            <h3>Create Codespace</h3>
            <label>
              Repository
              <input
                placeholder="owner/repository"
                value={repo}
                onChange={(event) => setRepo(event.target.value)}
              />
            </label>
            <div className="input-row">
              <label>
                Branch (optional)
                <input
                  value={branch}
                  onChange={(event) => setBranch(event.target.value)}
                />
              </label>
              <label>
                Machine (optional)
                <input
                  value={machine}
                  placeholder="Repository default"
                  onChange={(event) => setMachine(event.target.value)}
                />
              </label>
            </div>
            <label>
              Display name (optional)
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={createApproved}
                onChange={(event) => setCreateApproved(event.target.checked)}
              />
              Create a new Codespace using my GitHub account’s billing
            </label>
            <div className="input-row">
              <button onClick={() => setCreate(false)}>Cancel</button>
              <button
                className="primary"
                disabled={busy || !repo.trim() || !createApproved}
                onClick={() =>
                  void run(async () => {
                    await client.create({
                      repo: repo.trim(),
                      ...(branch ? { branch } : {}),
                      ...(machine ? { machine } : {}),
                      ...(displayName ? { displayName } : {}),
                    });
                    setCreate(false);
                    setCreateApproved(false);
                    await refresh();
                  })
                }
              >
                Create Codespace
              </button>
            </div>
          </section>
        )}
        {items.length > 0 ? (
          <div className="codespaces-list" role="list" aria-label="Codespaces">
            {items.map((item) => (
              <button
                key={item.id}
                disabled={busy}
                role="listitem"
                aria-pressed={item.id === selectedId}
                className={item.id === selectedId ? "selected" : ""}
                onClick={() => setSelectedId(item.id)}
              >
                <strong>{item.displayName || item.id}</strong>
                <span>{item.repository}</span>
                <small>{item.id}</small>
                <span>
                  GitHub: {item.state} · Editor: {item.editorState}
                </span>
              </button>
            ))}
          </div>
        ) : (
          status?.authenticated === true && (
            <p>No Codespaces found. Refresh or create one.</p>
          )
        )}
        {selected && (
          <>
            <section
              className="codespaces-section"
              aria-label="Selected Codespace"
            >
              <h3>{selected.displayName || selected.id}</h3>
              <p className="muted">{selected.id}</p>
              <div className="codespaces-actions">
                <button
                  disabled={busy || available}
                  onClick={() =>
                    void run(async () => {
                      await client.start(selected.id);
                      await refresh();
                    })
                  }
                >
                  Start Codespace
                </button>
                <button
                  disabled={busy || !available}
                  onClick={() => void run(() => previewLifecycle("stop"))}
                >
                  Stop…
                </button>
                <button
                  disabled={busy}
                  onClick={() => void run(() => previewLifecycle("delete"))}
                >
                  Delete…
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const result = await client.sshCommand(selected.id);
                      await navigator.clipboard.writeText(result.command);
                      setNotice(
                        "SSH command copied. Run it in your own terminal.",
                      );
                    })
                  }
                >
                  Copy SSH Command
                </button>
              </div>
              {action && (
                <div
                  className="codespaces-confirm"
                  role="group"
                  aria-label={`${action} confirmation`}
                >
                  <h4>
                    {action === "delete"
                      ? "Delete this Codespace permanently"
                      : "Stop this Codespace"}
                  </h4>
                  <p>
                    {action === "delete"
                      ? "Deletion removes the cloud environment. Local recovery buffers are retained."
                      : "The editor will disconnect. The Codespace can be started again."}
                  </p>
                  {safety ? (
                    <>
                      <p>
                        Git: {safety.git.state} · Unsaved buffers:{" "}
                        {safety.buffers.dirtyCount} · Pending edits:{" "}
                        {safety.buffers.pendingTransactions}
                      </p>
                      {!safety.clean && (
                        <p role="alert">
                          Resolve unsaved, uncommitted or unpushed work first.
                          Unknown safety status blocks this action.
                        </p>
                      )}
                    </>
                  ) : (
                    <p>Checking Git and all open editor windows…</p>
                  )}
                  <label>
                    Type the exact Codespace ID
                    <input
                      value={confirmId}
                      onChange={(event) => setConfirmId(event.target.value)}
                      autoComplete="off"
                    />
                  </label>
                  <div className="input-row">
                    <button onClick={() => setAction(null)}>Cancel</button>
                    <button
                      className="danger"
                      disabled={
                        busy || !safety?.clean || confirmId !== selected.id
                      }
                      onClick={() => void run(applyLifecycle)}
                    >
                      {action === "delete"
                        ? "Delete Codespace"
                        : "Stop Codespace"}
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => void run(() => previewLifecycle(action))}
                    >
                      Recheck Safety
                    </button>
                  </div>
                </div>
              )}
            </section>
            <section
              className="codespaces-section"
              aria-label="Codespace folders"
            >
              <h3>Workspace folder</h3>
              <p className="muted">
                Choose the default development folder or browse another
                directory. Adding it keeps the other folders in this window.
              </p>
              <button
                disabled={busy || !available}
                onClick={() => void run(inspect)}
              >
                Discover Workspace Folder
              </button>
              {discovery && (
                <>
                  <p>
                    {discovery.probe?.os} {discovery.probe?.arch}{" "}
                    {discovery.probe?.cachePath &&
                      `· ${discovery.probe.cachePath}`}
                  </p>
                  <label>
                    Existing compatible helper folder (optional)
                    <input
                      value={helperPath}
                      onChange={(event) => setHelperPath(event.target.value)}
                      placeholder="Use the versioned helper by default"
                    />
                  </label>
                  <p className="muted">
                    New setup installs Islet’s versioned file helper, Node
                    runtime and Python/TypeScript language services in this
                    Codespace’s user cache. It needs no root access or permanent
                    daemon.
                  </p>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={approved}
                      onChange={(event) => setApproved(event.target.checked)}
                    />
                    Allow versioned helper setup on this Codespace
                  </label>
                  <button
                    disabled={busy || !available}
                    onClick={() => void run(connect)}
                  >
                    {connected || selected.editorState === "connected"
                      ? "Editor Connected"
                      : "Connect Editor"}
                  </button>
                  <label>
                    Absolute folder path
                    <input
                      value={folder}
                      onChange={(event) => setFolder(event.target.value)}
                    />
                  </label>
                  <div className="input-row">
                    <button
                      disabled={busy || !available}
                      onClick={() => void run(() => browse())}
                    >
                      Browse Folders
                    </button>
                    <button
                      disabled={busy || !available || !folder.startsWith("/")}
                      onClick={() =>
                        void run(async () => {
                          await connect();
                          await onAdd(folder, selected.hostId);
                          setNotice("Folder added to this workspace.");
                        })
                      }
                    >
                      Add Folder to Workspace
                    </button>
                  </div>
                  <div className="folder-picker">
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          browse(folder.replace(/\/[^/]+\/?$/, "") || "/"),
                        )
                      }
                    >
                      Parent Folder
                    </button>
                    {folders.map((entry) => (
                      <button
                        key={entry.path}
                        disabled={busy}
                        onClick={() => void run(() => browse(entry.path))}
                      >
                        {entry.name} <small>{entry.path}</small>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </section>
            <section
              className="codespaces-section"
              aria-label="Local port forwarding"
            >
              <h3>Local port forwarding</h3>
              <p className="muted">
                Forwards bind only to localhost and expire automatically. Port
                conflicts leave other applications untouched.
              </p>
              <label>
                Forward type
                <select
                  value={mode}
                  onChange={(event) =>
                    setMode(event.target.value as "simple" | "ssh")
                  }
                >
                  <option value="simple">Codespace port</option>
                  <option value="ssh">Advanced host and port over SSH</option>
                </select>
              </label>
              <div className="input-row">
                <label>
                  Local port
                  <input
                    type="number"
                    min="1024"
                    max="65535"
                    value={localPort}
                    onChange={(event) => setLocalPort(event.target.value)}
                  />
                </label>
                <label>
                  Remote port
                  <input
                    type="number"
                    min="1"
                    max="65535"
                    value={remotePort}
                    onChange={(event) => setRemotePort(event.target.value)}
                  />
                </label>
                <label>
                  Expires after (minutes)
                  <input
                    type="number"
                    min="1"
                    max="1440"
                    value={expiry}
                    onChange={(event) => setExpiry(event.target.value)}
                  />
                </label>
              </div>
              {mode === "ssh" && (
                <label>
                  Destination host inside Codespace
                  <input
                    value={remoteHost}
                    onChange={(event) => setRemoteHost(event.target.value)}
                    placeholder="service.internal"
                  />
                </label>
              )}
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={saveMapping}
                  onChange={(event) => setSaveMapping(event.target.checked)}
                />
                Save mapping for explicit restoration later
              </label>
              <button
                disabled={
                  busy || !available || !localPort || !remotePort || !expiry
                }
                onClick={() =>
                  void run(async () => {
                    await client.forward({
                      id: selected.id,
                      mode,
                      localPort: Number(localPort),
                      remotePort: Number(remotePort),
                      ...(mode === "ssh" ? { remoteHost } : {}),
                      expiresInMinutes: Number(expiry),
                      save: saveMapping,
                    });
                    await refresh();
                  })
                }
              >
                Start Local Forward
              </button>
            </section>
          </>
        )}
        <section className="codespaces-section" aria-label="Owned forwards">
          <h3>Islet-owned forwards</h3>
          {forwards.length === 0 ? (
            <p className="muted">No active forwards.</p>
          ) : (
            forwards.map((item) => (
              <div className="codespaces-forward" key={item.forwardId}>
                <span>
                  127.0.0.1:{item.localPort} → {item.remoteHost || "Codespace"}:
                  {item.remotePort}
                  <small>
                    {item.id} · {item.state} · expires{" "}
                    {item.expiresAt
                      ? new Date(item.expiresAt).toLocaleTimeString()
                      : "soon"}
                  </small>
                </span>
                <button
                  onClick={() =>
                    void navigator.clipboard.writeText(
                      `http://127.0.0.1:${item.localPort}`,
                    )
                  }
                >
                  Copy Local URL
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      if (item.forwardId)
                        await client.stopForward(item.forwardId);
                      await refresh();
                    })
                  }
                >
                  Stop Forward
                </button>
              </div>
            ))
          )}
          {saved.length > 0 && (
            <>
              <p>
                {saved.length} saved mapping{saved.length === 1 ? "" : "s"}.
                Only enabled mappings reconnect when you restore them.
              </p>
              <button
                disabled={busy || !saved.some((item) => item.enabled === true)}
                onClick={() =>
                  void run(async () => {
                    const result = await client.restoreForwards();
                    await refresh();
                    const failed = result.items.filter((item) => !item.ok);
                    if (failed.length)
                      throw Error(
                        failed
                          .map(
                            (item) =>
                              `${item.id}:${item.localPort}: ${item.error?.message || "Forward failed"}`,
                          )
                          .join("; "),
                      );
                  })
                }
              >
                Restore Enabled Mappings
              </button>
              {saved.map((item) => (
                <div
                  className="codespaces-forward"
                  key={item.id + ":" + item.localPort}
                >
                  <label className="check-label">
                    <input
                      type="checkbox"
                      aria-label={`Enable saved mapping ${item.id} localhost:${item.localPort}`}
                      checked={item.enabled === true}
                      disabled={busy}
                      onChange={(event) => {
                        const enabled = event.target.checked;
                        void run(async () => {
                          await client.configureForward(
                            item.id,
                            item.localPort,
                            enabled,
                          );
                          await refresh();
                        });
                      }}
                    />
                    Enabled
                  </label>
                  <span>
                    {item.id} · localhost:{item.localPort} →{" "}
                    {item.remoteHost || "Codespace"}:{item.remotePort}
                  </span>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await client.forgetForward(item.id, item.localPort);
                        await refresh();
                      })
                    }
                  >
                    Forget Saved Mapping
                  </button>
                </div>
              ))}
            </>
          )}
        </section>
        <footer>
          <span className="muted">
            Disabling the plugin closes owned connections and forwards, leaving
            cloud environments running.
          </span>
          <button onClick={onClose}>Done</button>
        </footer>
      </div>
    </Modal>
  );
}
