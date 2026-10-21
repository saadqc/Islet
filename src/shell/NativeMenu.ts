import { useEffect, useRef } from "react";
import { shortcuts } from "../settings/shortcuts";
export function useNativeMenu(
  onCommand: (command: string) => void,
  bindings: Record<string, string>,
  enabled: boolean,
  readonly = false,
) {
  const action = useRef(onCommand);
  action.current = onCommand;
  useEffect(() => {
    if (!(window as any).__TAURI_INTERNALS__ || !enabled) return;
    let disposed = false;
    let closeFocus: (() => void) | undefined;
    let resource: { close: () => Promise<void> } | undefined;
    void (async () => {
      const { Menu } = await import("@tauri-apps/api/menu");
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const item = (id: string, text: string, accelerator?: string) => ({
        id,
        text,
        enabled:
          !readonly || !["cut", "paste", "undo", "redo", "rename"].includes(id),
        accelerator,
        action: () => action.current(id),
      });
      const commandItem = (id: string) => {
        const binding = bindings[id] || shortcuts[id]?.binding;
        return item(
          id,
          shortcuts[id]?.label || id,
          binding?.replace(/^Mod-/, "CmdOrCtrl-").split("-").join("+"),
        );
      };
      const menu = await Menu.new({
        items: [
          {
            text: "Islet",
            items: [
              item("settings", "Settings…", "CmdOrCtrl+Comma"),
              item("checkUpdates", "Check for Updates…"),
              { item: "Separator" },
              item("closeWindow", "Close Workspace", "CmdOrCtrl+Shift+W"),
            ],
          },
          {
            text: "File",
            items: [
              item("openFile", "Open File…", "CmdOrCtrl+O"),
              item("openFolder", "Open Folder…"),
              item("addSSH", "Add SSH Folder…"),
              { item: "Separator" },
              commandItem("save"),
              item("closeTab", "Close Tab", "CmdOrCtrl+W"),
            ],
          },
          {
            text: "Edit",
            items: [
              item("undo", "Undo", "CmdOrCtrl+Z"),
              item("redo", "Redo", "CmdOrCtrl+Shift+Z"),
              { item: "Separator" },
              item("cut", "Cut", "CmdOrCtrl+X"),
              item("copy", "Copy", "CmdOrCtrl+C"),
              item("paste", "Paste", "CmdOrCtrl+V"),
              item("select-all", "Select All", "CmdOrCtrl+A"),
              { item: "Separator" },
              commandItem("rename"),
            ],
          },
          {
            text: "Navigate",
            items: [
              "definition",
              "references",
              "back",
              "forward",
              "previousFunction",
              "nextFunction",
              "bookmark",
              "bookmarks",
            ].map(commandItem),
          },
          {
            text: "Search",
            items: [
              item("find", "Find in File…", "CmdOrCtrl+F"),
              item("replace", "Replace in File…", "CmdOrCtrl+R"),
              { item: "Separator" },
              commandItem("findFiles"),
              commandItem("replaceFiles"),
            ],
          },
        ],
      });
      resource = menu;
      if (disposed) {
        await menu.close();
        return;
      }
      const current = getCurrentWindow();
      const install = async () => {
        if (!disposed) await menu.setAsAppMenu();
      };
      if (await current.isFocused()) await install();
      closeFocus = await current.onFocusChanged(({ payload }) => {
        if (payload) void install();
      });
    })().catch(console.error);
    return () => {
      disposed = true;
      closeFocus?.();
      void resource?.close();
    };
  }, [bindings, enabled, readonly]);
}
