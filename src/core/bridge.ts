export type Request = <T = any>(operation: string, payload?: any) => Promise<T>;
export type EventListener = (event: any) => void;
let injected: Request | undefined;
let restartPending = false;
const activeRequests = new Set<Promise<unknown>>();
export function setRestartPending(value: boolean) {
  restartPending = value;
}
export async function waitForRequests() {
  while (activeRequests.size) await Promise.allSettled([...activeRequests]);
}
let eventSource: EventSource | undefined;
const listeners = new Map<string, Set<EventListener>>();
export function setTransport(request: Request) {
  injected = request;
}
const dispatch: Request = async (operation, payload = {}) => {
  if (injected) return injected(operation, payload);
  if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      return await invoke("host_request", { operation, payload });
    } catch (error) {
      throw normalizeHostError(error);
    }
  }
  const response = await fetch("/host/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation, payload }),
  });
  const value = await response.json();
  if (!response.ok || value.error)
    throw normalizeHostError(value.error || { message: "Host request failed" });
  return value.result ?? value;
};
export const request: Request = async (operation, payload = {}) => {
  const allowed =
    operation.startsWith("updater.") ||
    ["session.save", "session.register"].includes(operation);
  if (restartPending && !allowed)
    throw new Error("Islet is preparing to restart.");
  const pending = dispatch(operation, payload);
  if (!allowed) activeRequests.add(pending);
  try {
    return await pending;
  } finally {
    activeRequests.delete(pending);
  }
};
export async function onHostEvent(
  name: string,
  callback: EventListener,
): Promise<() => void> {
  if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
    const { listen } = await import("@tauri-apps/api/event");
    return listen(name, (e) => callback(e.payload));
  }
  if (typeof window !== "undefined" && !eventSource) {
    eventSource = new EventSource("/host/events");
    eventSource.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        emitHostEvent(event.event || event.name, event.payload ?? event.data);
      } catch {}
    };
  }
  let set = listeners.get(name);
  if (!set) listeners.set(name, (set = new Set()));
  set.add(callback);
  return () => set!.delete(callback);
}
export function emitHostEvent(name: string, event: any) {
  listeners.get(name)?.forEach((fn) => fn(event));
}

export function normalizeHostError(
  error: unknown,
): Error & { code?: string; details?: unknown } {
  let value: any = error;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return new Error(value);
    }
  }
  if (value instanceof Error) return value;
  return Object.assign(new Error(value?.message || String(error)), {
    code: value?.code,
    details: value?.details,
  });
}
