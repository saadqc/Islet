import { useEffect, useRef } from "react";
import {
  shortcuts,
  bindingFor,
  nativeAccelerator,
} from "../settings/shortcuts";
export function useNativeMenu(
  onCommand: (command: string) => void,
  bindings: Record<string, string>,
  enabled: boolean,
  readonly = false,
) {
  const bindingIdentity = JSON.stringify(bindings);
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
        const binding =
          bindings[id] === "-"
            ? undefined
            : (bindings[id] || bindingFor(id)).split(";")[0].trim();
        return item(id, shortcuts[id]?.label || id, nativeAccelerator(binding));
      };
      const menu = await Menu.new({
        items: [
          {
            text: "Islet",
            items: [
              commandItem("newWorkspace"),
              commandItem("settings"),
              item("checkUpdates", "Check for Updates…"),
              { item: "Separator" },
              item("closeWindow", "Close Workspace", "CmdOrCtrl+Shift+W"),
            ],
          },
          {
            text: "File",
            items: [
              commandItem("newFile"),
              item("newFolder", "New Folder…"),
              { item: "Separator" },
              commandItem("openFile"),
              item("openFolder", "Open Folder…"),
              item("addSSH", "Add SSH Folder…"),
              { item: "Separator" },
              commandItem("save"),
              commandItem("closeTab"),
            ],
          },
          {
            text: "Edit",
            items: [
              { item: "Undo" },
              { item: "Redo" },
              { item: "Separator" },
              { item: "Cut" },
              { item: "Copy" },
              { item: "Paste" },
              { item: "SelectAll" },
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
              commandItem("find"),
              commandItem("replace"),
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
  }, [bindingIdentity, enabled, readonly]);
}
