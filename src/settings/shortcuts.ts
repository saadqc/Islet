export type Keymap = "auto" | "mac" | "windows";
export const isMac = () =>
  typeof navigator !== "undefined" && /Mac|iPhone/.test(navigator.platform);
type Shortcut = { label: string; group: string; binding: string; mac?: string };
export const shortcuts: Record<string, Shortcut> = {
  newFile: { label: "New File…", group: "Files", binding: "Mod-n" },
  newWorkspace: {
    label: "New Workspace",
    group: "Files",
    binding: "Mod-Alt-n",
  },
  openFile: { label: "Open File…", group: "Files", binding: "Mod-o" },
  save: {
    label: "Save",
    group: "Files",
    binding: "Ctrl-s",
    mac: "Meta-s; Ctrl-s",
  },
  saveAll: { label: "Save All", group: "Files", binding: "Mod-Shift-s" },
  closeTab: {
    label: "Close Tab",
    group: "Tabs",
    binding: "Ctrl-F4",
    mac: "Meta-w",
  },
  reopenTab: {
    label: "Reopen Closed Tab",
    group: "Tabs",
    binding: "Mod-Shift-t",
  },
  nextTab: {
    label: "Next Editor Tab",
    group: "Tabs",
    binding: "Alt-ArrowRight",
    mac: "Meta-Shift-]",
  },
  previousTab: {
    label: "Previous Editor Tab",
    group: "Tabs",
    binding: "Alt-ArrowLeft",
    mac: "Meta-Shift-[",
  },
  switchTab: {
    label: "Switch Recent Editor",
    group: "Tabs",
    binding: "Ctrl-Tab",
  },
  switchTabBack: {
    label: "Previous Recent Editor",
    group: "Tabs",
    binding: "Ctrl-Shift-Tab",
  },
  undo: { label: "Undo", group: "Editing", binding: "Mod-z" },
  redo: {
    label: "Redo",
    group: "Editing",
    binding: "Ctrl-Shift-z",
    mac: "Meta-Shift-z",
  },
  copy: { label: "Copy", group: "Editing", binding: "Mod-c" },
  cut: { label: "Cut", group: "Editing", binding: "Mod-x" },
  paste: { label: "Paste", group: "Editing", binding: "Mod-v" },
  "select-all": { label: "Select All", group: "Editing", binding: "Mod-a" },
  comment: { label: "Toggle Line Comment", group: "Editing", binding: "Mod-/" },
  duplicateLine: {
    label: "Duplicate Line or Selection",
    group: "Editing",
    binding: "Mod-d",
  },
  deleteLine: {
    label: "Delete Line",
    group: "Editing",
    binding: "Ctrl-y",
    mac: "Meta-Backspace",
  },
  indent: { label: "Indent", group: "Editing", binding: "Tab" },
  outdent: { label: "Unindent", group: "Editing", binding: "Shift-Tab" },
  moveLineUp: {
    label: "Move Line Up",
    group: "Editing",
    binding: "Alt-Shift-ArrowUp",
  },
  moveLineDown: {
    label: "Move Line Down",
    group: "Editing",
    binding: "Alt-Shift-ArrowDown",
  },
  complete: {
    label: "Code Completion",
    group: "Editing",
    binding: "Ctrl-Space",
  },
  expandSelection: {
    label: "Expand Selection",
    group: "Editing",
    binding: "Ctrl-w",
    mac: "Alt-ArrowUp",
  },
  fold: {
    label: "Collapse Code",
    group: "Editing",
    binding: "Ctrl-Minus",
    mac: "Meta-Minus",
  },
  unfold: {
    label: "Expand Code",
    group: "Editing",
    binding: "Ctrl-Equal",
    mac: "Meta-Equal",
  },
  foldAll: {
    label: "Collapse All Code",
    group: "Editing",
    binding: "Ctrl-Shift-Minus",
    mac: "Meta-Shift-Minus",
  },
  unfoldAll: {
    label: "Expand All Code",
    group: "Editing",
    binding: "Ctrl-Shift-Equal",
    mac: "Meta-Shift-Equal",
  },
  find: { label: "Find", group: "Search", binding: "Mod-f" },
  replace: { label: "Replace", group: "Search", binding: "Mod-r" },
  findNext: {
    label: "Find Next",
    group: "Search",
    binding: "F3",
    mac: "Meta-g",
  },
  findPrevious: {
    label: "Find Previous",
    group: "Search",
    binding: "Shift-F3",
    mac: "Meta-Shift-g",
  },
  findFiles: {
    label: "Find in Files…",
    group: "Search",
    binding: "Mod-Shift-f",
  },
  replaceFiles: {
    label: "Replace in Files…",
    group: "Search",
    binding: "Mod-Shift-r",
  },
  definition: {
    label: "Go to Definition",
    group: "Navigation",
    binding: "Mod-b",
  },
  references: {
    label: "Find References",
    group: "Navigation",
    binding: "Alt-F7",
  },
  back: {
    label: "Back",
    group: "Navigation",
    binding: "Ctrl-Alt-ArrowLeft",
    mac: "Meta-[",
  },
  forward: {
    label: "Forward",
    group: "Navigation",
    binding: "Ctrl-Alt-ArrowRight",
    mac: "Meta-]",
  },
  previousFunction: {
    label: "Previous Function",
    group: "Navigation",
    binding: "Alt-ArrowUp",
    mac: "Ctrl-Shift-ArrowUp",
  },
  nextFunction: {
    label: "Next Function",
    group: "Navigation",
    binding: "Alt-ArrowDown",
    mac: "Ctrl-Shift-ArrowDown",
  },
  rename: {
    label: "Refactor → Rename…",
    group: "Navigation",
    binding: "Shift-F6",
  },
  bookmark: {
    label: "Toggle Bookmark",
    group: "Navigation",
    binding: "F11; Ctrl-F11",
    mac: "F3; Meta-F11",
  },
  bookmarks: {
    label: "Show Bookmarks",
    group: "Navigation",
    binding: "Shift-F11; Ctrl-Shift-F11",
    mac: "Meta-F3; Meta-Shift-F11",
  },
  previousBookmark: {
    label: "Previous Bookmark",
    group: "Navigation",
    binding: "",
    mac: "",
  },
  nextBookmark: {
    label: "Next Bookmark",
    group: "Navigation",
    binding: "",
    mac: "",
  },
  toggleProject: {
    label: "Toggle Project tree",
    group: "Workspace",
    binding: "Alt-1",
    mac: "Meta-1",
  },
  settings: {
    label: "Settings",
    group: "Workspace",
    binding: "Ctrl-Alt-s",
    mac: "Meta-,",
  },
  goToLine: {
    label: "Go to Line",
    group: "Navigation",
    binding: "Ctrl-g",
    mac: "Meta-l",
  },
};
export function bindingFor(
  id: string,
  overrides: Record<string, string> = {},
  keymap: Keymap = "auto",
) {
  if (overrides[id]) return overrides[id] === "-" ? "" : overrides[id];
  const value = shortcuts[id];
  const mac = keymap === "mac" || (keymap === "auto" && isMac());
  return value
    ? (mac ? (value.mac ?? value.binding) : value.binding).replace(
        /Mod-/g,
        mac ? "Meta-" : "Ctrl-",
      )
    : "";
}
export function matchesBinding(
  event: Pick<
    KeyboardEvent,
    "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
  >,
  binding: string,
  mac = isMac(),
) {
  return binding.split(";").some((choice) => {
    const parts = choice.trim().split("-"),
      key = parts.pop() || "";
    if (!key) return false;
    const meta =
      parts.includes("Meta") ||
      parts.includes("Cmd") ||
      (parts.includes("Mod") && mac);
    const ctrl =
      parts.includes("Ctrl") ||
      parts.includes("Control") ||
      (parts.includes("Mod") && !mac);
    // Option may produce a different printable character on macOS.
    const actual =
      event.altKey && /^Key[A-Z]$/.test(event.code || "")
        ? event.code.slice(3)
        : event.key;
    return (
      (actual.toLowerCase() === key.toLowerCase() ||
        event.code?.toLowerCase() === key.toLowerCase() ||
        (event.shiftKey &&
          (
            {
              "[": "BracketLeft",
              "]": "BracketRight",
              "/": "Slash",
              ",": "Comma",
              ".": "Period",
            } as Record<string, string>
          )[key] === event.code)) &&
      event.metaKey === !!meta &&
      event.ctrlKey === !!ctrl &&
      event.altKey === parts.includes("Alt") &&
      event.shiftKey === parts.includes("Shift")
    );
  });
}
export function isTextControl(target: EventTarget | null) {
  return (
    target instanceof Element &&
    !!target.closest(
      'input,textarea,select,[contenteditable="true"]:not(.cm-content):not(.ProseMirror)',
    )
  );
}
export function isEditorTextControl(target: EventTarget | null) {
  return (
    isTextControl(target) &&
    !(
      target instanceof Element &&
      target.closest(".cm-content,.presentation-editor__hidden-host-wrapper")
    )
  );
}
export function eventBinding(event: KeyboardEvent | React.KeyboardEvent) {
  if (["Control", "Meta", "Alt", "Shift"].includes(event.key)) return "";
  const base = (
    {
      BracketLeft: "[",
      BracketRight: "]",
      Slash: "/",
      Minus: "Minus",
      Equal: "Equal",
    } as Record<string, string>
  )[event.code];
  const key = event.key === " " ? "Space" : base || event.key;
  return [
    event.metaKey && "Meta",
    event.ctrlKey && "Ctrl",
    event.altKey && "Alt",
    event.shiftKey && "Shift",
    key.length === 1 ? key.toLowerCase() : key,
  ]
    .filter(Boolean)
    .join("-");
}

export function nativeAccelerator(binding?: string) {
  if (!binding) return undefined;
  const primary = binding.split(";")[0].trim();
  if (!primary.includes("-") && !/^F\d+$/.test(primary)) return undefined;
  const parts = primary
    .replace(/^Mod-/, "CmdOrCtrl-")
    .replace(/^Meta-/, "Cmd-")
    .replace(/Arrow/g, "")
    .split("-");
  const key = parts.pop() || "";
  const aliases: Record<string, string> = {
    ",": "Comma",
    ".": "Period",
    "/": "Slash",
    "[": "BracketLeft",
    "]": "BracketRight",
    "=": "Equal",
  };
  const nativeKey = aliases[key] || key;
  if (
    !/^(?:[a-zA-Z0-9]|F(?:[1-9]|1\d|2[0-4])|Tab|Enter|Escape|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Left|Right|Up|Down|Space|Comma|Period|Slash|BracketLeft|BracketRight|Equal|Minus)$/.test(
      nativeKey,
    )
  )
    return undefined;
  return [...parts, nativeKey].join("+");
}
