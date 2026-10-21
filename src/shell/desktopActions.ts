import { request } from "../core/bridge";
import type { Root } from "../workspaces/model";
import { validatePreferences } from "../settings/preferences";

export const quoteShell = (value: string) =>
  "'" + value.replace(/'/g, "'\\''") + "'";
export function sshFolderCommand(hostId: string, path: string) {
  if (
    !hostId.startsWith("ssh:") ||
    !path.startsWith("/") ||
    /[\0\r\n]/.test(path)
  )
    throw new Error("This folder does not have a valid SSH location.");
  const uri = new URL("ssh://" + hostId.slice(4));
  if (
    !uri.hostname ||
    uri.password ||
    uri.search ||
    uri.hash ||
    uri.pathname.length > 1
  )
    throw new Error("Invalid SSH host.");
  const user = uri.username ? decodeURIComponent(uri.username) + "@" : "";
  const destination = user + uri.hostname;
  if (destination.startsWith("-") || /[\0\r\n]/.test(destination))
    throw new Error("Invalid SSH host.");
  const command =
    "cd -- " + quoteShell(path) + ' && exec "${SHELL:-/bin/sh}" -l';
  return (
    "ssh -t " +
    (uri.port ? "-p " + uri.port + " " : "") +
    "-- " +
    quoteShell(destination) +
    " " +
    quoteShell(command)
  );
}
export function desktopActions(
  root: Root,
  path: string,
  folder: boolean,
  onError: (error: string) => void,
) {
  const run = (action: () => Promise<unknown>) => () => {
    void action().catch((error) => onError(String(error)));
  };
  const platform = navigator.platform;
  const label = /Mac/.test(platform)
    ? "Reveal in Finder"
    : /Win/.test(platform)
      ? "Show in Explorer"
      : "Show in File Manager";
  const items: {
    label: string;
    action: () => void;
    disabled?: string;
    separator?: boolean;
  }[] = [
    {
      label,
      separator: true,
      disabled:
        root.hostId === "local"
          ? undefined
          : "This folder is on a remote machine.",
      action: run(() =>
        request("desktop.reveal", { hostId: root.hostId, path }),
      ),
    },
  ];
  if (folder)
    items.push(
      root.hostId === "local"
        ? {
            label: "Open in Terminal",
            action: run(async () => {
              const preferences = validatePreferences(
                (await request("settings.load")) || {},
              );
              await request("desktop.openTerminal", {
                hostId: root.hostId,
                path,
                terminal: preferences.terminal,
              });
            }),
          }
        : {
            label: "Copy SSH Command",
            action: run(async () => {
              const command = root.hostId.startsWith("codespace:")
                ? (
                    await request("codespaces.sshCommand", {
                      id: root.hostId.slice(10),
                      path,
                    })
                  ).command
                : sshFolderCommand(root.hostId, path);
              await navigator.clipboard.writeText(command);
            }),
          },
    );
  return items;
}
