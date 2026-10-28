import { useEffect, useRef } from "react";
import { X } from "lucide-react";
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement;
    const first =
      ref.current?.querySelector<HTMLElement>("input,select,textarea") ||
      ref.current?.querySelector<HTMLElement>("button");
    first?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "Tab" && ref.current) {
        const list = Array.from(
          ref.current.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]',
          ),
        );
        if (!list.length) return;
        const i = list.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && i <= 0) {
          e.preventDefault();
          list.at(-1)?.focus();
        } else if (!e.shiftKey && i === list.length - 1) {
          e.preventDefault();
          list[0].focus();
        }
      }
    };
    const editing = (e: KeyboardEvent) => {
      if (
        e.target instanceof Element &&
        e.target.closest('[data-recording="true"]')
      )
        return;
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        ["a", "c", "x", "v", "z", "y"].includes(e.key.toLowerCase())
      )
        e.stopPropagation();
    };
    // Preserve the browser/native edit operation, but keep document/grid
    // listeners from consuming a focused dialog's keyboard events.
    window.addEventListener("keydown", editing, true);
    document.addEventListener("keydown", handler, true);
    return () => {
      window.removeEventListener("keydown", editing, true);
      document.removeEventListener("keydown", handler, true);
      prior?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal ${wide ? "wide" : ""}`}
      >
        <header>
          <strong>{title}</strong>
          <button className="icon" aria-label="Close dialog" onClick={onClose}>
            <X size={17} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
