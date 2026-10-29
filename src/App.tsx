import { isDocx } from "./docx/formats";
import type { DocxHandle } from "./docx/DocxEditor";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Folder,
  FilePlus,
  FolderPlus,
  Search,
  Settings,
  ChevronDown,
  ArrowLeft,
  ArrowRight,
  Plus,
  X,
  PanelLeft,
  Save,
  Bookmark,
  MoreHorizontal,
  Pin,
  GitBranch,
  RefreshCw,
} from "lucide-react";
import { request, onHostEvent } from "./core/bridge";
import { FileIcon } from "./icons/FileIcon";
import { DocumentStore } from "./core/documents";
import {
  documentId,
  offsetAt,
  type DocumentModel,
  type LocationSnapshot,
  ownerOf,
} from "./core/types";
import {
  TransactionService,
  type EditTransaction,
} from "./refactoring/transactions";
import { LanguageManager, type LanguageLocation } from "./languages/client";
import { NavigationHistory } from "./navigation/history";
import { BookmarkStore } from "./navigation/bookmarks";
import { Editor, migrateEditorState, type EditorHandle } from "./editor/Editor";
import { ProjectTree } from "./shell/ProjectTree";
import { Modal } from "./shell/Modal";
import { useNativeMenu } from "./shell/NativeMenu";
import { AddFolderDialog } from "./shell/AddFolderDialog";
import { SearchDialog } from "./shell/SearchDialog";
import { Preview } from "./markdown/Preview";
import { NewEntryDialog } from "./shell/NewEntryDialog";
import type { SpreadsheetHandle } from "./spreadsheets/SpreadsheetEditor";
import { isSpreadsheet } from "./spreadsheets/formats";
const DocxEditor = lazy(() => import("./docx/DocxEditor"));
const SpreadsheetEditor = lazy(
  () => import("./spreadsheets/SpreadsheetEditor"),
);
import { ImagePreview } from "./media/ImagePreview";
import { CallerPanel } from "./navigation/CallerPanel";
import { syntaxName } from "./editor/languages";
import {
  defaults,
  validatePreferences,
  type Preferences,
} from "./settings/preferences";
import {
  shortcuts,
  matchesBinding,
  bindingFor,
  isEditorTextControl,
} from "./settings/shortcuts";
import { KeymapSettings } from "./settings/KeymapSettings";
import { base, type Root, parseLocation } from "./workspaces/model";
import { CodespacesClient } from "./plugins/codespaces/client";
import { CodespacesPanel } from "./plugins/codespaces/CodespacesPanel";
import { CodespacesPluginSettings } from "./plugins/codespaces/PluginSettings";
import { TerminalSettings } from "./settings/TerminalSettings";
import { ProjectSidebar } from "./shell/ProjectSidebar";
import { desktopActions } from "./shell/desktopActions";
import { TransferPanel } from "./files/TransferPanel";
import {
  copyFiles,
  copyToClipboard,
  pasteFiles,
  droppedItem,
  FILE_ITEM_MIME,
  folderAtPoint,
  type FileItem,
} from "./files/operations";
import { openDroppedPaths } from "./shell/fileDrops";
import { attachWorkspaceRoot, mergeManifestRoots } from "./workspaces/roots";
import { windowTitle, type RecentProject } from "./workspaces/recents";
import { UpdateDialog, UpdateSettings, useUpdates } from "./updates/Updates";
import { restartBlocked, updateLabel } from "./updates/client";
const documents = new DocumentStore(),
  transactions = new TransactionService(documents),
  languages = new LanguageManager(),
  history = new NavigationHistory(),
  bookmarks = new BookmarkStore(),
  codespaces = new CodespacesClient();
languages.documents = documents;
type MenuItem = {
  label: string;
  action: () => void;
  hint?: string;
  disabled?: string;
  separator?: boolean;
};
export default function App() {
  const [tick, setTick] = useState(0),
    [recents, setRecents] = useState<RecentProject[]>([]),
    [roots, setRootState] = useState<Root[]>([]),
    [tabs, setTabs] = useState<string[]>([]),
    [active, setActive] = useState(""),
    [settings, setSettings] = useState<Preferences>(defaults),
    [treeVisible, setTreeVisible] = useState(
      () => localStorage.getItem("islet.projectSidebar.visible") !== "false",
    ),
    [modal, setModal] = useState<string | null>(null),
    [error, setError] = useState(""),
    [searchScope, setSearchScope] = useState<
      { root: Root; path: string } | undefined
    >(),
    [tx, setTx] = useState<EditTransaction | null>(null),
    [rename, setRename] = useState(""),
    [locations, setLocations] = useState<LanguageLocation[]>([]),
    [menu, setMenu] = useState<{
      x: number;
      y: number;
      items: MenuItem[];
    } | null>(null),
    [workspaceName, setWorkspaceName] = useState("Workspace"),
    [workspaceId, setWorkspaceId] = useState(() => crypto.randomUUID()),
    [workspaceIdentity, setWorkspaceIdentity] = useState<string | undefined>(),
    [recoveries, setRecoveries] = useState<any[]>([]),
    [ready, setReady] = useState(false),
    [addPath, setAddPath] = useState(""),
    [addHost, setAddHost] = useState("local"),
    [nativeDropTarget, setNativeDropTarget] = useState<FileItem>();
  const [treeSelection, setTreeSelection] = useState<{
      hostId: string;
      path: string;
      folder: boolean;
    }>(),
    [workbookCopy, setWorkbookCopy] = useState<{
      text: string;
      binary: boolean;
    }>(),
    [createTarget, setCreateTarget] = useState<{
      hostId: string;
      path: string;
    }>(),
    [remoteApproved, setRemoteApproved] = useState(false),
    [pendingClose, setPendingClose] = useState<string | null>(null),
    [fragment, setFragment] = useState<string | undefined>(),
    [position, setPosition] = useState<LocationSnapshot>(),
    [auth, setAuth] = useState<any>(null),
    [authResponse, setAuthResponse] = useState(""),
    [sourceScroll, setSourceScroll] = useState<Record<string, number>>({}),
    [interpreterDraft, setInterpreterDraft] = useState(""),
    [codespacesSettings, setCodespacesSettings] = useState(codespaces.settings);
  const setRoots = (value: Root[] | ((previous: Root[]) => Root[])) => {
    const next = typeof value === "function" ? value(languages.roots) : value;
    languages.roots = next;
    setRootState(next);
  };
  const persistenceQueue = useRef<Promise<void>>(Promise.resolve());
  const dropFiles = useRef<(paths: string[]) => Promise<void>>(async () => {});
  const recoveryKey = useRef("recovery:" + crypto.randomUUID());
  const handledRequests = useRef(new Set<string>());
  const remoteReconnects = useRef(new Map<string, Promise<void>>());
  const [referenceIndex, setReferenceIndex] = useState(-1);
  const recentTabs = useRef<string[]>([]);
  const switchOrder = useRef<{ order: string[]; index: number } | null>(null);
  const [switcher, setSwitcher] = useState<string[]>([]);
  useEffect(() => {
    if (active)
      recentTabs.current = [
        active,
        ...recentTabs.current.filter((id) => id !== active),
      ];
  }, [active]);
  function tabStep(direction: number, recent = false) {
    const order = recent
      ? switchOrder.current?.order ||
        recentTabs.current.filter((id) => tabs.includes(id))
      : tabs;
    if (order.length < 2) return;
    const index =
      ((recent ? (switchOrder.current?.index ?? 0) : order.indexOf(active)) +
        direction +
        order.length) %
      order.length;
    if (recent) {
      switchOrder.current = { order, index };
      setSwitcher(order);
    }
    setActive(order[index]);
  }

  const bookmarkEditing = useRef<string | undefined>(undefined);
  const menuOrigin = useRef<LocationSnapshot | undefined>(undefined);
  const windowId = useRef("main"),
    allowClose = useRef(false),
    persistRef = useRef<() => Promise<any>>(async () => {});
  const docxEditor = useRef<DocxHandle>(null);
  const spreadsheet = useRef<SpreadsheetHandle>(null);
  const editor = useRef<EditorHandle>(null),
    loaded = useRef(false),
    saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    dragTab = useRef(""),
    renameTarget = useRef<
      { documentId: string; version: number; offset: number } | undefined
    >(undefined);
  persistRef.current = async () => {
    await documents.flush();
    const snapshot = {
      schemaVersion: 1,
      id: workspaceId,
      name: workspaceName,
      workspaceIdentity,
      roots,
      tabs,
      active,
      documents: documents.snapshot(),
      transactions: transactions.transactions,
      bookmarks: bookmarks.bookmarks,
      history: { entries: history.entries, index: history.index },
      sourceScroll,
    };
    const value = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;
    const key = recoveryKey.current,
      ownerWindow = windowId.current;
    const write = async () => {
      await request("session.save", { key, value });
      await request("session.save", {
        key: "window:" + ownerWindow,
        value: { key },
      });
      await request("session.register", {
        entry: {
          key,
          windowId: ownerWindow,
          workspaceId,
          workspaceIdentity,
          name: workspaceName,
          updated: Date.now(),
          dirtyCount: value.documents.filter((d) => d.dirty).length,
        },
      });
    };
    const pending = persistenceQueue.current.catch(() => {}).then(write);
    persistenceQueue.current = pending;
    return pending;
  };
  const updates = useUpdates({
    ready,
    persist: () => persistRef.current(),
    unsafe: () =>
      restartBlocked(
        documents.documents.values(),
        transactions.transactions.some(
          (transaction) =>
            transaction.journal?.some((entry) =>
              ["pending", "uncertain"].includes(entry.state),
            ) || false,
        ),
      ),
  });
  useEffect(() => {
    if (updates.open) {
      setModal(null);
      setMenu(null);
    }
  }, [updates.open]);
  const doc = documents.documents.get(active),
    currentRoot = doc ? ownerOf(roots, doc.hostId, doc.path) : undefined,
    dark =
      settings.theme === "dark" ||
      (settings.theme === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    if (modal === "settings")
      setInterpreterDraft(currentRoot?.interpreter || "");
  }, [modal, currentRoot?.hostId, currentRoot?.id, currentRoot?.interpreter]);
  const refresh = () => setTick((t) => t + 1);
  const fail = (e: unknown) => setError(String(e).replace(/^Error: /, ""));
  useEffect(() => documents.subscribe(refresh), []);
  useEffect(() => {
    localStorage.setItem("islet.projectSidebar.visible", String(treeVisible));
  }, [treeVisible]);
  useEffect(() => languages.subscribe(refresh), []);
  useEffect(() => {
    if (!(window as any).__TAURI_INTERNALS__) return;
    let disposed = false,
      off: (() => void) | undefined;
    void import("@tauri-apps/api/webview")
      .then(async ({ getCurrentWebview }) => {
        const unlisten = await getCurrentWebview().onDragDropEvent((event) => {
          const value = event.payload;
          if (value.type === "leave") {
            setNativeDropTarget(undefined);
            return;
          }
          const target = folderAtPoint(
            value.position.x,
            value.position.y,
            window.devicePixelRatio,
          );
          if (value.type === "drop") {
            setNativeDropTarget(undefined);
            if (target)
              void copyFiles(
                value.paths.map((path) => ({ hostId: "local", path })),
                target,
              ).catch(fail);
            else void dropFiles.current(value.paths).catch(fail);
          } else setNativeDropTarget(target);
        });
        if (disposed) unlisten();
        else off = unlisten;
      })
      .catch(fail);
    return () => {
      disposed = true;
      off?.();
    };
  }, []);
  useEffect(() => {
    const off = codespaces.subscribe(() =>
      setCodespacesSettings(codespaces.settings),
    );
    void codespaces.load().catch(fail);
    return off;
  }, []);
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    (async () => {
      try {
        if ((window as any).__TAURI_INTERNALS__) {
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          windowId.current = getCurrentWindow().label;
        } else {
          windowId.current =
            sessionStorage.getItem("islet-window") || crypto.randomUUID();
          sessionStorage.setItem("islet-window", windowId.current);
        }
        languages.clientId = windowId.current;
        const prefs = await request<any>("settings.load", {});
        if (prefs) setSettings(validatePreferences(prefs));
        const recent = await request<RecentProject[]>("recents.list");
        setRecents(Array.isArray(recent) ? recent : []);
        const initialArgs =
          windowId.current === "main"
            ? await request<string[]>("app.initialArgs", {}).catch(() => [])
            : [];
        const initialRequest = initialArgs.length
          ? await request<any>("app.parseArgs", { args: initialArgs })
          : null;
        const pointer = await request<any>("session.load", {
          key: "window:" + windowId.current,
        });
        const priorKey = pointer?.key || "workspace:" + windowId.current;
        const session = await request<any>("session.load", { key: priorKey });
        if (session && !initialRequest) await restoreSession(session);
        else if (session && initialRequest)
          await request("session.register", {
            entry: {
              key: priorKey,
              windowId: windowId.current,
              workspaceId: session.id || "legacy",
              workspaceIdentity: session.workspaceIdentity,
              name: session.name || "Recovered Workspace",
              updated: Date.now(),
              dirtyCount: (session.documents || []).filter((d: any) => d.dirty)
                .length,
            },
          });
        const args = new URLSearchParams(window.location.search).getAll("root");
        for (const path of args) await addRoot(path);
        await request("app.registerWindow", {
          windowId: windowId.current,
          name: "Workspace",
          focused: true,
        });
        const pending = await request<any>("app.pendingRequests", {
          windowId: windowId.current,
        }).catch(() => []);
        for (const req of pending || []) await handleCli(req);
        if (initialRequest)
          await handleCli({ ...initialRequest, newWindow: false });
        await languages.connect();
      } catch (e) {
        fail(e);
      } finally {
        setReady(true);
      }
    })();
    const focus = () => {
      void request("app.registerWindow", {
        windowId: windowId.current,
        focused: true,
      });
      for (const hostId of new Set(languages.roots.map((root) => root.hostId)))
        if (hostId.startsWith("ssh:"))
          void reconnectHost(hostId).catch(() => {});
      for (const id of documents.documents.keys())
        if (!documents.documents.get(id)?.hostId.startsWith("ssh:"))
          void documents.checkExternal(id).catch(() => {});
    };
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, []);
  useEffect(() => {
    if (!ready) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(
      () => void persistRef.current().catch(fail),
      200,
    );
  }, [
    tick,
    roots,
    tabs,
    active,
    workspaceName,
    workspaceId,
    ready,
    sourceScroll,
  ]);
  useEffect(() => {
    if (ready) void request("settings.save", { value: settings }).catch(fail);
  }, [settings, ready]);
  useEffect(() => {
    if (!(window as any).__TAURI_INTERNALS__) return;
    let off: (() => void) | undefined;
    let disposed = false;
    void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const native = getCurrentWindow();
      const cleanup = await native.onCloseRequested(async (event) => {
        if (updates.frozenRef.current) {
          event.preventDefault();
          return;
        }
        if (allowClose.current) return;
        event.preventDefault();
        if ([...documents.documents.values()].some((d) => d.dirty)) {
          setModal("close-window");
          return;
        }
        try {
          await persistRef.current();
          allowClose.current = true;
          await native.close();
        } catch (e) {
          fail(e);
        }
      });
      if (disposed) cleanup();
      else off = cleanup;
    });
    return () => {
      disposed = true;
      off?.();
    };
  }, []);
  async function closeNative(saveChanges: boolean) {
    try {
      if (saveChanges) await saveAll();
      await persistRef.current();
      allowClose.current = true;
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch (e) {
      fail(e);
    }
  }
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (
        !allowClose.current &&
        [...documents.documents.values()].some((d) => d.dirty)
      ) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, []);
  useEffect(() => {
    let off: (() => void) | undefined;
    void onHostEvent("host-event", (event) => {
      if (event.type === "recent-projects") setRecents(event.entries);
      if (event.type === "recent-open-error") fail(event.message);
      if (event.type === "file-changed") {
        const id = documentId(event.hostId, event.path);
        if (documents.documents.has(id))
          void documents.checkExternal(id).catch(fail);
      }
      if (event.type === "codespaces-settings") {
        codespaces.accept(event.settings);
        if (!event.settings.enabled)
          setModal((current) => (current === "codespaces" ? null : current));
      }
      if (event.type === "codespaces-buffer-check") {
        const affected = [...documents.documents.values()].filter(
          (document) => document.hostId === event.hostId,
        );
        void request("codespaces.buffers", {
          requestId: event.requestId,
          windowId: windowId.current,
          dirtyCount: affected.filter(
            (document) =>
              document.dirty ||
              document.saveState === "pending" ||
              document.saveState === "uncertain",
          ).length,
          pendingTransactions: transactions.transactions.filter(
            (transaction) =>
              transaction.files.some((file) => file.hostId === event.hostId) &&
              transaction.journal?.some((entry) =>
                ["pending", "uncertain"].includes(entry.state),
              ),
          ).length,
        }).catch(fail);
      }
      if (event.type === "authentication") {
        setAuth(event);
        setAuthResponse("");
      }
      if (
        event.type === "cli-request" &&
        (!event.request.windowId || event.request.windowId === windowId.current)
      )
        void handleCli(event.request).catch(fail);
      if (event.type === "connection") {
        setRoots((rs) =>
          rs.map((r) =>
            r.hostId === event.hostId
              ? {
                  ...r,
                  state:
                    event.state === "ready" && event.hostId.startsWith("ssh:")
                      ? "connecting"
                      : event.state,
                  connectionError:
                    event.error?.message ||
                    (typeof event.error === "string" ? event.error : undefined),
                }
              : r,
          ),
        );
        // Another window can restore the shared SSH transport. Each window
        // still needs to reattach its own roots, watches and language buffers.
        if (
          event.state === "ready" &&
          event.hostId.startsWith("ssh:") &&
          !remoteReconnects.current.has(event.hostId) &&
          languages.roots.some((root) => root.hostId === event.hostId)
        )
          void reconnectHost(event.hostId).catch(() => {});
      }
    }).then((f) => (off = f));
    return () => off?.();
  }, []);
  useEffect(() => {
    if (ready)
      void request("app.registerWindow", {
        windowId: windowId.current,
        name: workspaceName,
        workspaceId,
        workspaceIdentity,
        firstFolder: windowTitle(roots, workspaceName),
        roots: roots.map(({ hostId, path }) => ({ hostId, path })),
        empty: !roots.length && !documents.documents.size,
      }).catch(fail);
  }, [
    ready,
    workspaceName,
    workspaceId,
    workspaceIdentity,
    roots,
    tabs.length,
  ]);
  async function rememberRecent(
    project: Omit<RecentProject, "id" | "updated">,
  ) {
    try {
      const recent = await request<RecentProject[]>("recents.record", project);
      if (Array.isArray(recent)) setRecents(recent);
    } catch (error) {
      console.error("Could not save recent project", error);
    }
  }
  async function openRecent(project: RecentProject) {
    try {
      await request("app.openRecent", {
        id: project.id,
        windowId: windowId.current,
      });
    } catch (error) {
      fail(error);
    }
  }
  async function openRestoredRoot(root: Root): Promise<Root> {
    try {
      return await request<Root>("root.open", {
        ...root,
        clientId: languages.clientId,
      });
    } catch (error) {
      if ((error as any)?.code !== "INVALID_INTERPRETER") throw error;
      fail(
        new Error(
          `${root.label}: the configured Python interpreter is unavailable. Choose an executable on ${root.hostId} in Language settings. Folder browsing remains available.`,
        ),
      );
      const opened = await request<Root>("root.open", {
        ...root,
        interpreter: "",
        clientId: languages.clientId,
      });
      return { ...opened, interpreter: root.interpreter };
    }
  }
  async function restoreSession(session: any) {
    documents.documents.clear();
    transactions.transactions = [];
    bookmarks.bookmarks = [];
    history.entries = [];
    history.index = -1;
    setWorkspaceIdentity(session.workspaceIdentity);

    const restored: Root[] = session.roots || [];
    setRoots(
      restored.map((root) => ({
        ...root,
        state: root.hostId === "local" ? "ready" : "connecting",
      })),
    );
    const localRoots = restored.filter((root) => root.hostId === "local");
    await Promise.all(
      localRoots.map(async (root) => {
        try {
          const checked = await openRestoredRoot(root);
          setRoots((rs) => rs.map((r) => (r.id === root.id ? checked : r)));
        } catch {
          setRoots((rs) =>
            rs.map((r) =>
              r.id === root.id ? { ...r, state: "unavailable" } : r,
            ),
          );
        }
      }),
    );
    setTabs(session.tabs || []);
    setActive(session.active || "");
    setWorkspaceName(session.name || "Workspace");
    setWorkspaceId(session.id || "default");
    documents.restore(session.documents || []);
    transactions.transactions = session.transactions || [];
    bookmarks.bookmarks = session.bookmarks || [];
    history.entries = session.history?.entries || [];
    history.index = session.history?.index ?? -1;
    setSourceScroll(session.sourceScroll || {});
    for (const hostId of new Set(restored.map((root) => root.hostId)))
      if (hostId !== "local") void reconnectHost(hostId).catch(() => {});
    for (const restoredDoc of documents.documents.values())
      if (restoredDoc.hostId === "local") void validateRestored(restoredDoc);
    documents.emit();
    if (session.workspaceIdentity)
      void rememberRecent({
        kind: "workspace",
        hostId: "local",
        path: session.workspaceIdentity,
        name: session.name || base(session.workspaceIdentity),
      });
    else if (restored[0])
      void rememberRecent({
        kind: "folder",
        ...restored[0],
        name: base(restored[0].path),
      });
  }
  function reconnectHost(hostId: string, interactive = false): Promise<void> {
    if (updates.frozenRef.current) return Promise.resolve();
    const pending = remoteReconnects.current.get(hostId);
    if (pending) return pending;
    const run = Promise.resolve().then(async () => {
      setRoots((current) =>
        current.map((root) =>
          root.hostId === hostId
            ? { ...root, state: "connecting", connectionError: undefined }
            : root,
        ),
      );
      try {
        await request("remote.connect", { hostId, interactive });
        await reattachProviderRoots(hostId);
      } catch (error) {
        setRoots((current) =>
          current.map((root) =>
            root.hostId === hostId
              ? {
                  ...root,
                  state: "disconnected",
                  connectionError:
                    error instanceof Error ? error.message : String(error),
                }
              : root,
          ),
        );
        throw error;
      } finally {
        remoteReconnects.current.delete(hostId);
      }
    });
    remoteReconnects.current.set(hostId, run);
    return run;
  }
  async function reattachProviderRoots(hostId: string) {
    const attached = languages.roots.filter((root) => root.hostId === hostId);
    for (const root of attached) {
      try {
        const checked = await openRestoredRoot(root);
        setRoots((current) =>
          current.map((item) =>
            item.hostId === hostId && item.id === root.id ? checked : item,
          ),
        );
      } catch (error) {
        if (
          ["DISCONNECTED", "SSH_TIMEOUT", "HOST_DISCONNECTED"].includes(
            (error as any)?.code,
          )
        )
          throw error;
        // One deleted/inaccessible folder must not block other roots on the host.
        setRoots((current) =>
          current.map((item) =>
            item.hostId === hostId && item.id === root.id
              ? {
                  ...item,
                  state: "unavailable",
                  connectionError:
                    error instanceof Error ? error.message : String(error),
                }
              : item,
          ),
        );
      }
    }
    for (const document of documents.documents.values()) {
      if (document.hostId !== hostId) continue;
      const owner = ownerOf(languages.roots, hostId, document.path);
      if (owner?.state !== "ready") continue;
      await validateRestored(document);
      void languages.ensure(owner, document).catch(fail);
    }
  }
  async function openManifest(
    path: string,
    preferNewWindow = true,
    interpreterOverrides: any[] = [],
  ) {
    const manifest: any = await request("workspace.load", {
      path,
      interpreterOverrides,
    });
    if (roots.length || documents.documents.size) {
      if (!preferNewWindow)
        throw Error(
          "This window already contains a workspace. Open the manifest in a new window to preserve its current recovery.",
        );
      const created: any = await request("app.newWindow", {});
      await request("cli.deliver", {
        operation: "open",
        workspace: manifest.manifestPath || path,
        interpreterOverrides,
        newWindow: false,
        windowId: created.windowId,
        requestId: crypto.randomUUID(),
      });
      return;
    }
    const entries: any[] = await request("session.list", {});
    const previous = entries.find(
      (entry) => entry.workspaceIdentity === (manifest.manifestPath || path),
    );
    const prior = previous
      ? await request<any>("session.load", { key: previous.key })
      : null;
    const included = (prior?.documents || []).filter(
      (document: DocumentModel) =>
        manifest.roots.some(
          (root: Root) =>
            root.hostId === document.hostId &&
            (document.path === root.path ||
              document.path.startsWith(root.path.replace(/\/$/, "") + "/")),
        ) || document.readonly,
    );
    const ids = new Set(included.map((document: DocumentModel) => document.id));
    await restoreSession({
      ...prior,
      id: manifest.id || crypto.randomUUID(),
      name: manifest.name || base(path),
      workspaceIdentity: manifest.manifestPath || path,
      roots: mergeManifestRoots(prior?.roots || [], manifest.roots),
      documents: included,
      tabs: (prior?.tabs || []).filter((id: string) => ids.has(id)),
      active: ids.has(prior?.active) ? prior.active : "",
      transactions: (prior?.transactions || []).filter((tx: any) =>
        tx.files.every((file: any) => ids.has(file.documentId)),
      ),
    });
    await rememberRecent({
      kind: "workspace",
      hostId: "local",
      path: manifest.manifestPath || path,
      name: manifest.name || base(path),
    });
  }
  async function showRecoveries() {
    try {
      setRecoveries(
        (await request<any[]>("session.list", {})).filter(
          (entry) => entry.key !== recoveryKey.current,
        ),
      );
      setModal("recovery");
    } catch (e) {
      fail(e);
    }
  }
  async function validateRestored(document: DocumentModel) {
    try {
      if (document.standalone && document.hostId === "local") {
        const grant = await request<{ readonly: boolean }>("file.authorize", {
          hostId: "local",
          path: document.path,
          clientId: languages.clientId,
        });
        document.readonly = document.image || grant.readonly;
      }
      await documents.checkExternal(document.id);
      bookmarks.relocate(document);
      await request("fs.watch", {
        hostId: document.hostId,
        path: document.path,
      });
      refresh();
    } catch (error) {
      if (document.hostId === "local") fail(error);
    }
  }
  async function handleCli(req: any) {
    if (req.requestId) {
      await request("app.ackRequest", { requestId: req.requestId }).catch(
        () => {},
      );
      if (handledRequests.current.has(req.requestId)) return;
      handledRequests.current.add(req.requestId);
    }
    if (req.newWindow) {
      const created: any = await request("app.newWindow", {});
      await request("cli.deliver", {
        ...req,
        newWindow: false,
        windowId: created.windowId,
      });
      return;
    }
    if (req.recoveryKey) {
      if (roots.length || documents.documents.size)
        throw Error("Recover this workspace in a new window.");
      const snapshot = await request<any>("session.load", {
        key: req.recoveryKey,
      });
      if (!snapshot) throw Error("This recovery record is unavailable.");
      await restoreSession(snapshot);
      return;
    }
    if (req.workspace) {
      await openManifest(req.workspace, false, req.interpreterOverrides || []);
      return;
    }
    for (const item of req.roots || []) {
      const value = typeof item === "string" ? item : item.uri || item.path;
      if (
        (!item.hostId || item.hostId === "local") &&
        !String(value).startsWith("ssh://")
      ) {
        const entry = await request<{ isDirectory: boolean; path: string }>(
          "fs.stat",
          { hostId: "local", path: value },
        );
        if (!entry.isDirectory) {
          await dropFiles.current([entry.path]);
          continue;
        }
      }
      await addRoot(value, item.hostId, typeof item === "string" ? {} : item);
    }
    if (req.files?.length) await dropFiles.current(req.files);
  }

  async function addRoot(
    value: string,
    hostOverride?: string,
    configuration: Partial<Root> = {},
  ) {
    let parsed: { hostId: string; path: string } | undefined;
    try {
      parsed =
        hostOverride && hostOverride !== "local"
          ? { hostId: hostOverride, path: value }
          : parseLocation(value);
      const opened = await attachWorkspaceRoot(
        { ...configuration, ...parsed },
        languages,
        request,
      );
      await rememberRecent({
        kind: "folder",
        ...opened,
        name: base(opened.path),
      });
      return opened;
    } catch (e) {
      if (
        parsed &&
        parsed.hostId !== "local" &&
        !(e as any)?.code?.includes("INTERPRETER")
      ) {
        const existing = languages.roots.find(
          (root) =>
            root.hostId === parsed!.hostId && root.path === parsed!.path,
        );
        const root: Root = {
          ...existing,
          ...configuration,
          ...parsed,
          id: existing?.id || parsed.hostId + ":" + parsed.path,
          label: existing?.label || base(parsed.path),
          state: "disconnected",
        };
        languages.roots = existing
          ? languages.roots.map((item) => (item === existing ? root : item))
          : [...languages.roots, root];
      }
      fail(e);
    } finally {
      setRoots([...languages.roots]);
    }
  }
  dropFiles.current = (paths) =>
    openDroppedPaths(paths, {
      stat: (path) => request("fs.stat", { hostId: "local", path }),
      contains: (path) => !!ownerOf(languages.roots, "local", path),
      addRoot: async (path) => {
        if (!(await addRoot(path)))
          throw Error("The dropped folder could not be added.");
      },
      open: async (path) => {
        const selected = await documents.openStandalone(
          path,
          languages.clientId,
        );
        await open("local", selected.path, false);
      },
    });
  function newEntry(
    directory = false,
    target?: { hostId: string; path: string },
  ) {
    if (!roots.length) {
      setError("Open a project folder before creating a file or folder.");
      return;
    }
    const selected = treeSelection;
    const fallback = doc && ownerOf(roots, doc.hostId, doc.path);
    const initial =
      target ||
      (selected
        ? {
            hostId: selected.hostId,
            path: selected.folder
              ? selected.path
              : selected.path.slice(0, selected.path.lastIndexOf("/")) || "/",
          }
        : fallback
          ? {
              hostId: fallback.hostId,
              path: doc!.path.slice(0, doc!.path.lastIndexOf("/")) || "/",
            }
          : roots[0]);
    setCreateTarget(initial);
    setModal(directory ? "new-folder" : "new-file");
    setMenu(null);
  }
  async function openFile() {
    try {
      const paths = await request<string[] | string | null>("dialog.open", {
        directory: false,
        multiple: true,
      });
      if (!paths) return;
      await dropFiles.current(Array.isArray(paths) ? paths : [paths]);
    } catch (e) {
      fail(e);
    }
  }
  async function browseAdd() {
    try {
      const result: any = await request("dialog.open", {
        directory: true,
        multiple: true,
      });
      for (const path of Array.isArray(result)
        ? result
        : result
          ? [result]
          : [])
        await addRoot(typeof path === "string" ? path : path.path);
    } catch (e) {
      fail(e);
    }
  }
  function capture(): LocationSnapshot | undefined {
    if (doc?.markdownMode === "preview")
      return {
        documentId: doc.id,
        hostId: doc.hostId,
        path: doc.path,
        anchor: 0,
        head: 0,
        scrollTop: sourceScroll[doc.id] || 0,
        scrollLeft: 0,
        mode: "preview",
      };
    const location = editor.current?.snapshot() || doc?.location;
    return location
      ? { ...location, mode: doc?.markdownMode ? "source" : undefined }
      : undefined;
  }
  async function open(
    hostId: string,
    path: string,
    preview = false,
    offset?: number,
    record = false,
    hash?: string,
    dependency = false,
  ) {
    const origin = capture();
    try {
      const d = await documents.open(hostId, path);
      if (
        !(hostId === "local" && d.standalone) &&
        !ownerOf(languages.roots, hostId, d.path) &&
        languages.roots.length &&
        !record &&
        !dependency
      ) {
        setError(
          "This file is outside the attached workspace. Add its folder first.",
        );
        return;
      }
      await request("fs.watch", { hostId: d.hostId, path: d.path }).catch(
        () => {},
      );
      if (
        !(hostId === "local" && d.standalone) &&
        !ownerOf(languages.roots, hostId, d.path) &&
        languages.roots.length
      )
        d.readonly = true;
      bookmarks.relocate(d);
      if (d.markdownMode && !d.location)
        d.markdownMode = settings.markdownDefault;
      d.preview = preview && !d.pinned;
      setTabs((previous) => {
        const next = previous.filter((id) => {
          const old = documents.documents.get(id);
          return !(
            preview &&
            old?.preview &&
            !old.dirty &&
            !old.pinned &&
            id !== d.id
          );
        });
        return next.includes(d.id) ? next : [...next, d.id];
      });
      setActive(d.id);
      setFragment(hash);
      if (offset !== undefined && d.spreadsheet && !d.binary)
        d.spreadsheetMode = "source";
      if (offset !== undefined && d.markdownMode) d.markdownMode = "source";
      if (offset !== undefined || record) {
        offset = offset ?? d.location?.head ?? 0;
        const destination: LocationSnapshot = {
          documentId: d.id,
          hostId: d.hostId,
          path: d.path,
          anchor: offset,
          head: offset,
          scrollTop: 0,
          scrollLeft: 0,
          mode:
            d.markdownMode === "preview"
              ? "preview"
              : d.markdownMode
                ? "source"
                : undefined,
        };
        if (d.markdownMode !== "preview") {
          d.location = destination;
          setTimeout(() => editor.current?.reveal(destination), 0);
        } else setSourceScroll((scrolls) => ({ ...scrolls, [d.id]: 0 }));
        if (record) history.push(origin, destination);
      }
      refresh();
      return d;
    } catch (e) {
      fail(e);
      return undefined;
    }
  }
  async function navigate(location: LanguageLocation) {
    const d = await documents.open(location.hostId, location.path);
    await open(
      location.hostId,
      location.path,
      false,
      offsetAt(d.text, location.range.start),
      true,
    );
  }
  async function restore(location: LocationSnapshot | undefined) {
    if (!location) return false;
    try {
      await request("fs.stat", {
        hostId: location.hostId,
        path: location.path,
      });
      const opened = await open(
        location.hostId,
        location.path,
        false,
        undefined,
        false,
        undefined,
        true,
      );
      if (!opened) return false;
      if (location.mode === "preview") {
        opened.markdownMode = "preview";
        setFragment(undefined);
        setSourceScroll((scrolls) => ({
          ...scrolls,
          [opened.id]: location.scrollTop,
        }));
      } else {
        if (opened.markdownMode) opened.markdownMode = "source";
        opened.location = location;
        setTimeout(() => editor.current?.restore(location), 0);
      }
      refresh();
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  }
  function back() {
    const index = history.index;
    const target = history.back(capture());
    void restore(target).then((ok) => {
      if (!ok) history.index = index;
      refresh();
    });
  }
  function forward() {
    const index = history.index;
    const target = history.forward(capture());
    void restore(target).then((ok) => {
      if (!ok) history.index = index;
      refresh();
    });
  }
  async function saveAll() {
    spreadsheet.current?.commit();
    const grouped = new Set<string>();
    const outcomes: any[] = [];
    for (const transaction of transactions.transactions.filter(
      (t) =>
        t.state === "applied" &&
        t.files.some((f) => documents.require(f.documentId).dirty) &&
        t.files.every((f) => documents.require(f.documentId).text === f.after),
    )) {
      try {
        const journal = await transactions.save(transaction);
        outcomes.push(...journal);
        for (const file of transaction.files) grouped.add(file.documentId);
      } catch (e) {
        fail(e);
        throw e;
      }
    }
    const loose = [...documents.documents.values()].filter(
      (d) => d.dirty && !grouped.has(d.id),
    );
    const journal = {
      id: crypto.randomUUID(),
      files: loose.map((d) => ({
        documentId: d.id,
        hostId: d.hostId,
        path: d.path,
        state: "pending",
        error: "",
      })),
    };
    await request("journal.save", { key: journal.id, value: journal });
    for (const file of journal.files) {
      try {
        await documents.save(file.documentId);
        file.state = "saved";
      } catch (e) {
        file.state =
          documents.require(file.documentId).saveState || "uncertain";
        file.error = String(e);
      }
      await request("journal.save", { key: journal.id, value: journal });
    }
    outcomes.push(...journal.files);
    const failed = outcomes.filter((o) => o.state !== "saved");
    if (failed.length) {
      setError(
        failed
          .map(
            (o) =>
              `${base(documents.require(o.documentId).path)}: ${o.state}${o.error ? " — " + o.error : ""}`,
          )
          .join(" · "),
      );
      throw Error(
        failed
          .map(
            (o) =>
              `${documents.require(o.documentId).path}: ${o.state}${o.error ? " — " + o.error : ""}`,
          )
          .join(" · "),
      );
    }
    refresh();
  }
  async function save() {
    spreadsheet.current?.commit();
    if (doc)
      try {
        await documents.save(doc.id);
      } catch (e) {
        fail(e);
      }
  }
  function close(id: string, force = false) {
    const d = documents.require(id);
    if (force && d.dirty) {
      documents.change(id, d.savedText);
    }
    if (d.dirty && !force) {
      setPendingClose(id);
      setModal("close");
      return;
    }
    const next = tabs.filter((t) => t !== id);
    setTabs(next);
    if (active === id) setActive(next[Math.max(0, tabs.indexOf(id) - 1)] || "");
    setModal(null);
    setPendingClose(null);
  }
  function search(replace = false, initial?: { root: Root; path: string }) {
    setSearchScope(initial);
    setModal(replace ? "replace-files" : "find-files");
    setMenu(null);
  }
  async function definition(references = false, targetOffset?: number) {
    if (!doc) return;
    try {
      const offset = targetOffset ?? capture()?.head ?? 0;
      const found = references
        ? await languages.references(doc, offset)
        : await languages.definition(doc, offset);
      if (!found.length) {
        editor.current?.notice("No reference found", offset);
        return;
      }
      if (found.length === 1 && !references) await navigate(found[0]);
      else {
        await Promise.allSettled(
          found.map((location) =>
            documents.open(location.hostId, location.path),
          ),
        );
        setLocations(found);
        setModal("locations");
      }
    } catch (e) {
      fail(e);
    }
  }
  async function beginRename(targetOffset?: number) {
    if (!doc) return;
    try {
      const at = targetOffset ?? capture()?.head ?? 0;
      const version = doc.version;
      const result: any = await languages.prepareRename(doc, at);
      if (result === null)
        throw Error("The language service cannot rename this symbol.");
      const range = result?.range || result;
      setRename(
        result?.placeholder ||
          (range?.start
            ? doc.text.slice(
                offsetAt(doc.text, range.start),
                offsetAt(doc.text, range.end),
              )
            : doc.text.slice(at).match(/^\w+/)?.[0] || ""),
      );
      renameTarget.current = { documentId: doc.id, version, offset: at };
      setModal("rename");
    } catch (e) {
      fail(e);
    }
  }
  async function previewRename() {
    if (!doc) return;
    try {
      if (!rename.trim()) throw Error("Enter a new identifier.");
      const target = renameTarget.current;
      if (
        !target ||
        target.documentId !== doc.id ||
        target.version !== doc.version
      )
        throw Error(
          "The rename target changed. Close this dialog and rename the symbol again.",
        );
      const edit = await languages.rename(doc, target.offset, rename);
      const proposed = await transactions.fromWorkspaceEdit(
        "Rename symbol",
        doc.hostId,
        edit,
      );
      if (!proposed.files.length)
        throw Error("The language service returned no changes.");
      setTx(proposed);
      setModal("transaction");
    } catch (e) {
      fail(e);
    }
  }
  function bookmark(targetOffset?: number) {
    if (!doc) return;
    editor.current?.toggleBookmark(targetOffset ?? capture()?.head);
    refresh();
  }
  function referenceJump(direction: 1 | -1) {
    const next = referenceIndex + direction;
    if (next < 0 || next >= locations.length) return;
    setReferenceIndex(next);
    void navigate(locations[next]);
  }
  function bookmarkJump(direction: 1 | -1) {
    if (!doc) return;
    const next = bookmarks.next(doc.id, capture()?.head ?? 0, direction);
    if (next) void open(next.hostId, next.path, false, next.offset, true);
  }
  async function functionJump(direction: 1 | -1) {
    if (!doc) return;
    const offset = await editor.current?.functionOffset(direction);
    if (offset !== undefined)
      await open(doc.hostId, doc.path, false, offset, true);
  }
  function command(id: string) {
    if (updates.frozenRef.current) return;
    if (id === "newWorkspace") {
      void request("app.newWindow").catch(fail);
      return;
    }
    if (
      isEditorTextControl(document.activeElement) &&
      [
        "copy",
        "cut",
        "paste",
        "select-all",
        "selectAll",
        "undo",
        "redo",
      ].includes(id)
    ) {
      document.execCommand(
        id === "select-all" || id === "selectAll" ? "selectAll" : id,
      );
      return;
    }
    if (modal) return;
    if (
      ["copy", "paste"].includes(id) &&
      document.activeElement?.closest(".tree") &&
      treeSelection?.hostId === "local"
    ) {
      const item = { hostId: "local", path: treeSelection.path };
      void (
        id === "copy"
          ? copyToClipboard(item)
          : pasteFiles({
              ...item,
              path: treeSelection.folder
                ? item.path
                : item.path.slice(0, item.path.lastIndexOf("/")) || "/",
            })
      ).catch(fail);
      return;
    }
    id =
      (
        {
          "find-files": "findFiles",
          "replace-files": "replaceFiles",
          "next-function": "nextFunction",
          "previous-function": "previousFunction",
          selectAll: "select-all",
        } as Record<string, string>
      )[id] || id;
    if (id === "bookmarks-changed") {
      refresh();
      return;
    }
    const actions: Record<string, () => void> = {
      newFile: () => newEntry(),
      newFolder: () => newEntry(true),
      openFile: () => void openFile(),
      settings: () => setModal("settings"),
      saveAll: () => void saveAll().catch(fail),
      toggleProject: () => setTreeVisible((v) => !v),
      nextTab: () => tabStep(1),
      previousTab: () => tabStep(-1),
      switchTab: () => tabStep(1, true),
      switchTabBack: () => tabStep(-1, true),
      reopenTab: () => {
        const id = [...documents.documents.keys()]
          .reverse()
          .find((id) => !tabs.includes(id));
        if (id) {
          setTabs([...tabs, id]);
          setActive(id);
        }
      },
      save: () => void save(),
      closeTab: () => {
        if (active) close(active);
      },
      definition: () => void definition(),
      references: () => void definition(true),
      rename: () => void beginRename(),
      back: back,
      forward: forward,
      bookmark: bookmark,
      bookmarks: () => setModal("bookmarks"),
      previousBookmark: () => bookmarkJump(-1),
      nextBookmark: () => bookmarkJump(1),
      findFiles: () => search(),
      replaceFiles: () => search(true),
      nextFunction: () => void functionJump(1),
      previousFunction: () => void functionJump(-1),
      undoGroup: () => void transactions.undo().catch(fail),
    };
    if (actions[id]) actions[id]();
    else if (doc?.docx) void docxEditor.current?.command(id).catch(fail);
    else if (doc?.spreadsheet && doc.spreadsheetMode !== "source")
      spreadsheet.current?.command(id);
    else editor.current?.command(id);
    setMenu(null);
  }
  useEffect(() => {
    const clipboard = (event: ClipboardEvent) => {
      if (
        modal ||
        isEditorTextControl(event.target) ||
        !(event.target instanceof Element && event.target.closest(".tree")) ||
        treeSelection?.hostId !== "local"
      )
        return;
      event.preventDefault();
      command(event.type);
    };
    document.addEventListener("copy", clipboard);
    document.addEventListener("paste", clipboard);
    return () => {
      document.removeEventListener("copy", clipboard);
      document.removeEventListener("paste", clipboard);
    };
  }, [treeSelection, modal, doc, roots]);
  function editorMenu(x: number, y: number, offset?: number) {
    menuOrigin.current = capture();
    const items: MenuItem[] = [
      { label: "Undo", action: () => command("undo"), hint: "⌘Z" },
      { label: "Redo", action: () => command("redo"), hint: "⇧⌘Z" },
      { label: "Cut", action: () => command("cut"), hint: "⌘X" },
      { label: "Copy", action: () => command("copy"), hint: "⌘C" },
      { label: "Paste", action: () => command("paste"), hint: "⌘V" },
      { label: "Select All", action: () => command("selectAll"), hint: "⌘A" },
      {
        label: "Go to Definition",
        action: () => void definition(false, offset),
        hint: "⌘B",
        separator: true,
      },
      {
        label: "Find References",
        action: () => void definition(true, offset),
        hint: "⌥F7",
      },
      {
        label: "Back",
        action: back,
        disabled: !history.canBack ? "No previous location" : undefined,
        hint: "⌘[",
      },
      {
        label: "Forward",
        action: forward,
        disabled: !history.canForward ? "No next location" : undefined,
        hint: "⌘]",
      },
      { label: "Previous Function", action: () => void functionJump(-1) },
      { label: "Next Function", action: () => void functionJump(1) },
      {
        label: "Toggle Bookmark",
        action: () => bookmark(offset),
        separator: true,
        hint: "⌘F11",
      },
      {
        label: "Edit Bookmark Label",
        action: () => {
          const at = offset ?? capture()?.head ?? 0;
          const line = doc?.text.slice(0, at).split("\n").length! - 1;
          const b = bookmarks.bookmarks.find(
            (mark) => mark.documentId === active && mark.line === line,
          );
          if (b) {
            bookmarkEditing.current = b.id;
            setAddPath(b.label);
            setModal("bookmark-label");
          } else fail("Bookmark this line first.");
        },
      },
      { label: "Previous Bookmark", action: () => bookmarkJump(-1) },
      { label: "Next Bookmark", action: () => bookmarkJump(1) },
      { label: "Show Bookmarks", action: () => setModal("bookmarks") },
      {
        label: "Refactor → Rename…",
        action: () => void beginRename(offset),
        hint: "⇧F6",
        separator: true,
      },
      {
        label: "Find",
        action: () => command("find"),
        hint: "⌘F",
        separator: true,
      },
      { label: "Replace", action: () => command("replace"), hint: "⌘R" },
      { label: "Find in Files…", action: () => search(), hint: "⇧⌘F" },
      { label: "Replace in Files…", action: () => search(true), hint: "⇧⌘R" },
      {
        label: "Copy File Path",
        action: () => void navigator.clipboard.writeText(doc?.path || ""),
      },
      {
        label: "Copy Path and Line",
        action: () =>
          void navigator.clipboard.writeText(
            `${doc?.hostId}:${doc?.path}:${(doc?.text.slice(0, capture()?.head ?? 0).match(/\n/g) || []).length + 1}`,
          ),
      },
      { label: "Reveal in Project", action: () => setTreeVisible(true) },
    ];
    if (doc?.markdownMode)
      items.push({
        label:
          doc.markdownMode === "preview" ? "Edit Source" : "Preview Markdown",
        action: () => {
          doc.markdownMode =
            doc.markdownMode === "preview" ? "source" : "preview";
          refresh();
        },
      });
    if (doc?.readonly)
      for (const item of items)
        if (
          [
            "Undo",
            "Redo",
            "Cut",
            "Paste",
            "Replace",
            "Refactor → Rename…",
          ].includes(item.label)
        )
          item.disabled = "This dependency file is read-only";
    setMenu({
      x: Math.min(x, window.innerWidth - 292),
      y: Math.max(5, Math.min(y, window.innerHeight - 690)),
      items,
    });
  }
  useEffect(() => {
    const custom = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        modal ||
        updates.frozenRef.current ||
        (event.target instanceof Element &&
          event.target.closest('[role="dialog"]'))
      )
        return;
      if (event.key === "Escape") {
        setMenu(null);
        setSwitcher([]);
        switchOrder.current = null;
        return;
      }
      const entry =
        Object.keys(shortcuts).find((id) =>
          matchesBinding(
            event,
            bindingFor(id, settings.shortcuts, settings.keymap),
          ),
        ) ||
        (doc?.docx &&
        !event.shiftKey &&
        !event.altKey &&
        (event.metaKey || event.ctrlKey) &&
        ["f", "r"].includes(event.key.toLowerCase()) &&
        !settings.shortcuts[
          event.key.toLowerCase() === "r" ? "replace" : "find"
        ]
          ? event.key.toLowerCase() === "r"
            ? "replace"
            : "find"
          : undefined);
      if (!entry) return;
      if (
        isEditorTextControl(event.target) &&
        !(
          entry === "save" &&
          event.target instanceof Element &&
          event.target.closest(".islet-editor,.docx-editor,.spreadsheet-editor")
        ) &&
        !(
          ["find", "replace", "findNext", "findPrevious"].includes(entry) &&
          event.target instanceof Element &&
          event.target.closest(".file-search-dock")
        )
      )
        return;
      // Plain Tab and line-edit commands belong only to a focused code editor.
      if (
        [
          "indent",
          "outdent",
          "comment",
          "duplicateLine",
          "deleteLine",
          "moveLineUp",
          "moveLineDown",
          "goToLine",
          "complete",
          "expandSelection",
          "fold",
          "unfold",
          "foldAll",
          "unfoldAll",
        ].includes(entry) &&
        !editor.current?.view?.hasFocus
      )
        return;
      if (
        ["copy", "cut", "paste", "select-all", "undo", "redo"].includes(
          entry,
        ) &&
        !(
          editor.current?.view?.hasFocus ||
          doc?.docx ||
          doc?.spreadsheet ||
          (event.target instanceof Element && event.target.closest(".tree"))
        )
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      command(entry);
    };
    const release = (event: KeyboardEvent) => {
      if (["Control", "Meta", "Alt"].includes(event.key)) {
        switchOrder.current = null;
        setSwitcher([]);
      }
    };
    const dismiss = () => {
      switchOrder.current = null;
      setSwitcher([]);
    };
    window.addEventListener("keydown", custom, true);
    window.addEventListener("keyup", release, true);
    window.addEventListener("blur", dismiss);
    window.addEventListener("pointerdown", dismiss);
    return () => {
      window.removeEventListener("keydown", custom, true);
      window.removeEventListener("keyup", release, true);
      window.removeEventListener("blur", dismiss);
      window.removeEventListener("pointerdown", dismiss);
    };
  }, [
    settings.shortcuts,
    settings.keymap,
    modal,
    doc,
    roots,
    tabs,
    active,
    position,
  ]);
  useEffect(() => {
    if (!menu) return;
    document
      .querySelector<HTMLButtonElement>(".context-menu button:not(:disabled)")
      ?.focus();
    const close = (event: PointerEvent) => {
      if ((event.target as Element)?.closest(".context-menu")) return;
      setMenu(null);
    };
    const key = (e: KeyboardEvent) => {
      const buttons = Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          ".context-menu button:not(:disabled)",
        ),
      );
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        buttons[
          (i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
            buttons.length
        ]?.focus();
      }
      if (e.key === "Escape") {
        setMenu(null);
      }
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", key);
      const origin = menuOrigin.current;
      menuOrigin.current = undefined;
      if (origin && documents.documents.has(origin.documentId)) {
        editor.current?.focus();
        editor.current?.restore(origin);
      }
    };
  }, [menu]);
  useNativeMenu(
    (id) => {
      if (updates.frozenRef.current || modal) return;
      if (id === "checkUpdates") {
        updates.check();
        return;
      }
      if (id === "settings") {
        setModal("settings");
        return;
      }
      if (id === "openFile") {
        void openFile();
        return;
      }
      if (id === "openFolder") {
        void browseAdd();
        return;
      }
      if (id === "addSSH") {
        setModal("add-ssh");
        return;
      }
      if (id === "closeWindow") {
        void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
          getCurrentWindow().close(),
        );
        return;
      }
      command(id);
    },
    Object.fromEntries(
      Object.keys(shortcuts).map((id) => [
        id,
        bindingFor(id, settings.shortcuts, settings.keymap) || "-",
      ]),
    ),
    ready,
    !!doc?.readonly,
  );
  const dirty = [...documents.documents.values()].filter((d) => d.dirty);
  const statuses = [...languages.sessions.values()];
  return (
    <div
      className={`app ${dark ? "dark" : "light"} ${settings.compact ? "compact" : ""}`}
      style={{ "--ui-scale": settings.uiScale } as React.CSSProperties}
    >
      {switcher.length > 0 && (
        <div
          className="tab-switcher"
          role="listbox"
          aria-label="Recent editors"
        >
          {switcher.map((id) => (
            <div key={id} role="option" aria-selected={id === active}>
              <FileIcon path={documents.documents.get(id)?.path || ""} />
              <span>
                {base(documents.documents.get(id)?.path || "")}
                <small>{documents.documents.get(id)?.path}</small>
              </span>
            </div>
          ))}
        </div>
      )}
      <header className="titlebar" data-tauri-drag-region>
        <div className="brand" data-tauri-drag-region>
          Islet
        </div>
        <button
          className="workspace-switch"
          onClick={(e) =>
            setMenu({
              x: e.clientX,
              y: 43,
              items: [
                {
                  label: "New Workspace",
                  action: () => void request("app.newWindow").catch(fail),
                },
                { label: "Open File…", action: () => void openFile() },
                {
                  label: "Add Local Folder…",
                  action: () => void browseAdd(),
                },
                {
                  label: "Add SSH Folder…",
                  action: () => {
                    setAddPath("");
                    setAddHost("");
                    setModal("add-ssh");
                  },
                },
                ...(codespacesSettings.enabled
                  ? [
                      {
                        label: "Add Codespace Folder…",
                        action: () => setModal("codespaces"),
                      },
                    ]
                  : []),
                {
                  label: "Open Workspace…",
                  action: async () => {
                    try {
                      const path = await request<string | null>("dialog.open", {
                        filters: [
                          {
                            name: "Islet Workspace",
                            extensions: ["islet-workspace"],
                          },
                        ],
                        multiple: false,
                      });
                      if (path) await openManifest(path);
                    } catch (e) {
                      fail(e);
                    }
                  },
                },
                {
                  label: "Recover Workspace…",
                  action: () => void showRecoveries(),
                },
                ...recents.slice(0, 10).map((project, index) => ({
                  label:
                    "Open Recent: " +
                    project.name +
                    (project.hostId !== "local" ? " (SSH)" : ""),
                  action: () => void openRecent(project),
                  separator: index === 0,
                })),
                {
                  label: "Save Workspace As…",
                  action: async () => {
                    try {
                      const path: any = await request("dialog.save", {
                        defaultPath: `${workspaceName}.islet-workspace`,
                      });
                      if (path) {
                        await request("workspace.save", {
                          path,
                          value: {
                            schemaVersion: 1,
                            id: workspaceId,
                            name: workspaceName,
                            roots,
                          },
                        });
                        const saved: any = await request("workspace.load", {
                          path,
                        });
                        setWorkspaceIdentity(saved.manifestPath || path);
                        await rememberRecent({
                          kind: "workspace",
                          hostId: "local",
                          path: saved.manifestPath || path,
                          name: workspaceName,
                        });
                      }
                    } catch (e) {
                      fail(e);
                    }
                  },
                },
              ],
            })
          }
        >
          <Folder size={17} />
          {workspaceName}
          <ChevronDown size={13} />
        </button>
        <div className="titlebar-spacer" data-tauri-drag-region />
        {updates.state.version && (
          <button
            className="update-banner"
            title={updateLabel(updates.state)}
            onClick={() => updates.setOpen(true)}
          >
            {["downloading", "verifying"].includes(updates.state.phase)
              ? "Downloading update…"
              : updates.state.phase === "ready"
                ? "Restart to Update…"
                : "Update…"}
          </button>
        )}
        <button
          className="icon"
          title="Find in Files (⇧⌘F)"
          onClick={() => search()}
        >
          <Search size={18} />
        </button>
        <button
          className="icon"
          title="Settings"
          onClick={() => setModal("settings")}
        >
          <Settings size={18} />
        </button>
      </header>
      <main className="workspace">
        <aside className="rail">
          <button
            className={`icon ${treeVisible ? "active" : ""}`}
            aria-label="Toggle Project tree"
            onClick={() => setTreeVisible(!treeVisible)}
          >
            <Folder size={21} />
          </button>
          <button
            className="icon"
            aria-label="Find in Files"
            onClick={() => search()}
          >
            <Search size={20} />
          </button>
          <button
            className="icon"
            aria-label="Bookmarks"
            onClick={() => setModal("bookmarks")}
          >
            <Bookmark size={18} />
          </button>
        </aside>
        {treeVisible && (
          <ProjectSidebar onCollapse={() => setTreeVisible(false)}>
            <div className="project-header">
              <strong>Project</strong>
              <span />
              <button
                className="icon small"
                title="New File…"
                aria-label="New File"
                disabled={!roots.length}
                onClick={() => newEntry()}
              >
                <FilePlus size={15} />
              </button>
              <button
                className="icon small"
                title="New Folder…"
                aria-label="New Folder"
                disabled={!roots.length}
                onClick={() => newEntry(true)}
              >
                <FolderPlus size={15} />
              </button>
              <button
                className="icon small"
                title="Find in Files"
                onClick={() => search()}
              >
                <Search size={14} />
              </button>
              <button
                className="icon small"
                title="Add Project/Folder"
                onClick={() => setModal("add")}
              >
                <Plus size={16} />
              </button>
            </div>
            <ProjectTree
              roots={roots}
              selected={
                treeSelection
                  ? treeSelection.hostId + ":" + treeSelection.path
                  : doc
                    ? doc.hostId + ":" + doc.path
                    : undefined
              }
              folderOpenMode={settings.folderOpenMode}
              dropTarget={nativeDropTarget}
              onCopy={(item) => void copyToClipboard(item).catch(fail)}
              onPaste={(target) => void pasteFiles(target).catch(fail)}
              onDropItems={(sources, target) =>
                void copyFiles(sources, target).catch(fail)
              }
              onSelect={(root, path, folder) =>
                setTreeSelection({ hostId: root.hostId, path, folder })
              }
              onOpen={(h, p) => void open(h, p, false)}
              onReconnect={(hostId) => reconnectHost(hostId, true)}
              onMenu={(e, root, path, folder) =>
                setMenu({
                  x: e.clientX,
                  y: e.clientY,
                  items: [
                    {
                      label: "New File…",
                      action: () =>
                        newEntry(false, {
                          hostId: root.hostId,
                          path: folder
                            ? path
                            : path.slice(0, path.lastIndexOf("/")) || "/",
                        }),
                    },
                    {
                      label: "New Folder…",
                      action: () =>
                        newEntry(true, {
                          hostId: root.hostId,
                          path: folder
                            ? path
                            : path.slice(0, path.lastIndexOf("/")) || "/",
                        }),
                    },
                    ...(folder
                      ? [
                          {
                            label: "Find in Files…",
                            action: () => search(false, { root, path }),
                          },
                          {
                            label: "Replace in Files…",
                            action: () => search(true, { root, path }),
                          },
                          {
                            label: "Refresh",
                            action: () =>
                              setRoots(roots.map((r) => ({ ...r }))),
                          },
                          {
                            label: "Reconnect",
                            action: async () => {
                              await reconnectHost(root.hostId, true).catch(
                                () => {},
                              );
                            },
                            disabled:
                              root.hostId === "local"
                                ? "Local folder"
                                : undefined,
                          },
                          {
                            label: "Remove Root from Workspace",
                            action: () => {
                              if (
                                [...documents.documents.values()].some(
                                  (d) =>
                                    d.hostId === root.hostId &&
                                    (d.path === root.path ||
                                      d.path.startsWith(
                                        root.path.replace(/\/$/, "") + "/",
                                      )) &&
                                    d.dirty,
                                )
                              ) {
                                fail(
                                  "Save or discard unsaved files in this root before removing it.",
                                );
                                return;
                              }
                              const detached = tabs.filter((id) => {
                                const d = documents.documents.get(id);
                                return !(
                                  d?.hostId === root.hostId &&
                                  d.path.startsWith(root.path + "/")
                                );
                              });
                              setTabs(detached);
                              if (!detached.includes(active))
                                setActive(detached[0] || "");
                              setRoots((rs) =>
                                rs.filter((r) => r.id !== root.id),
                              );
                              void request("root.remove", {
                                hostId: root.hostId,
                                id: root.id,
                                path: root.path,
                              });
                            },
                          },
                        ]
                      : [
                          {
                            label: "Open File",
                            action: () => void open(root.hostId, path),
                          },
                          {
                            label: "Copy File Path",
                            action: () =>
                              void navigator.clipboard.writeText(path),
                          },
                          {
                            label: "Rename File…",
                            action: () => {
                              setAddPath(base(path));
                              setModal("rename-file");
                              (window as any).__renameFile = { root, path };
                            },
                          },
                        ]),
                    ...desktopActions(root, path, folder, fail),
                  ],
                })
              }
            />
            {!roots.length && (
              <div className="tree-empty">
                <p>Keep your projects together.</p>
                <button onClick={browseAdd}>
                  <Plus size={14} />
                  Add Folder…
                </button>
                <button onClick={() => setModal("add-ssh")}>
                  Add SSH Folder…
                </button>
              </div>
            )}
          </ProjectSidebar>
        )}
        <section
          className="editor-island"
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes(FILE_ITEM_MIME))
              event.preventDefault();
          }}
          onDrop={(event) => {
            const item = droppedItem(event.dataTransfer);
            if (item) {
              event.preventDefault();
              void (async () => {
                const stat = await request<any>("fs.stat", item);
                if (stat.isDirectory) await addRoot(item.path, item.hostId);
                else await open(item.hostId, item.path, false);
              })().catch(fail);
            }
          }}
        >
          <div className="tabbar">
            <div className="navigation-buttons">
              <button
                className="icon small"
                aria-label="Back"
                disabled={!history.canBack}
                onClick={back}
              >
                <ArrowLeft size={15} />
              </button>
              <button
                className="icon small"
                aria-label="Forward"
                disabled={!history.canForward}
                onClick={forward}
              >
                <ArrowRight size={15} />
              </button>
            </div>
            {locations.length > 0 && (
              <div className="reference-controls">
                <button
                  className="icon small"
                  title="Previous semantic result"
                  disabled={referenceIndex <= 0}
                  onClick={() => referenceJump(-1)}
                >
                  <ArrowLeft size={12} />
                </button>
                <button
                  className="icon small"
                  title="Next semantic result"
                  disabled={referenceIndex >= locations.length - 1}
                  onClick={() => referenceJump(1)}
                >
                  <ArrowRight size={12} />
                </button>
                <button
                  className="icon small"
                  title="Show semantic results"
                  onClick={() => setModal("locations")}
                >
                  <MoreHorizontal size={13} />
                </button>
              </div>
            )}
            <div className="tabs">
              {tabs.map((id) => {
                const d = documents.documents.get(id);
                if (!d) return null;
                return (
                  <div
                    key={id}
                    className={`tab ${active === id ? "active" : ""} ${d.preview ? "preview-tab" : ""}`}
                    draggable
                    title={
                      d.pinned
                        ? "Pinned tab · right-click to unpin"
                        : "Double-click to pin · drag to reorder"
                    }
                    onDragStart={() => (dragTab.current = id)}
                    onDragEnd={() => (dragTab.current = "")}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const dragged = dragTab.current;
                      if (!dragged || dragged === id || !tabs.includes(dragged))
                        return;
                      const next = tabs.filter((t) => t !== dragged);
                      next.splice(next.indexOf(id), 0, dragged);
                      dragTab.current = "";
                      setTabs(next);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenu({
                        x: e.clientX,
                        y: e.clientY,
                        items: [
                          {
                            label: d.pinned ? "Unpin Tab" : "Pin Tab",
                            action: () => {
                              d.pinned = !d.pinned;
                              d.preview = false;
                              refresh();
                            },
                          },
                          { label: "Close Tab", action: () => close(id) },
                        ],
                      });
                    }}
                    onClick={() => {
                      if (doc) doc.location = capture();
                      setActive(id);
                    }}
                    onDoubleClick={() => {
                      d.preview = false;
                      d.pinned = true;
                      refresh();
                    }}
                  >
                    <FileIcon path={d.path} />
                    <span>{base(d.path)}</span>
                    {d.hostId !== "local" && (
                      <small className="host-badge">SSH</small>
                    )}
                    {d.pinned && <Pin size={11} />}
                    <button
                      aria-label={`Close ${base(d.path)}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        close(id);
                      }}
                    >
                      {d.dirty ? (
                        <span className="dirty-dot" />
                      ) : (
                        <X size={12} />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
          {doc ? (
            <>
              <div className="breadcrumbs">
                <span>{ownerOf(roots, doc.hostId, doc.path)?.label}</span>
                <span>›</span>
                <span>{doc.path.split("/").slice(-2).join(" › ")}</span>
                <span className="breadcrumb-host">
                  {doc.hostId !== "local" ? doc.hostId : ""}
                </span>
                <span className="muted file-format">
                  {doc.docx
                    ? "Word document"
                    : doc.spreadsheet
                      ? /\.csv$/i.test(doc.path)
                        ? "CSV"
                        : /\.xlsx$/i.test(doc.path)
                          ? "XLSX"
                          : "XLS"
                      : doc.image
                        ? "Image"
                        : syntaxName(doc.path, doc.text)}
                </span>
                {!doc.image && !doc.spreadsheet && !doc.docx && (
                  <button
                    className="icon"
                    title="Toggle caller panel"
                    aria-label="Toggle caller panel"
                    aria-pressed={settings.callerPanel}
                    onClick={() =>
                      setSettings({
                        ...settings,
                        callerPanel: !settings.callerPanel,
                      })
                    }
                  >
                    <GitBranch size={14} />
                  </button>
                )}
                {doc.spreadsheet && !doc.binary && (
                  <button
                    className="mode-button"
                    onClick={() => {
                      doc.spreadsheetMode =
                        doc.spreadsheetMode === "source" ? "grid" : "source";
                      refresh();
                    }}
                  >
                    {doc.spreadsheetMode === "source"
                      ? "Show Grid"
                      : "Edit CSV Source"}
                  </button>
                )}
                {doc.markdownMode && (
                  <button
                    className="mode-button"
                    onClick={() => {
                      doc.markdownMode =
                        doc.markdownMode === "preview" ? "source" : "preview";
                      refresh();
                    }}
                  >
                    {doc.markdownMode === "preview" ? "Edit Source" : "Preview"}
                  </button>
                )}
              </div>
              {doc.conflict && (
                <div className="conflict-banner">
                  <span>
                    File changed on{" "}
                    {doc.hostId === "local" ? "disk" : doc.hostId}. Review
                    before saving.
                  </span>
                  <button onClick={() => setModal("conflict")}>
                    Review conflict…
                  </button>
                </div>
              )}
              {!doc.binary && doc.text.length > 5 * 1024 * 1024 && (
                <div className="conflict-banner">
                  Large-file mode · automatic language analysis is paused for
                  files over 5 MB.
                </div>
              )}
              {settings.callerPanel &&
                !doc.image &&
                !doc.spreadsheet &&
                !doc.docx &&
                doc.markdownMode !== "preview" && (
                  <CallerPanel
                    document={doc}
                    offset={
                      position?.documentId === doc.id
                        ? position.head
                        : doc.location?.head || 0
                    }
                    languages={languages}
                    roots={roots}
                    onNavigate={(location) => void navigate(location)}
                    onClose={() =>
                      setSettings({ ...settings, callerPanel: false })
                    }
                  />
                )}
              <div className="editor-area">
                {doc.docx ? (
                  <Suspense fallback={<p>Opening document…</p>}>
                    <DocxEditor
                      key={doc.id}
                      ref={docxEditor}
                      document={doc}
                      store={documents}
                      onError={fail}
                    />
                  </Suspense>
                ) : doc.spreadsheet && doc.spreadsheetMode !== "source" ? (
                  <Suspense fallback={<p>Opening spreadsheet…</p>}>
                    <SpreadsheetEditor
                      key={doc.id}
                      ref={spreadsheet}
                      onSave={() => void save()}
                      document={doc}
                      onError={fail}
                      onSaveCopy={() => {
                        void import("./spreadsheets/workbook")
                          .then(({ xlsxCopy }) => {
                            setWorkbookCopy(xlsxCopy(doc.text));
                            setCreateTarget({
                              hostId: doc.hostId,
                              path:
                                doc.path.slice(0, doc.path.lastIndexOf("/")) ||
                                "/",
                            });
                            setModal("copy-workbook");
                          })
                          .catch(fail);
                      }}
                      onChange={(text) => {
                        documents.change(doc.id, text);
                        doc.preview = false;
                      }}
                    />
                  </Suspense>
                ) : doc.image ? (
                  <ImagePreview document={doc} />
                ) : doc.markdownMode === "preview" ? (
                  <Preview
                    document={doc}
                    scroll={sourceScroll[doc.id] ?? -1}
                    onScroll={(value) =>
                      setSourceScroll((s) => ({ ...s, [doc.id]: value }))
                    }
                    fragment={fragment}
                    onFragmentJump={(scrollTop) => {
                      const origin = capture();
                      if (origin)
                        history.push(origin, { ...origin, scrollTop });
                      refresh();
                    }}
                    onOpen={(h, p, hash) =>
                      void open(h, p, false, undefined, true, hash)
                    }
                    onError={fail}
                    onBack={back}
                    onForward={forward}
                    onSource={() => {
                      doc.markdownMode = "source";
                      refresh();
                    }}
                  />
                ) : (
                  <Editor
                    key={doc.id}
                    ref={editor}
                    document={doc}
                    settings={{
                      ...settings,
                      theme: dark ? "dark" : "light",
                      tabSize: 4,
                    }}
                    languages={
                      doc.text.length > 5 * 1024 * 1024 ? undefined : languages
                    }
                    bookmarks={bookmarks}
                    onError={fail}
                    onEdit={(edits) => {
                      for (const e of edits)
                        history.map(doc.id, e.from, e.to, e.inserted);
                    }}
                    onChange={(text) => {
                      documents.change(doc.id, text);
                      doc.preview = false;
                    }}
                    onNavigate={(found) => {
                      if (!found.length) {
                        editor.current?.notice("No reference found");
                        return;
                      }
                      if (found.length === 1) void navigate(found[0]);
                      else {
                        setLocations(found);
                        setModal("locations");
                      }
                    }}
                    onContextMenu={(p) => editorMenu(p.x, p.y, p.offset)}
                    onSelection={(location) => {
                      doc.location = location;
                      setPosition(location);
                    }}
                    onCommand={command}
                  />
                )}
              </div>
            </>
          ) : (
            <div className="welcome">
              <div className="welcome-mark">
                <Folder size={37} />
              </div>
              <h1>
                {roots.length
                  ? windowTitle(roots, workspaceName)
                  : "Welcome to Islet"}
              </h1>
              <p>
                Open a folder, or bring local and SSH projects into one
                workspace.
              </p>
              <div className="welcome-actions">
                <button className="primary" onClick={browseAdd}>
                  <Folder size={16} />
                  Open Folder…
                </button>
                <button
                  onClick={() => void request("app.newWindow").catch(fail)}
                >
                  New Workspace
                </button>
                <button
                  onClick={() => {
                    setAddHost("");
                    setAddPath("");
                    setModal("add-ssh");
                  }}
                >
                  Connect over SSH…
                </button>
              </div>
              <small>⌘⇧F Find in Files · ⌘B Definition · ⇧F6 Rename</small>
              {recents.length > 0 && (
                <section
                  className="recent-projects"
                  aria-label="Recent projects"
                >
                  <h2>Recent projects</h2>
                  {recents.slice(0, 8).map((project) => (
                    <button
                      key={project.id}
                      onClick={() => void openRecent(project)}
                      title={project.path}
                    >
                      <Folder size={17} />
                      <span>
                        <strong>{project.name}</strong>
                        <small>
                          {project.hostId !== "local"
                            ? project.hostId.replace(/^ssh:/, "") + " · "
                            : ""}
                          {project.path}
                        </small>
                      </span>
                      <span className="recent-kind">
                        {project.kind === "workspace"
                          ? "Workspace"
                          : project.hostId === "local"
                            ? "Folder"
                            : "SSH"}
                      </span>
                    </button>
                  ))}
                </section>
              )}
            </div>
          )}
        </section>
      </main>
      <TransferPanel
        onComplete={() =>
          setRoots(languages.roots.map((root) => ({ ...root })))
        }
      />
      {dirty.length > 0 && (
        <div className="changes-bar">
          <span>
            {dirty.length} unsaved {dirty.length === 1 ? "file" : "files"}
          </span>
          <button onClick={() => void saveAll().catch(fail)}>
            <Save size={13} />
            Save Changed Files
          </button>
          <button
            onClick={() => void transactions.undo().catch(fail)}
            disabled={
              !transactions.transactions.some((t) => t.state === "applied")
            }
          >
            Undo Grouped Edit
          </button>
        </div>
      )}
      <footer className="statusbar">
        <button title="Language settings" onClick={() => setModal("settings")}>
          {doc?.path.endsWith(".py")
            ? languages.interpreterFor(doc) ||
              (currentRoot
                ? "Python · auto-detect environment"
                : "Python · external dependency")
            : doc && /\.[jt]sx?$/.test(doc.path)
              ? "TypeScript language service"
              : "Islet"}
          {statuses.some(
            (s) =>
              s.status === "starting" &&
              s.root.id === currentRoot?.id &&
              s.root.hostId === currentRoot?.hostId,
          )
            ? " · indexing…"
            : ""}
        </button>
        <span className="status-spacer" />
        <span>
          {doc?.saveState === "uncertain"
            ? "Save uncertain — reconnect and verify"
            : doc?.dirty
              ? doc.hostId === "local"
                ? "Unsaved"
                : "Unsaved — " +
                  (roots.find((r) => r.hostId === doc.hostId)?.state === "ready"
                    ? "remote"
                    : "disconnected")
              : doc?.hostId !== "local" && doc
                ? "Saved remotely"
                : ""}
        </span>
        <span>
          {doc &&
          (!doc.spreadsheet || doc.spreadsheetMode === "source") &&
          doc.markdownMode !== "preview"
            ? `${doc.text.slice(0, position?.head ?? 0).split("\n").length}:${(position?.head ?? 0) - (doc.text.lastIndexOf("\n", (position?.head ?? 0) - 1) + 1) + 1}`
            : ""}
        </span>
        <span>
          {doc?.docx ? "DOCX" : doc?.binary ? "Workbook" : doc?.newline || "LF"}
        </span>
        <span>{doc?.binary ? "Binary" : "UTF-8"}</span>
        {!doc?.spreadsheet && !doc?.docx && <span>4 spaces</span>}
      </footer>
      {error && (
        <div className="notification" role="alert">
          <span>{error}</span>
          <button
            className="icon small"
            aria-label="Dismiss message"
            onClick={() => setError("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {menu && (
        <div
          role="menu"
          className="context-menu"
          style={{
            left: Math.min(menu.x, window.innerWidth - 290),
            top: Math.min(menu.y, window.innerHeight - 100),
          }}
        >
          {menu.items.map((item, i) => (
            <button
              key={i}
              role="menuitem"
              aria-label={item.label}
              className={item.separator ? "separator" : ""}
              disabled={!!item.disabled}
              title={item.disabled}
              onClick={() => {
                item.action();
                setMenu(null);
              }}
            >
              <span>{item.label}</span>
              <small>
                {(() => {
                  const id = Object.keys(shortcuts).find(
                    (id) => shortcuts[id].label === item.label,
                  );
                  return id
                    ? bindingFor(id, settings.shortcuts, settings.keymap)
                    : item.hint;
                })()}
              </small>
            </button>
          ))}
        </div>
      )}
      {(modal === "new-file" ||
        modal === "new-folder" ||
        modal === "copy-workbook") &&
        createTarget && (
          <NewEntryDialog
            roots={roots}
            initial={createTarget}
            initialName={
              modal === "copy-workbook"
                ? base(doc?.path || "workbook").replace(/\.xlsx?$/i, "") +
                  "-copy.xlsx"
                : ""
            }
            content={modal === "copy-workbook" ? workbookCopy : undefined}
            directory={modal === "new-folder"}
            onClose={() => setModal(null)}
            onCreated={(hostId, path, directory) => {
              setModal(null);
              setRoots(roots.map((root) => ({ ...root })));
              setTreeSelection({
                hostId,
                path: directory
                  ? path.slice(0, path.lastIndexOf("/")) || "/"
                  : path,
                folder: directory,
              });
              if (!directory) void open(hostId, path, false);
            }}
          />
        )}
      {modal === "codespaces" && codespacesSettings.enabled && (
        <CodespacesPanel
          client={codespaces}
          onClose={() => setModal(null)}
          onConnected={reattachProviderRoots}
          onAdd={async (path, hostId) => {
            const root = await addRoot(path, hostId);
            if (!root)
              throw new Error(
                "The folder could not be added. Review the connection or folder permissions.",
              );
            return root;
          }}
        />
      )}
      {(modal === "find-files" || modal === "replace-files") && (
        <SearchDialog
          roots={roots}
          documents={documents}
          transactions={transactions}
          replace={modal === "replace-files"}
          initial={searchScope}
          onClose={() => setModal(null)}
          onOpen={(h, p, at) => void open(h, p, false, at, true)}
          onPreview={(preview) => {
            setTx(preview);
            setModal("transaction");
          }}
        />
      )}
      {modal === "rename" && (
        <Modal title="Rename Symbol" onClose={() => setModal(null)}>
          <div className="dialog-body">
            <p>
              Rename the symbol and its semantic usages in the owning language
              project.
            </p>
            <label>
              New name
              <input
                value={rename}
                onChange={(e) => setRename(e.target.value)}
                onFocus={(e) => e.target.select()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void previewRename();
                }}
              />
            </label>
            <footer>
              <button onClick={() => setModal(null)}>Cancel</button>
              <button className="primary" onClick={previewRename}>
                Preview Changes
              </button>
            </footer>
          </div>
        </Modal>
      )}
      {modal === "transaction" && tx && (
        <Modal
          title={tx.label + " · Preview Changes"}
          onClose={() => setModal(null)}
          wide
        >
          <div className="dialog-body transaction">
            <p>
              {tx.files.length} files ·{" "}
              {tx.files.reduce((n, f) => n + f.edits.length, 0)} occurrences.
              Changes stay unsaved until you save them.
            </p>
            {tx.files.map((file) => (
              <section key={file.documentId}>
                <strong>
                  {file.hostId === "local" ? "Local" : file.hostId} ·{" "}
                  {file.path}
                </strong>
                <div className="diff">
                  <pre className="removed">{file.before}</pre>
                  <pre className="added">{file.after}</pre>
                </div>
              </section>
            ))}
            <footer>
              <button onClick={() => setModal(null)}>Cancel</button>
              <button
                className="primary"
                onClick={() =>
                  void transactions
                    .apply(tx)
                    .then(() => {
                      setTabs((t) => [
                        ...new Set([
                          ...t,
                          ...tx.files.map((f) => f.documentId),
                        ]),
                      ]);
                      setModal(null);
                    })
                    .catch(fail)
                }
              >
                Apply {tx.label}
              </button>
            </footer>
          </div>
        </Modal>
      )}
      {modal === "locations" && (
        <Modal
          title="References and Definitions"
          onClose={() => setModal(null)}
          wide
        >
          <div className="dialog-body location-results">
            <div className="reference-controls">
              <button
                disabled={referenceIndex <= 0}
                onClick={() => referenceJump(-1)}
              >
                Previous Result
              </button>
              <button
                disabled={referenceIndex >= locations.length - 1}
                onClick={() => referenceJump(1)}
              >
                Next Result
              </button>
              <span>{locations.length} semantic results</span>
            </div>
            {locations.map((location, i) => (
              <button
                key={i}
                onClick={() => {
                  setReferenceIndex(i);
                  void navigate(location);
                  setModal(null);
                }}
              >
                <FileIcon path={location.path} />
                <span>
                  {location.hostId === "local" ? "Local" : location.hostId} ·{" "}
                  {location.path}:{location.range.start.line + 1}
                  <small className="reference-snippet">
                    {documents.documents
                      .get(documentId(location.hostId, location.path))
                      ?.text.split("\n")[location.range.start.line] ||
                      "Open to inspect this reference"}
                  </small>
                </span>
              </button>
            ))}
          </div>
        </Modal>
      )}
      {modal === "bookmarks" && (
        <Modal title="Bookmarks" onClose={() => setModal(null)}>
          <div className="dialog-body location-results">
            {!bookmarks.bookmarks.length && (
              <p>Toggle a line bookmark with ⌘F11 or the editor gutter.</p>
            )}
            {bookmarks.bookmarks.map((b) => (
              <div className="bookmark-row" key={b.id}>
                <button
                  disabled={b.unresolved}
                  onClick={() => {
                    void open(b.hostId, b.path, false, b.offset, true);
                    setModal(null);
                  }}
                >
                  <Bookmark size={14} />
                  <span>
                    {b.label || base(b.path)}:{b.line + 1}
                    <small>
                      {b.hostId} ·{" "}
                      {b.unresolved ? "Anchor unresolved" : b.context}
                    </small>
                  </span>
                </button>
                <button
                  className="icon"
                  aria-label="Remove bookmark"
                  onClick={() => {
                    bookmarks.bookmarks = bookmarks.bookmarks.filter(
                      (mark) => mark !== b,
                    );
                    refresh();
                  }}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        </Modal>
      )}
      {modal === "recovery" && (
        <Modal title="Recover Workspace" onClose={() => setModal(null)} wide>
          <div className="dialog-body location-results">
            <p>
              Each record is independent. Recovering opens a new window and
              preserves the original recovery.
            </p>
            {recoveries.length ? (
              recoveries.map((entry) => (
                <button
                  key={entry.key}
                  onClick={async () => {
                    try {
                      const created: any = await request("app.newWindow", {});
                      await request("cli.deliver", {
                        operation: "open",
                        recoveryKey: entry.key,
                        newWindow: false,
                        windowId: created.windowId,
                        requestId: crypto.randomUUID(),
                      });
                      setModal(null);
                    } catch (e) {
                      fail(e);
                    }
                  }}
                >
                  <span>
                    {entry.name} · {entry.dirtyCount || 0} unsaved files
                    <small className="reference-snippet">
                      {entry.workspaceIdentity || "Unnamed workspace"} ·{" "}
                      {new Date(entry.updated).toLocaleString()}
                    </small>
                  </span>
                </button>
              ))
            ) : (
              <p>No earlier recovery records.</p>
            )}
          </div>
        </Modal>
      )}
      {modal === "keymap" && (
        <Modal title="Keyboard shortcuts" wide onClose={() => setModal(null)}>
          <div className="dialog-body">
            <KeymapSettings value={settings} onChange={setSettings} />
            <footer>
              <button type="button" onClick={() => setModal("settings")}>
                Back to Settings
              </button>
            </footer>
          </div>
        </Modal>
      )}
      {modal === "settings" && (
        <Modal title="Settings" onClose={() => setModal(null)}>
          <div className="dialog-body settings">
            <button
              type="button"
              className="settings-keymap-link"
              onClick={() => setModal("keymap")}
            >
              Keyboard shortcuts…
            </button>
            <label>
              Appearance
              <select
                value={settings.theme}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    theme: e.target.value as Preferences["theme"],
                  })
                }
              >
                <option value="dark">Islands Dark</option>
                <option value="light">Islands Light</option>
                <option value="system">Follow System</option>
              </select>
            </label>
            <label>
              Editor font family
              <input
                value={settings.fontFamily}
                onChange={(e) =>
                  setSettings({ ...settings, fontFamily: e.target.value })
                }
              />
            </label>
            <div className="input-row">
              <label>
                Editor font size
                <input
                  type="number"
                  min="9"
                  max="32"
                  value={settings.fontSize}
                  onChange={(e) =>
                    setSettings(
                      validatePreferences({
                        ...settings,
                        fontSize: +e.target.value,
                      }),
                    )
                  }
                />
              </label>
              <label>
                Line spacing
                <input
                  type="number"
                  min="1.1"
                  max="2.5"
                  step="0.05"
                  value={settings.lineHeight}
                  onChange={(e) =>
                    setSettings(
                      validatePreferences({
                        ...settings,
                        lineHeight: +e.target.value,
                      }),
                    )
                  }
                />
              </label>
            </div>
            <label>
              Interface scale
              <select
                value={settings.uiScale}
                onChange={(e) =>
                  setSettings({ ...settings, uiScale: +e.target.value })
                }
              >
                <option value="1">100%</option>
                <option value="1.25">125%</option>
                <option value="1.5">150%</option>
              </select>
            </label>
            <div className="check-row">
              <label>
                <input
                  type="checkbox"
                  checked={settings.ligatures}
                  onChange={(e) =>
                    setSettings({ ...settings, ligatures: e.target.checked })
                  }
                />
                Font ligatures
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={settings.compact}
                  onChange={(e) =>
                    setSettings({ ...settings, compact: e.target.checked })
                  }
                />
                Compact density
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={settings.wrap}
                  onChange={(e) =>
                    setSettings({ ...settings, wrap: e.target.checked })
                  }
                />
                Soft wrap
              </label>
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={settings.callerPanel}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    callerPanel: event.target.checked,
                  })
                }
              />
              Show caller panel above the editor (up to 5 levels)
            </label>
            <label>
              Expand folders with
              <select
                value={settings.folderOpenMode}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    folderOpenMode: e.target
                      .value as Preferences["folderOpenMode"],
                  })
                }
              >
                <option value="double">Double click</option>
                <option value="single">Single click</option>
              </select>
            </label>
            <label>
              Markdown default
              <select
                value={settings.markdownDefault}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    markdownDefault: e.target.value as "preview" | "source",
                  })
                }
              >
                <option value="preview">Preview</option>
                <option value="source">Edit Source</option>
              </select>
            </label>
            <label>
              Python interpreter for current project
              <input
                value={interpreterDraft}
                disabled={!currentRoot}
                placeholder="Auto-detect .venv or venv"
                onChange={(e) => setInterpreterDraft(e.target.value)}
              />
            </label>
            <p className="muted">
              {currentRoot
                ? `${currentRoot.label} · ${currentRoot.hostId} · ${currentRoot.path}`
                : "Open a file in a project to select its interpreter."}
            </p>
            <button
              disabled={!currentRoot}
              onClick={() => {
                if (currentRoot)
                  void addRoot(currentRoot.path, currentRoot.hostId, {
                    ...currentRoot,
                    interpreter: interpreterDraft,
                  });
              }}
            >
              Apply Interpreter and Restart Intelligence
            </button>
            <TerminalSettings
              value={settings.terminal}
              onChange={(terminal) => setSettings({ ...settings, terminal })}
              onError={fail}
            />
            <UpdateSettings
              client={updates.client}
              state={updates.state}
              show={() => updates.setOpen(true)}
            />
            <CodespacesPluginSettings
              client={codespaces}
              onError={fail}
              onManage={() => setModal("codespaces")}
            />

            <p className="muted">
              Inter and JetBrains Mono are bundled. Optional integrations are
              managed in Plugins.
            </p>
            <footer>
              <button
                onClick={() =>
                  void request("app.installCli", {})
                    .then(() => setError("CLI launcher installed."))
                    .catch(fail)
                }
              >
                Install islet CLI…
              </button>
              <button className="primary" onClick={() => setModal(null)}>
                Done
              </button>
            </footer>
          </div>
        </Modal>
      )}
      {(modal === "add" || modal === "add-ssh") && (
        <AddFolderDialog
          remote={modal === "add-ssh"}
          onClose={() => setModal(null)}
          onAdd={addRoot}
          onError={fail}
        />
      )}
      {modal === "close-window" && (
        <Modal title="Close Workspace" onClose={() => setModal(null)}>
          <div className="dialog-body">
            <p>
              This workspace has unsaved files. Save them or retain recovery
              buffers before closing.
            </p>
            <footer>
              <button onClick={() => setModal(null)}>Cancel</button>
              <button onClick={() => void closeNative(false)}>
                Keep Recovery and Close
              </button>
              <button
                className="primary"
                onClick={() => void closeNative(true)}
              >
                Save All and Close
              </button>
            </footer>
          </div>
        </Modal>
      )}
      {modal === "close" && pendingClose && (
        <Modal title="Unsaved Changes" onClose={() => setModal(null)}>
          <div className="dialog-body">
            <p>
              Save changes to {base(documents.require(pendingClose).path)}{" "}
              before closing?
            </p>
            <footer>
              <button onClick={() => setModal(null)}>Cancel</button>
              <button onClick={() => close(pendingClose, true)}>
                Discard and Close
              </button>
              <button
                className="primary"
                onClick={() =>
                  void documents
                    .save(pendingClose)
                    .then(() => close(pendingClose, true))
                    .catch(fail)
                }
              >
                Save and Close
              </button>
            </footer>
          </div>
        </Modal>
      )}
      {modal === "conflict" && doc?.conflict && (
        <Modal
          title="Resolve File Conflict"
          onClose={() => setModal(null)}
          wide
        >
          <div className="dialog-body">
            <p>
              Your buffer and the file on {doc.hostId} differ. Review both
              before choosing.
            </p>
            {doc.binary ? (
              <p>
                This {doc.docx ? "document" : "workbook"} changed on disk.
                Reload to inspect the disk version, or keep your edited buffer
                for the next save. The original bytes are backed up before each
                save.
              </p>
            ) : (
              <div className="diff">
                <pre>{doc.text}</pre>
                <pre>{doc.conflict.text}</pre>
              </div>
            )}
            <footer>
              <button onClick={() => setModal(null)}>Keep Reviewing</button>
              <button
                onClick={() => {
                  documents.resolveConflict(doc.id, "reload");
                  setModal(null);
                }}
              >
                Reload Disk Version
              </button>
              <button
                className="primary"
                onClick={() => {
                  documents.resolveConflict(doc.id, "keep");
                  setModal(null);
                }}
              >
                Keep My Buffer for Next Save
              </button>
            </footer>
          </div>
        </Modal>
      )}
      {modal === "bookmark-label" && doc && (
        <Modal title="Bookmark Label" onClose={() => setModal(null)}>
          <div className="dialog-body">
            <label>
              Label
              <input
                value={addPath}
                onChange={(e) => setAddPath(e.target.value)}
              />
            </label>
            <footer>
              <button
                className="primary"
                onClick={() => {
                  const mark = bookmarks.bookmarks.find(
                    (mark) => mark.id === bookmarkEditing.current,
                  );
                  if (mark) {
                    mark.label = addPath;
                    refresh();
                  }
                  setModal(null);
                }}
              >
                Save Label
              </button>
            </footer>
          </div>
        </Modal>
      )}
      {modal === "rename-file" && (
        <Modal title="Rename File" onClose={() => setModal(null)}>
          <div className="dialog-body">
            <label>
              File name
              <input
                value={addPath}
                onChange={(e) => setAddPath(e.target.value)}
              />
            </label>
            <footer>
              <button onClick={() => setModal(null)}>Cancel</button>
              <button
                className="primary"
                onClick={async () => {
                  const { root, path } = (window as any).__renameFile;
                  try {
                    if (!addPath || addPath.includes("/"))
                      throw Error("Enter a file name without slashes.");
                    const id = documentId(root.hostId, path);
                    if (documents.documents.get(id)?.dirty)
                      throw Error("Save this file before renaming it.");
                    if (
                      isDocx(path) !== isDocx(addPath) ||
                      isSpreadsheet(path) !== isSpreadsheet(addPath) ||
                      (isSpreadsheet(path) &&
                        path.split(".").pop()?.toLowerCase() !==
                          addPath.split(".").pop()?.toLowerCase())
                    )
                      throw Error(
                        "Keep the Office file extension when renaming. Renaming does not convert file formats.",
                      );
                    const newPath =
                      path.slice(0, path.lastIndexOf("/") + 1) + addPath;
                    await request("fs.rename", {
                      hostId: root.hostId,
                      path,
                      newPath,
                    });
                    const newId = documentId(root.hostId, newPath);
                    const existing = documents.documents.get(id);
                    if (existing) {
                      migrateEditorState(id, newId);
                      documents.documents.delete(id);
                      existing.id = newId;
                      existing.path = newPath;
                      if (existing.location) {
                        existing.location.documentId = newId;
                        existing.location.path = newPath;
                      }
                      documents.documents.set(newId, existing);
                      setTabs((ts) => ts.map((t) => (t === id ? newId : t)));
                      if (active === id) setActive(newId);
                    }
                    for (const mark of bookmarks.bookmarks)
                      if (mark.documentId === id) {
                        mark.documentId = newId;
                        mark.path = newPath;
                      }
                    for (const entry of history.entries)
                      if (entry.documentId === id) {
                        entry.documentId = newId;
                        entry.path = newPath;
                      }
                    await languages.restart(root.id);
                    setRoots(roots.map((r) => ({ ...r })));
                    refresh();
                    setModal(null);
                  } catch (e) {
                    fail(e);
                  }
                }}
              >
                Rename File
              </button>
            </footer>
          </div>
        </Modal>
      )}
      {auth && (
        <Modal
          title={`SSH · ${auth.hostId}`}
          onClose={() => {
            void request("remote.respond", {
              promptId: auth.promptId,
              response: "",
            });
            setAuth(null);
          }}
        >
          <div className="dialog-body">
            <p>{auth.prompt}</p>
            <label>
              {auth.secret ? "Password / passphrase" : "Response"}
              <input
                type={auth.secret ? "password" : "text"}
                value={authResponse}
                onChange={(e) => setAuthResponse(e.target.value)}
                autoComplete="off"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void request("remote.respond", {
                      promptId: auth.promptId,
                      response: authResponse,
                    });
                    setAuth(null);
                    setAuthResponse("");
                  }
                }}
              />
            </label>
            <footer>
              <button
                onClick={() => {
                  void request("remote.respond", {
                    promptId: auth.promptId,
                    response: "",
                  });
                  setAuth(null);
                  setAuthResponse("");
                }}
              >
                Cancel
              </button>
              <button
                className="primary"
                onClick={() => {
                  void request("remote.respond", {
                    promptId: auth.promptId,
                    response: authResponse,
                  });
                  setAuth(null);
                  setAuthResponse("");
                }}
              >
                Continue
              </button>
            </footer>
          </div>
        </Modal>
      )}
      {updates.open && (
        <UpdateDialog
          client={updates.client}
          state={updates.state}
          onClose={() => updates.setOpen(false)}
        />
      )}
      {updates.frozen && (
        <div className="update-freeze" role="alert">
          {updateLabel(updates.state)}
        </div>
      )}
    </div>
  );
}
