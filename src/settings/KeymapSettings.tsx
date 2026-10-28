import { useState } from "react";
import { bindingFor, eventBinding, shortcuts, type Keymap } from "./shortcuts";
import type { Preferences } from "./preferences";
export function KeymapSettings({
  value,
  onChange,
}: {
  value: Preferences;
  onChange: (value: Preferences) => void;
}) {
  const [filter, setFilter] = useState(""),
    [recording, setRecording] = useState(""),
    [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const clearDraft = (id: string) =>
    setDrafts((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  function change(id: string, binding: string) {
    const valid =
      binding === "-" ||
      !binding ||
      binding
        .split(";")
        .every((s) =>
          /^(?:(?:Mod|Meta|Cmd|Ctrl|Control|Alt|Shift)-)*(?:[\w]+|[^\s;-])$/.test(
            s.trim(),
          ),
        );
    if (!valid) {
      setError(
        "Use a key such as Ctrl-Tab or Mod-Shift-f. Separate alternatives with ;",
      );
      return;
    }
    const overlap = Object.keys(shortcuts).find(
      (other) =>
        other !== id &&
        binding &&
        binding !== "-" &&
        binding.split(";").some((s) =>
          bindingFor(other, value.shortcuts, value.keymap)
            .split(";")
            .some((b) => b.trim().toLowerCase() === s.trim().toLowerCase()),
        ),
    );
    if (valid)
      setError(
        overlap
          ? `Also assigned to ${shortcuts[overlap].label}. Change that mapping to avoid conflicts.`
          : "",
      );
    onChange({ ...value, shortcuts: { ...value.shortcuts, [id]: binding } });
  }
  return (
    <section className="keymap-settings" aria-label="Keyboard shortcuts">
      <div className="keymap-heading">
        <strong>Default keymap</strong>
        <select
          aria-label="Default keymap"
          value={value.keymap}
          onChange={(e) =>
            onChange({ ...value, keymap: e.target.value as Keymap })
          }
        >
          <option value="auto">JetBrains style · System</option>
          <option value="mac">JetBrains style · macOS</option>
          <option value="windows">JetBrains style · Windows / Linux</option>
        </select>
      </div>
      <input
        aria-label="Filter shortcuts"
        placeholder="Search actions or shortcuts…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <p className="muted">
        Mod means Command on Mac, Control elsewhere. Leave blank for the
        default; enter - to disable. Alt+Tab and other system shortcuts may be
        intercepted by your OS.
      </p>
      {error && (
        <p role="status" className="keymap-conflict">
          {error}
        </p>
      )}
      <div className="keymap-list">
        {Object.entries(shortcuts)
          .filter(([id, s]) =>
            (
              s.label +
              " " +
              s.group +
              " " +
              bindingFor(id, value.shortcuts, value.keymap)
            )
              .toLowerCase()
              .includes(filter.toLowerCase()),
          )
          .map(([id, s]) => (
            <label key={id}>
              <span>
                {s.label}
                <small>{s.group}</small>
              </span>
              <input
                aria-label={`${s.label} shortcut`}
                data-recording={recording === id}
                value={drafts[id] ?? value.shortcuts[id] ?? ""}
                placeholder={bindingFor(id, {}, value.keymap) || "Unassigned"}
                onChange={(e) =>
                  setDrafts((current) => ({ ...current, [id]: e.target.value }))
                }
                onBlur={(e) => {
                  change(id, e.target.value);
                  clearDraft(id);
                }}
                onKeyDown={(e) => {
                  if (recording !== id) {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      e.currentTarget.blur();
                    }
                    return;
                  }
                  e.preventDefault();
                  e.stopPropagation();
                  const binding = eventBinding(e);
                  if (binding) {
                    change(id, binding);
                    clearDraft(id);
                    setRecording("");
                  }
                }}
              />
              <button
                type="button"
                aria-label={`Record ${s.label} shortcut`}
                aria-pressed={recording === id}
                onClick={(e) => {
                  setRecording(id);
                  e.currentTarget.previousElementSibling instanceof
                    HTMLInputElement &&
                    (
                      e.currentTarget.previousElementSibling as HTMLInputElement
                    ).focus();
                }}
              >
                {recording === id ? "Press keys…" : "Record"}
              </button>
              <button
                type="button"
                aria-label={`Reset ${s.label} shortcut`}
                onClick={() => change(id, "")}
              >
                Reset
              </button>
            </label>
          ))}
      </div>
    </section>
  );
}
