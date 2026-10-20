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
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]',
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
    document.addEventListener("keydown", handler, true);
    return () => {
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
