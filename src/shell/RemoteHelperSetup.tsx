import { useEffect, useState } from "react";
import { request } from "../core/bridge";
import { Modal } from "./Modal";

interface Probe {
  hostId: string;
  target: string;
  version: string;
  cachePath: string;
  os: string;
  arch: string;
  helperInstalled: boolean;
  writable: boolean;
}
export function RemoteHelperSetup({
  hostId,
  onClose,
  onInstalled,
}: {
  hostId: string;
  onClose: () => void;
  onInstalled: () => Promise<void>;
}) {
  const [probe, setProbe] = useState<Probe>();
  const [busy, setBusy] = useState(false),
    [checking, setChecking] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    void request<Probe>("remote.probe", { hostId, interactive: true })
      .then((info) => {
        if (!disposed) setProbe(info);
      })
      .catch((error) => {
        if (!disposed) setError(error.message || String(error));
      })
      .finally(() => {
        if (!disposed) setChecking(false);
      });
    return () => {
      disposed = true;
    };
  }, [hostId]);
  const supported =
    probe &&
    (probe.helperInstalled ||
      (probe.os === "Linux" &&
        ["x86_64", "aarch64", "arm64"].includes(probe.arch) &&
        probe.writable));
  async function install() {
    if (!probe || !supported) return;
    setBusy(true);
    setError("");
    try {
      if (!probe.helperInstalled)
        await request("remote.setup", {
          hostId,
          approve: true,
          interactive: true,
        });
      await onInstalled();
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Set Up SSH Helper" onClose={onClose}>
      <div className="dialog-body">
        <p>
          Islet needs a matching helper on{" "}
          <strong>{probe?.target || hostId.replace(/^ssh:/, "")}</strong> to
          open its SSH folders.
        </p>
        {checking && <p role="status">Checking the remote helper…</p>}
        {probe && (
          <>
            <p>
              {probe.helperInstalled
                ? "The matching helper is installed. You can reconnect now."
                : `Install the helper for Islet ${probe.version} from this app’s bundled package.`}
            </p>
            <p className="helper-location">
              <strong>Remote location</strong>
              <br />
              <code>
                {probe.cachePath.replace(/\/$/, "")}/{probe.version}
              </code>
            </p>
            <p>
              The helper includes Node and the language services. It runs
              through SSH without a permanent service or root access. Your
              project files and local recovery buffers are retained.
            </p>
            {!supported && (
              <p className="inline-error">
                Setup requires a writable home directory on Linux x86_64 or
                arm64.
              </p>
            )}
          </>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button onClick={onClose}>{busy ? "Close" : "Cancel"}</button>
          <button
            className="primary"
            disabled={checking || busy || !supported}
            onClick={() => void install()}
          >
            {busy
              ? "Installing…"
              : probe?.helperInstalled
                ? "Reconnect"
                : "Install and Reconnect"}
          </button>
        </footer>
      </div>
    </Modal>
  );
}
