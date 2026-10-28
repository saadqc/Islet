export interface TerminalPreference {
  id: string;
  path: string;
}
export interface Preferences {
  keymap: "auto" | "mac" | "windows";
  schemaVersion: 1;
  theme: "dark" | "light" | "system";
  fontSize: number;
  fontFamily: string;
  shortcuts: Record<string, string>;
  lineHeight: number;
  ligatures: boolean;
  compact: boolean;
  wrap: boolean;
  markdownDefault: "preview" | "source";
  callerPanel: boolean;
  folderOpenMode: "single" | "double";
  uiScale: number;
  interpreter: string;
  terminal: TerminalPreference;
}
export const defaults: Preferences = {
  schemaVersion: 1,
  keymap: "auto",
  theme: "dark",
  fontSize: 13,
  fontFamily: "JetBrains Mono",
  shortcuts: {},
  lineHeight: 1.55,
  ligatures: false,
  compact: false,
  wrap: false,
  markdownDefault: "preview",
  callerPanel: false,
  folderOpenMode: "double",
  uiScale: 1,
  interpreter: "",
  terminal: { id: "system", path: "" },
};
export function validatePreferences(value: Partial<Preferences>): Preferences {
  return {
    ...defaults,
    ...value,
    keymap:
      value.keymap === "mac" || value.keymap === "windows"
        ? value.keymap
        : "auto",
    shortcuts:
      value.shortcuts && typeof value.shortcuts === "object"
        ? Object.fromEntries(
            Object.entries(value.shortcuts).filter(
              ([, binding]) => typeof binding === "string",
            ),
          )
        : {},
    callerPanel: value.callerPanel === true,
    folderOpenMode: value.folderOpenMode === "single" ? "single" : "double",
    fontSize: Math.max(9, Math.min(32, Number(value.fontSize) || 13)),
    lineHeight: Math.max(1.1, Math.min(2.5, Number(value.lineHeight) || 1.55)),
    uiScale: Math.max(0.75, Math.min(1.5, Number(value.uiScale) || 1)),
    terminal: {
      id: typeof value.terminal?.id === "string" ? value.terminal.id : "system",
      path: typeof value.terminal?.path === "string" ? value.terminal.path : "",
    },
  };
}
