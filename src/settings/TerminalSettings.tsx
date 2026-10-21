import { useEffect, useState } from "react";
import { request } from "../core/bridge";
import type { TerminalPreference } from "./preferences";
import "../shell/projectSidebar.css";

interface Terminal {
  id: string;
  name: string;
  path: string;
  available: boolean;
}
export function TerminalSettings({
  value,
  onChange,
  onError,
}: {
  value: TerminalPreference;
  onChange: (value: TerminalPreference) => void;
  onError: (error: string) => void;
}) {
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [draft, setDraft] = useState(value.path);
  const [status, setStatus] = useState("");
  useEffect(() => {
    setDraft(value.path);
  }, [value.path, value.id]);
  const detect = async () => {
    try {
      setTerminals(await request("desktop.terminals"));
      setStatus("");
    } catch (error) {
      setStatus(String(error));
    }
  };
  useEffect(() => {
    void detect();
  }, []);
  const selected = terminals.find((item) => item.id === value.id);
  return (
    <section className="terminal-settings">
      <h3>External terminal</h3>
      <label>
        Default terminal
        <select
          aria-label="Default terminal"
          value={value.id}
          onChange={(e) => onChange({ id: e.target.value, path: "" })}
        >
          <option value="system">System terminal</option>
          {terminals
            .filter((item) => item.id !== "system")
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.available ? "" : " (not detected)"}
              </option>
            ))}
          {!terminals.some((item) => item.id === "marinashell") && (
            <option value="marinashell">MarinaShell</option>
          )}
          <option value="custom">Custom terminal…</option>
        </select>
      </label>
      {value.id !== "system" && (
        <>
          <label>
            Application or executable path
            <div className="terminal-path">
              <input
                aria-label="Terminal application path"
                value={draft}
                placeholder={selected?.path || "Choose an installed terminal"}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => {
                  if (draft !== value.path)
                    onChange({ ...value, path: draft.trim() });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter")
                    onChange({ ...value, path: draft.trim() });
                }}
              />
              <button
                onClick={async () => {
                  try {
                    const path = await request<string | null>("dialog.open", {
                      title: "Choose terminal application",
                      multiple: false,
                    });
                    if (path) onChange({ ...value, path });
                  } catch (error) {
                    onError(String(error));
                  }
                }}
              >
                Browse…
              </button>
            </div>
          </label>
          {value.id !== "custom" && (
            <button
              onClick={() => {
                onChange({ ...value, path: "" });
                void detect();
              }}
            >
              Use detected path
            </button>
          )}
        </>
      )}
      <p className="hint">
        Opens a new terminal at the selected local folder. MarinaShell requires
        version 0.2.24 or newer. For remote folders, use Copy SSH Command from
        the folder menu.
      </p>
      {status && (
        <p role="status" className="hint">
          {status}
        </p>
      )}
    </section>
  );
}
