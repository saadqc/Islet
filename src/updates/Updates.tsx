import { useEffect, useRef, useState } from "react";
import {
  onHostEvent,
  request,
  setRestartPending,
  waitForRequests,
} from "../core/bridge";
import { Modal } from "../shell/Modal";
import { UpdateClient, updateLabel, type UpdateState } from "./client";
import "./updates.css";

export function useUpdates({
  ready,
  unsafe,
  persist,
}: {
  ready: boolean;
  unsafe: () => boolean;
  persist: () => Promise<unknown>;
}) {
  const [client] = useState(() => new UpdateClient());
  const [state, setState] = useState(client.state);
  const [open, setOpen] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const frozenRef = useRef(false),
    callbacks = useRef({ ready, unsafe, persist });
  callbacks.current = { ready, unsafe, persist };
  const dismissed = useRef(new Set<string>());
  useEffect(() => {
    const off = client.subscribe(() => setState(client.state));
    let stopped = false,
      unlisten: (() => void) | undefined;
    void client.start().then((cleanup) => {
      if (stopped) cleanup();
      else unlisten = cleanup;
    });
    return () => {
      stopped = true;
      off();
      unlisten?.();
    };
  }, [client]);
  useEffect(() => {
    let stopped = false;
    const off: (() => void)[] = [];
    const setFreeze = (value: boolean) => {
      frozenRef.current = value;
      setRestartPending(value);
      setFrozen(value);
    };
    const listen = (name: string, fn: (event: any) => void) =>
      void onHostEvent(name, fn).then((cleanup) => {
        if (stopped) cleanup();
        else off.push(cleanup);
      });
    listen("updater-prepare", (event) => {
      void (async () => {
        let clean = false;
        try {
          setFreeze(true);
          await waitForRequests();
          if (callbacks.current.ready && !callbacks.current.unsafe()) {
            await callbacks.current.persist();
            clean = !callbacks.current.unsafe();
          }
        } catch {
          clean = false;
        }
        try {
          await request("updater.acknowledge", {
            requestId: event.requestId,
            clean,
          });
        } catch {
          setFreeze(false);
        }
      })();
    });
    listen("updater-abort", () => setFreeze(false));
    const block = (event: Event) => {
      if (!frozenRef.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    ["keydown", "pointerdown", "beforeinput", "paste", "drop"].forEach((type) =>
      window.addEventListener(type, block, true),
    );
    return () => {
      stopped = true;
      off.forEach((fn) => fn());
      setRestartPending(false);
      ["keydown", "pointerdown", "beforeinput", "paste", "drop"].forEach(
        (type) => window.removeEventListener(type, block, true),
      );
    };
  }, []);
  useEffect(() => {
    if (
      state.phase !== "ready" ||
      !state.version ||
      state.error ||
      dismissed.current.has(state.version)
    )
      return;
    const prompt = () => {
      if (document.hasFocus()) {
        dismissed.current.add(state.version!);
        setOpen(true);
      }
    };
    prompt();
    window.addEventListener("focus", prompt);
    return () => window.removeEventListener("focus", prompt);
  }, [state.phase, state.version, state.error]);
  return {
    client,
    state,
    open,
    setOpen,
    frozen,
    frozenRef,
    check: () => {
      setOpen(true);
      void client.action("check");
    },
  };
}

export function UpdateSettings({
  client,
  state,
  show,
}: {
  client: UpdateClient;
  state: UpdateState;
  show: () => void;
}) {
  const busy = [
    "checking",
    "downloading",
    "verifying",
    "preparing",
    "installing",
  ].includes(state.phase);
  return (
    <section className="update-settings" aria-label="Updates">
      <h3>Updates</h3>
      <p className="muted" role="status">
        {updateLabel(state)}
      </p>
      <label className="check">
        <input
          type="checkbox"
          checked={state.preferences.autoCheck}
          disabled={!state.supported}
          onChange={(event) =>
            void client.configure({
              ...state.preferences,
              autoCheck: event.target.checked,
            })
          }
        />
        Automatically check for updates
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={state.preferences.autoDownload}
          disabled={!state.supported}
          onChange={(event) =>
            void client.configure({
              ...state.preferences,
              autoDownload: event.target.checked,
            })
          }
        />
        Automatically download updates
      </label>
      <p className="muted">
        Updates are verified before installation. Islet always asks before
        restarting.
      </p>
      <div className="update-actions">
        <button
          disabled={!state.supported || busy}
          onClick={() => void client.action("check")}
        >
          Check for Updates
        </button>
        {state.version && (
          <button onClick={show}>
            {state.phase === "ready" ? "Restart to Update…" : "Update…"}
          </button>
        )}
      </div>
    </section>
  );
}

export function UpdateDialog({
  client,
  state,
  onClose,
}: {
  client: UpdateClient;
  state: UpdateState;
  onClose: () => void;
}) {
  const downloading = ["downloading", "verifying"].includes(state.phase);
  const installing = ["preparing", "installing"].includes(state.phase);
  return (
    <Modal title="Update Islet" onClose={installing ? () => {} : onClose}>
      <div className="dialog-body update-dialog">
        <p role="status">{updateLabel(state)}</p>
        {downloading && (
          <progress
            aria-label="Update download"
            max={state.total || undefined}
            value={state.total ? state.downloaded : undefined}
          />
        )}
        {state.notes && (
          <details>
            <summary>Release notes</summary>
            <pre>{state.notes}</pre>
          </details>
        )}
        {state.phase === "ready" && (
          <p>
            Restart to install the verified update. Save unsaved files in every
            workspace first; workspace state will be restored.
          </p>
        )}
        <div className="update-actions">
          {state.phase === "ready" ? (
            <button
              className="primary"
              onClick={() => void client.action("install")}
            >
              Restart and Update
            </button>
          ) : state.version &&
            !downloading &&
            !installing &&
            state.phase !== "checking" ? (
            <button
              className="primary"
              onClick={() => void client.action("download")}
            >
              Update
            </button>
          ) : (
            !downloading &&
            !installing && (
              <button
                disabled={!state.supported || state.phase === "checking"}
                onClick={() => void client.action("check")}
              >
                Check for Updates
              </button>
            )
          )}
          <button disabled={installing} onClick={onClose}>
            {state.phase === "ready" ? "Later" : "Close"}
          </button>
          {state.error && (
            <button
              onClick={() =>
                void request("app.openExternal", {
                  url: "https://github.com/saadqc/Islet/releases",
                })
              }
            >
              Download from Releases
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
