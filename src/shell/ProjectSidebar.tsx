import { useEffect, useRef, useState, type ReactNode } from "react";
import { PanelLeftClose } from "lucide-react";
import "./projectSidebar.css";

const key = "islet.projectSidebar.width";
const minimum = 170;
const maximum = () => Math.max(minimum, Math.min(640, window.innerWidth * 0.6));
const clamp = (width: number) => Math.max(minimum, Math.min(maximum(), width));
export function ProjectSidebar({
  children,
  onCollapse,
}: {
  children: ReactNode;
  onCollapse: () => void;
}) {
  const [width, setWidth] = useState(() => {
    try {
      return clamp(Number(localStorage.getItem(key)) || 244);
    } catch {
      return 244;
    }
  });
  const drag = useRef<{ x: number; width: number } | null>(null);
  useEffect(() => {
    try {
      localStorage.setItem(key, String(width));
    } catch {}
  }, [width]);
  useEffect(() => {
    const resize = () => setWidth((value) => clamp(value));
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  return (
    <aside className="project-island resizable-project" style={{ width }}>
      {children}
      <button
        className="icon small collapse-project"
        aria-label="Collapse Project sidebar"
        title="Collapse Project sidebar"
        onClick={onCollapse}
      >
        <PanelLeftClose size={15} />
      </button>
      <div
        className="project-resizer"
        role="separator"
        aria-label="Resize Project sidebar"
        aria-orientation="vertical"
        aria-valuemin={minimum}
        aria-valuemax={maximum()}
        aria-valuenow={Math.round(width)}
        tabIndex={0}
        onDoubleClick={() => setWidth(244)}
        onKeyDown={(event) => {
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            setWidth((value) =>
              clamp(
                event.key === "Home"
                  ? minimum
                  : event.key === "End"
                    ? maximum()
                    : value + (event.key === "ArrowLeft" ? -20 : 20),
              ),
            );
          }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          drag.current = { x: event.clientX, width };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (drag.current)
            setWidth(
              clamp(drag.current.width + event.clientX - drag.current.x),
            );
        }}
        onPointerUp={(event) => {
          drag.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
      />
    </aside>
  );
}
