export const shortcuts: Record<string, { label: string; binding: string }> = {
  save: { label: "Save", binding: "Mod-s" },
  definition: { label: "Go to Definition", binding: "Mod-b" },
  references: { label: "Find References", binding: "Alt-F7" },
  back: { label: "Back", binding: "Mod-[" },
  forward: { label: "Forward", binding: "Mod-]" },
  previousFunction: { label: "Previous Function", binding: "Ctrl-Alt-ArrowUp" },
  nextFunction: { label: "Next Function", binding: "Ctrl-Alt-ArrowDown" },
  bookmark: { label: "Toggle Bookmark", binding: "Mod-F11" },
  bookmarks: { label: "Show Bookmarks", binding: "Mod-Shift-F11" },
  previousBookmark: {
    label: "Previous Bookmark",
    binding: "Alt-Shift-ArrowUp",
  },
  nextBookmark: { label: "Next Bookmark", binding: "Alt-Shift-ArrowDown" },
  rename: { label: "Refactor → Rename…", binding: "Shift-F6" },
  findFiles: { label: "Find in Files…", binding: "Mod-Shift-f" },
  replaceFiles: { label: "Replace in Files…", binding: "Mod-Shift-r" },
};
export function matchesBinding(event: KeyboardEvent, binding: string) {
  const parts = binding.split("-");
  const key = parts.pop() || "";
  const mac = /Mac|iPhone/.test(navigator.platform);
  const meta =
    parts.includes("Meta") ||
    parts.includes("Cmd") ||
    (parts.includes("Mod") && mac);
  const ctrl = parts.includes("Ctrl") || (parts.includes("Mod") && !mac);
  return (
    event.key.toLowerCase() === key.toLowerCase() &&
    event.metaKey === !!meta &&
    event.ctrlKey === !!ctrl &&
    event.altKey === parts.includes("Alt") &&
    event.shiftKey === parts.includes("Shift")
  );
}
