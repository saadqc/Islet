import { request } from "./bridge";

/** Native clipboard access avoids WebKit's permission-gated async web API. */
const native = () =>
  typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
export function readText(): Promise<string> {
  return native()
    ? request<string>("desktop.clipboard.readText")
    : navigator.clipboard.readText();
}
export function writeText(text: string): Promise<unknown> {
  return native()
    ? request("desktop.clipboard.writeText", { text })
    : navigator.clipboard.writeText(text);
}
