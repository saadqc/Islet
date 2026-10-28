import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { SuperDoc } from "superdoc";
import "superdoc/style.css";
import "./docx.css";
import type { DocumentModel } from "../core/types";
import type { DocumentStore } from "../core/documents";
import { decodeOffice, encodeOffice } from "./formats";
import DocumentSearch from "./DocumentSearch";
export interface DocxHandle {
  command: (command: string) => Promise<void>;
}
export default forwardRef<
  DocxHandle,
  {
    document: DocumentModel;
    store: DocumentStore;
    onError: (error: unknown) => void;
  }
>(function DocxEditor({ document: doc, store, onError }, ref) {
  const ids = useRef("docx-" + crypto.randomUUID());
  const host = useRef<HTMLDivElement>(null),
    toolbar = useRef<HTMLDivElement>(null);
  const instance = useRef<SuperDoc | null>(null),
    serialized = useRef(doc.text);
  const errors = useRef(onError);
  errors.current = onError;
  const [source, setSource] = useState(doc.text),
    [ready, setReady] = useState(false),
    [error, setError] = useState("");
  const [zoom, setZoom] = useState(
    doc.docxZoom || { value: 100, mode: "manual" as const },
  );
  const [search, setSearch] = useState<{
    replace: boolean;
    sequence: number;
  } | null>(null);
  function openSearch(replace = false) {
    setSearch((previous) => ({
      replace: replace && !doc.readonly,
      sequence: (previous?.sequence || 0) + 1,
    }));
  }
  function changeZoom(value: number) {
    if (ready) instance.current?.setZoom(Math.max(25, Math.min(400, value)));
  }
  useEffect(() => {
    if (!ready) return;
    const shortcut = (event: KeyboardEvent) => {
      const target = event.target;
      const inDocument =
        target === window ||
        target === window.document.body ||
        (target instanceof Element &&
          !!target.closest(
            ".docx-editor, .presentation-editor__hidden-host-wrapper",
          ));
      if (!inDocument || !(event.metaKey || event.ctrlKey) || event.altKey)
        return;
      if (!["+", "=", "-", "0"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      const value = instance.current?.getZoom() || 100;
      instance.current?.setZoom(
        event.key === "0"
          ? 100
          : Math.max(25, Math.min(400, value + (event.key === "-" ? -10 : 10))),
      );
    };
    window.addEventListener("keydown", shortcut, true);
    return () => window.removeEventListener("keydown", shortcut, true);
  }, [ready]);
  useEffect(() => {
    if (doc.text !== serialized.current) {
      serialized.current = doc.text;
      setSource(doc.text);
    }
  }, [doc.text]);
  useImperativeHandle(ref, () => ({
    async command(command) {
      if (command === "find" || command === "replace") {
        if (ready) openSearch(command === "replace");
        return;
      }
      const editor = instance.current?.activeEditor;
      if (command === "findNext" || command === "findPrevious") {
        if (!search) {
          openSearch();
          return;
        }
        (
          editor?.commands?.[
            command === "findNext" ? "nextSearchMatch" : "previousSearchMatch"
          ] as (() => unknown) | undefined
        )?.();
        return;
      }
      if (command === "undo" || command === "redo") {
        if (editor?.commands?.[command])
          (editor.commands[command] as () => unknown)();
        else await editor?.doc?.history[command]();
        return;
      }
      editor?.focus?.();
      if (["copy", "cut", "paste", "select-all"].includes(command))
        window.document.execCommand(
          command === "select-all" ? "selectAll" : command,
        );
    },
  }));
  useEffect(() => {
    if (!host.current || !toolbar.current) return;
    let changed = 0,
      exported = 0,
      disposed = false,
      initialized = false,
      pending: Promise<void> | undefined,
      editor: SuperDoc | undefined,
      published = source;
    setReady(false);
    setError("");
    const report = (error: unknown) => {
      if (!disposed) {
        setError(String(error));
        errors.current(error);
      }
    };
    const flush = async (): Promise<void> => {
      if (pending) {
        await pending;
        if (exported < changed) await flush();
        return;
      }
      if (!editor || exported >= changed) return;
      const currentEditor = editor;
      pending = (async () => {
        while (exported < changed) {
          const version = changed;
          const blob = await currentEditor.export({
            exportType: ["docx"],
            triggerDownload: false,
          });
          if (!blob?.size)
            throw new Error(
              "The document could not be exported. Your original file has not been changed.",
            );
          const text = encodeOffice(new Uint8Array(await blob.arrayBuffer()));
          // An explicit reload/discard supersedes an export still in flight.
          if (doc.text !== published) {
            exported = changed;
            return;
          }
          published = text;
          serialized.current = text;
          store.change(doc.id, text);
          exported = version;
        }
      })();
      try {
        await pending;
      } finally {
        pending = undefined;
      }
    };
    store.flushers.set(doc.id, flush);
    editor = new SuperDoc({
      selector: "#" + ids.current,
      toolbar: "#" + ids.current + "-toolbar",
      document: new File(
        [decodeOffice(source)],
        doc.path.split("/").pop() || "document.docx",
        {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
      ),
      documentMode: doc.readonly ? "viewing" : "editing",
      role: doc.readonly ? "viewer" : "editor",
      modules: {
        toolbar: { responsiveToContainer: true, excludeItems: ["zoom"] },
      },
      zoom: {
        initial: doc.docxZoom?.value || 100,
        mode: doc.docxZoom?.mode || "manual",
        fitWidth: { min: 25, max: 100, padding: 64 },
      },
      onZoomChange: ({ zoom: value, mode }) => {
        if (disposed) return;
        setZoom({ value, mode });
        if (doc.docxZoom?.value !== value || doc.docxZoom?.mode !== mode) {
          doc.docxZoom = { value, mode };
          store.emit();
        }
      },
      telemetry: { enabled: false },
      licenseKey: "agpl",

      onReady: () => {
        initialized = true;
        if (!disposed) setReady(true);
      },
      onTransaction: ({ transaction }) => {
        if (
          doc.readonly ||
          disposed ||
          !initialized ||
          !transaction?.docChanged
        )
          return;
        changed++;
        doc.dirty = true;
        doc.saveState = "pending";
        doc.preview = false;
        store.emit();
        void flush().catch(report);
      },
      onException: ({ error }) => report(error),
      onContentError: ({ error }) => report(error),
    });
    instance.current = editor;
    return () => {
      disposed = true;
      // Finish serialization before releasing the editor when switching tabs.
      void flush()
        .catch((e) => errors.current(e))
        .finally(() => {
          if (store.flushers.get(doc.id) === flush)
            store.flushers.delete(doc.id);
          if (instance.current === editor) instance.current = null;
          editor?.destroy();
        });
    };
  }, [doc.id, source]);
  return (
    <section
      className="docx-editor"
      aria-label="Word document editor"
      data-ready={ready}
    >
      <div
        className="docx-toolbar"
        id={ids.current + "-toolbar"}
        ref={toolbar}
      />

      {error && (
        <p role="alert">Could not open or export this document: {error}</p>
      )}
      {!ready && !error && <p className="docx-loading">Opening document…</p>}
      <div className="docx-canvas" id={ids.current} ref={host} />
      {ready && search && instance.current?.activeEditor && (
        <DocumentSearch
          editor={instance.current.activeEditor}
          request={search}
          readonly={!!doc.readonly}
          onClose={() => setSearch(null)}
        />
      )}
      <div
        className="docx-viewbar"
        role="group"
        aria-label="Document zoom controls"
      >
        <button
          type="button"
          disabled={!ready}
          onClick={() => openSearch()}
          title="Find (Cmd/Ctrl F)"
        >
          Find
        </button>
        {!doc.readonly && (
          <button
            type="button"
            disabled={!ready}
            onClick={() => openSearch(true)}
            title="Find and replace (Cmd/Ctrl R)"
          >
            Replace
          </button>
        )}
        <span className="docx-viewbar-spacer" />
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out (Cmd/Ctrl −)"
          disabled={!ready || zoom.value <= 25}
          onClick={() => changeZoom(zoom.value - 10)}
        >
          −
        </button>
        <input
          type="range"
          aria-label="Document zoom"
          aria-valuetext={`${Math.round(zoom.value)}%`}
          min="25"
          max="400"
          step="5"
          value={zoom.value}
          disabled={!ready}
          onChange={(event) => changeZoom(Number(event.target.value))}
        />
        <button
          type="button"
          aria-label="Zoom in"
          title="Zoom in (Cmd/Ctrl +)"
          disabled={!ready || zoom.value >= 400}
          onClick={() => changeZoom(zoom.value + 10)}
        >
          +
        </button>
        <button
          type="button"
          className="docx-zoom-value"
          aria-label="Reset document zoom to 100%"
          title="Reset to 100% (Cmd/Ctrl 0)"
          disabled={!ready}
          onClick={() => changeZoom(100)}
        >
          {Math.round(zoom.value)}%
        </button>
        <button
          type="button"
          aria-label="Fit document to width"
          aria-pressed={zoom.mode === "fit-width"}
          disabled={!ready}
          onClick={() => instance.current?.setZoomMode("fit-width")}
        >
          Fit width
        </button>
      </div>
    </section>
  );
});
