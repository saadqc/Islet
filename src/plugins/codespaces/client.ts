import { request, type Request } from "../../core/bridge";

export interface ForwardMapping {
  forwardId?: string;
  id: string;
  hostId?: string;
  mode: "simple" | "ssh";
  localPort: number;
  remoteHost?: string;
  remotePort: number;
  expiresAt?: number;
  expiresInMinutes?: number;
  state?: string;
  saved?: boolean;
  save?: boolean;
  enabled?: boolean;
}
export interface CodespacesSettings {
  enabled: boolean;
  ghPath: string;
  savedForwards: ForwardMapping[];
}
export interface Codespace {
  id: string;
  hostId: string;
  displayName: string;
  repository: string;
  state: string;
  editorState: string;
  git?: unknown;
}
export interface CodespacesStatus {
  enabled: boolean;
  available: boolean;
  authenticated: boolean | null;
  ghPath: string;
  loginGuidance: string | null;
}
export interface SafetySnapshot {
  id: string;
  hostId: string;
  token: string;
  expiresAt: number;
  clean: boolean;
  git: {
    state: string;
    hasUncommittedChanges: boolean | null;
    hasUnpushedChanges: boolean | null;
  };
  buffers: {
    state: string;
    dirtyCount: number;
    pendingTransactions: number;
    missingWindows: string[];
  };
}
export interface Discovery {
  hostId: string;
  folders: { path: string; name: string }[];
  defaultFolder: string | null;
  probe?: {
    os?: string;
    arch?: string;
    cachePath?: string;
    helperInstalled?: boolean;
    version?: string;
  };
}

export class CodespacesClient {
  settings: CodespacesSettings = {
    enabled: false,
    ghPath: "",
    savedForwards: [],
  };
  private listeners = new Set<() => void>();
  private generation = 0;
  constructor(private transport: Request = request) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  accept(settings: CodespacesSettings) {
    if (
      this.settings.enabled !== settings.enabled ||
      this.settings.ghPath !== settings.ghPath
    )
      this.generation++;
    this.settings = {
      enabled: settings.enabled === true,
      ghPath: typeof settings.ghPath === "string" ? settings.ghPath : "",
      savedForwards: Array.isArray(settings.savedForwards)
        ? settings.savedForwards
        : [],
    };
    this.listeners.forEach((listener) => listener());
    return this.settings;
  }
  async load() {
    return this.accept(
      await this.transport<CodespacesSettings>("codespaces.settings", {}),
    );
  }
  async configure(
    settings: Partial<Pick<CodespacesSettings, "enabled" | "ghPath">>,
  ) {
    // Close the renderer gate immediately, including while cleanup is awaiting IPC.
    if (settings.enabled === false)
      this.accept({ ...this.settings, enabled: false });
    return this.accept(
      await this.transport<CodespacesSettings>(
        "codespaces.configure",
        settings,
      ),
    );
  }
  private async invoke<T>(operation: string, payload: any = {}): Promise<T> {
    if (!this.settings.enabled)
      throw new Error("Enable GitHub Codespaces in Settings → Plugins first.");
    const generation = this.generation;
    const result = await this.transport<T>("codespaces." + operation, payload);
    if (!this.settings.enabled || generation !== this.generation)
      throw new Error("Codespaces settings changed; refresh to continue.");
    return result;
  }
  status() {
    return this.invoke<CodespacesStatus>("status", { refreshAuth: true });
  }
  list() {
    return this.invoke<{ items: Codespace[]; complete: boolean }>("list");
  }
  create(options: {
    repo: string;
    branch?: string;
    machine?: string;
    displayName?: string;
  }) {
    return this.invoke("create", { ...options, confirmCreate: true });
  }
  start(id: string) {
    return this.invoke("start", { id, confirmId: id });
  }
  safety(id: string) {
    return this.invoke<SafetySnapshot>("safety", { id });
  }
  lifecycle(
    action: "stop" | "delete",
    id: string,
    confirmId: string,
    safetyToken: string,
  ) {
    if (confirmId !== id)
      throw new Error("Enter the exact Codespace ID to confirm.");
    return this.invoke(action, { id, confirmId, safetyToken });
  }
  discover(id: string) {
    return this.invoke<Discovery>("discover", { id });
  }
  connect(
    id: string,
    options: { approve?: boolean; helperPath?: string } = {},
  ) {
    return this.invoke<{
      hostId: string;
      state: string;
      probe?: Discovery["probe"];
    }>("connect", { id, ...options });
  }
  sshCommand(id: string) {
    return this.invoke<{ command: string }>("sshCommand", { id });
  }
  forwards() {
    return this.invoke<{
      items: ForwardMapping[];
      savedForwards: ForwardMapping[];
    }>("forward.list");
  }
  forward(options: ForwardMapping) {
    return this.invoke("forward.start", options);
  }
  stopForward(forwardId: string) {
    return this.invoke("forward.stop", { forwardId });
  }
  restoreForwards() {
    return this.invoke<{
      items: {
        ok: boolean;
        id?: string;
        localPort?: number;
        error?: { message: string };
      }[];
    }>("forward.restore", { confirm: true });
  }
  forgetForward(id: string, localPort: number) {
    return this.invoke("forward.forget", { id, localPort });
  }
  async configureForward(id: string, localPort: number, enabled: boolean) {
    return this.accept(
      await this.invoke<CodespacesSettings>("forward.configure", {
        id,
        localPort,
        enabled,
      }),
    );
  }
}
