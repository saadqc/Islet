import { onHostEvent, request, type Request } from "../core/bridge";

export type UpdatePhase =
  | "idle"
  | "unsupported"
  | "checking"
  | "current"
  | "available"
  | "downloading"
  | "verifying"
  | "ready"
  | "preparing"
  | "installing"
  | "error";
export interface UpdateState {
  phase: UpdatePhase;
  currentVersion: string;
  version?: string;
  notes?: string;
  downloaded: number;
  total?: number;
  error?: string;
  supported: boolean;
  preferences: { autoCheck: boolean; autoDownload: boolean };
  releasesUrl: string;
}
export const initialUpdateState: UpdateState = {
  phase: "unsupported",
  currentVersion: "",
  downloaded: 0,
  supported: false,
  preferences: { autoCheck: true, autoDownload: true },
  releasesUrl: "https://github.com/saadqc/Islet/releases",
};
export class UpdateClient {
  state: UpdateState = initialUpdateState;
  private listeners = new Set<() => void>();
  constructor(private transport: Request = request) {}
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  accept = (state: UpdateState) => {
    if (
      !state ||
      typeof state !== "object" ||
      typeof state.phase !== "string" ||
      typeof state.supported !== "boolean" ||
      !state.preferences
    )
      return;
    this.state = state;
    this.listeners.forEach((fn) => fn());
  };
  async start() {
    const off = await onHostEvent("updater-status", (state) =>
      this.accept(state),
    );
    try {
      this.accept(await this.transport("updater.status"));
    } catch {
      /* Browser development has no updater. */
    }
    return off;
  }
  async action(operation: "check" | "download" | "install") {
    try {
      this.accept(await this.transport(`updater.${operation}`));
    } catch (error) {
      this.accept({
        ...this.state,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  async configure(preferences: UpdateState["preferences"]) {
    const previous = this.state.preferences;
    this.accept({ ...this.state, preferences, error: undefined });
    try {
      this.accept(await this.transport("updater.configure", preferences));
    } catch (error) {
      this.accept({
        ...this.state,
        preferences: previous,
        error: String(error),
      });
    }
  }
}
export function updateLabel(state: UpdateState) {
  if (state.error) return state.error;
  switch (state.phase) {
    case "unsupported":
      return "Updates are available in the packaged Apple silicon app.";
    case "checking":
      return "Checking for updates…";
    case "current":
      return "You’re up to date.";
    case "available":
      return `Islet ${state.version} is available.`;
    case "downloading":
      return state.total
        ? `Downloading update… ${Math.min(100, Math.round((100 * state.downloaded) / state.total))}%`
        : "Downloading update…";
    case "verifying":
      return "Verifying update signature…";
    case "ready":
      return `Islet ${state.version} is downloaded and verified.`;
    case "preparing":
      return "Saving workspace state before restarting…";
    case "installing":
      return "Installing update…";
    case "error":
      return "Could not check for updates. Try again.";
    default:
      return `Islet ${state.currentVersion}`;
  }
}
export function restartBlocked(
  documents: Iterable<{
    dirty: boolean;
    pendingSaveText?: string;
    saveState?: string;
  }>,
  pendingTransaction: boolean,
) {
  return (
    pendingTransaction ||
    [...documents].some(
      (doc) =>
        doc.dirty ||
        doc.pendingSaveText !== undefined ||
        ["pending", "uncertain", "conflicted"].includes(doc.saveState || ""),
    )
  );
}
