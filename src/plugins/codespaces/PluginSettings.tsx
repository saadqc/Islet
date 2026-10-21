import "./styles.css";
import { useEffect, useState } from "react";
import { CodespacesClient } from "./client";

export function CodespacesPluginSettings({
  client,
  onManage,
  onError,
}: {
  client: CodespacesClient;
  onManage: () => void;
  onError: (error: unknown) => void;
}) {
  const [settings, setSettings] = useState(client.settings),
    [ghPath, setGhPath] = useState(client.settings.ghPath),
    [busy, setBusy] = useState(false);
  useEffect(
    () =>
      client.subscribe(() => {
        setSettings(client.settings);
        setGhPath(client.settings.ghPath);
      }),
    [client],
  );
  async function configure(value: { enabled?: boolean; ghPath?: string }) {
    setBusy(true);
    try {
      await client.configure(value);
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="plugin-card"
      aria-labelledby="codespaces-plugin-heading"
    >
      <h3 id="codespaces-plugin-heading">Plugins</h3>
      <label className="check-label">
        <input
          type="checkbox"
          checked={settings.enabled}
          disabled={busy}
          onChange={(event) =>
            void configure({ enabled: event.target.checked })
          }
        />
        GitHub Codespaces
      </label>
      <p className="muted">
        Bundled and off by default. Disabling closes Islet’s connections and
        local forwards. It leaves your Codespaces running.
      </p>
      <label>
        GitHub CLI executable (optional)
        <input
          value={ghPath}
          placeholder="Automatically find gh"
          onChange={(event) => setGhPath(event.target.value)}
        />
      </label>
      <div className="input-row">
        <button
          disabled={busy || ghPath === settings.ghPath}
          onClick={() => void configure({ ghPath })}
        >
          Save CLI Path
        </button>
        <button disabled={busy || !settings.enabled} onClick={onManage}>
          Manage Codespaces…
        </button>
      </div>
    </section>
  );
}
