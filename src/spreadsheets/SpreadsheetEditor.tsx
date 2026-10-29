import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import jspreadsheet from "jspreadsheet-ce";
import { readText } from "../core/clipboard";
import { Modal } from "../shell/Modal";
import {
  changeWorkbookSheets,
  suggestedSheetName,
  type SheetAction,
} from "./sheets";
import { Plus, Redo2, Undo2 } from "lucide-react";
import type { DocumentModel } from "../core/types";
import { utils } from "xlsx";
import { checkDimensions, SpreadsheetSession, type Grid } from "./workbook";
import "jsuites/dist/jsuites.css";
import "jspreadsheet-ce/dist/jspreadsheet.css";
import "./spreadsheet.css";

export interface SpreadsheetHandle {
  commit: () => void;
  command: (id: string) => void;
}
const SpreadsheetEditor = forwardRef<
  SpreadsheetHandle,
  {
    document: DocumentModel;
    onChange: (text: string) => void;
    onError: (error: unknown) => void;
    onSaveCopy: () => void;
    onSave: () => void;
  }
>(function SpreadsheetEditor(
  { document: doc, onChange, onError, onSaveCopy, onSave },
  ref,
) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<jspreadsheet.WorksheetInstance | null>(null);
  const session = useRef<SpreadsheetSession | null>(null);
  const lastText = useRef<string | undefined>(undefined);
  const callbacks = useRef({ onChange, onError });
  callbacks.current = { onChange, onError };
  const [sheet, setSheet] = useState("");
  const [names, setNames] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [generation, setGeneration] = useState(0);
  const [selection, setSelection] = useState("");
  const [sheetAction, setSheetAction] = useState<SheetAction>();
  const [sheetName, setSheetName] = useState("");
  const [sheetError, setSheetError] = useState("");
  const sheetUndo = useRef<
    { before: string; after: string; beforeSheet: string; afterSheet: string }[]
  >([]);
  const sheetRedo = useRef<typeof sheetUndo.current>([]);
  function undo() {
    commit();
    const change = sheetUndo.current.at(-1);
    if (change && doc.text === change.after) {
      sheetUndo.current.pop();
      sheetRedo.current.push(change);
      callbacks.current.onChange(change.before);
      setSheet(change.beforeSheet);
    } else instance.current?.undo();
  }
  function redo() {
    commit();
    const change = sheetRedo.current.at(-1);
    if (change && doc.text === change.before) {
      sheetRedo.current.pop();
      sheetUndo.current.push(change);
      callbacks.current.onChange(change.after);
      setSheet(change.afterSheet);
    } else instance.current?.redo();
  }
  function manageSheet(action: SheetAction) {
    commit();
    setSheetError("");
    setSheetAction(action);
    setSheetName(
      action === "rename"
        ? sheet
        : suggestedSheetName(names, action === "duplicate" ? sheet : undefined),
    );
  }
  function applySheetAction() {
    if (!sheetAction || doc.readonly) return;
    try {
      commit();
      const before = doc.text;
      const changed = changeWorkbookSheets(
        doc.path,
        before,
        sheetAction,
        sheet,
        sheetName,
      );
      sheetUndo.current.push({
        before,
        after: changed.text,
        beforeSheet: sheet,
        afterSheet: changed.name,
      });
      if (sheetUndo.current.length > 10) sheetUndo.current.shift();
      sheetRedo.current = [];
      callbacks.current.onChange(changed.text);
      setSheet(changed.name);
      setSheetAction(undefined);
    } catch (error) {
      setSheetError(String(error));
    }
  }
  function commit() {
    const cell =
      container.current?.querySelector<HTMLTableCellElement>("td.editor");
    if (cell) instance.current?.closeEditor(cell, true);
  }
  useImperativeHandle(ref, () => ({
    commit,
    command(id) {
      const grid = instance.current;
      if (
        !grid ||
        (doc.readonly && ["cut", "paste", "undo", "redo"].includes(id))
      )
        return;
      if (id === "undo") {
        undo();
      } else if (id === "redo") {
        redo();
      } else if (id === "select-all") {
        const rows = grid.getData(false, false);
        grid.updateSelectionFromCoords(
          0,
          0,
          rows[0].length - 1,
          rows.length - 1,
        );
      } else if (id === "copy" || id === "cut") grid.copy(id === "cut");
      else if (id === "paste") {
        void readText()
          .then((text) => {
            if (instance.current === grid && grid.selectedCell)
              grid.paste(
                Number(grid.selectedCell[0]),
                Number(grid.selectedCell[1]),
                text,
              );
          })
          .catch((error) => callbacks.current.onError(error));
      }
    },
  }));
  useEffect(() => {
    if (lastText.current === doc.text && session.current?.path === doc.path)
      return;
    try {
      session.current = new SpreadsheetSession(doc.path, doc.text);
      lastText.current = doc.text;
      setNames(session.current.names);
      setSheet((current) =>
        session.current!.names.includes(current)
          ? current
          : session.current!.names[0],
      );
      setError("");
      setGeneration((n) => n + 1);
    } catch (e) {
      session.current = null;
      setError(String(e));
    }
  }, [doc.id, doc.path, doc.text]);
  useEffect(() => {
    const element =
      container.current as jspreadsheet.JspreadsheetInstanceElement | null;
    const model = session.current;
    if (!element || !model || !sheet || error) return;
    if (!model.grids.has(sheet)) {
      setError("This worksheet type cannot be edited.");
      return;
    }
    let ready = false;
    const publishData = (data: Grid) => {
      if (!ready || doc.readonly) return;
      try {
        const text = model.serialize(sheet, data);
        lastText.current = text;
        callbacks.current.onChange(text);
      } catch (e) {
        callbacks.current.onError(e);
      }
    };
    const publish = (worksheet: jspreadsheet.WorksheetInstance) =>
      publishData(worksheet.getData(false, false) as Grid);
    const data = model.data(sheet);
    const rows = Math.max(20, data.length),
      columns = Math.max(8, ...data.map((r) => r.length));
    const grid = jspreadsheet(element, {
      // Raw formula text is editable and preserved, but never executed as JavaScript.
      parseFormulas: false,
      parseHTML: false,
      toolbar: false,
      tabs: false,
      allowExport: false,
      contextMenu: () => null,
      oncreateeditor: (worksheet, cell, x, y) => {
        const input = cell.querySelector<
          HTMLInputElement | HTMLTextAreaElement
        >("input, textarea");
        input?.addEventListener("input", () => {
          const data = (worksheet.getData(false, false) as Grid).map((row) => [
            ...row,
          ]);
          data[Number(y)][Number(x)] = input.value;
          publishData(data);
        });
      },
      oneditionend: publish,
      onafterchanges: publish,
      onundo: publish,
      onredo: publish,
      onselection: (_worksheet, x, y) =>
        setSelection(utils.encode_cell({ c: Number(x), r: Number(y) })),
      worksheets: [
        {
          worksheetName: sheet,
          data,
          minDimensions: [columns, rows],
          editable: !doc.readonly,
          defaultColWidth: 130,
          allowInsertRow: false,
          allowInsertColumn: false,
          allowManualInsertRow: false,
          allowManualInsertColumn: false,
          allowDeleteRow: false,
          allowDeleteColumn: false,
          allowRenameColumn: false,
          allowComments: false,
          columnSorting: false,
          columnDrag: false,
          rowDrag: false,
          tableOverflow: true,
          tableWidth: "100%",
          tableHeight: "100%",
        },
      ],
    });
    instance.current = grid[0];
    // CE uses an inline selection handler; replace it without weakening Islet's CSP.
    grid[0].corner.removeAttribute("onselectstart");
    grid[0].corner.addEventListener("selectstart", (event) =>
      event.preventDefault(),
    );
    ready = true;
    const resize = () => {
      const content = element.querySelector<HTMLElement>(".jss_content");
      if (content) {
        content.style.width = `${element.clientWidth}px`;
        content.style.height = `${element.clientHeight}px`;
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    return () => {
      ready = false;
      instance.current = null;
      observer.disconnect();
      jspreadsheet.destroy(element, true);
    };
  }, [doc.id, doc.readonly, sheet, generation, error]);
  function append(column: boolean) {
    const grid = instance.current;
    if (!grid || doc.readonly) return;
    try {
      const data = grid.getData(false, false) as Grid;
      const width = Math.max(1, ...data.map((row) => row.length));
      checkDimensions(data.length + (column ? 0 : 1), width + (column ? 1 : 0));
      // Append only: shifting existing cells could invalidate workbook references.
      if (column) {
        grid.options.allowInsertColumn = true;
        grid.insertColumn(1);
        grid.options.allowInsertColumn = false;
      } else {
        grid.options.allowInsertRow = true;
        grid.insertRow(1);
        grid.options.allowInsertRow = false;
      }
    } catch (e) {
      callbacks.current.onError(e);
    }
  }
  return (
    <section
      className="spreadsheet-editor"
      aria-label="Spreadsheet editor"
      onKeyDownCapture={(event) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === "s"
        ) {
          event.preventDefault();
          event.stopPropagation();
          onSave();
        }
      }}
    >
      <div className="spreadsheet-toolbar">
        <label>
          Sheet{" "}
          <select
            aria-label="Worksheet"
            value={sheet}
            onChange={(e) => {
              setError("");
              setSheet(e.target.value);
            }}
          >
            {names.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        {doc.binary && (
          <>
            <button
              aria-label="Create sheet"
              disabled={doc.readonly || !!error}
              onClick={() => manageSheet("create")}
            >
              <Plus size={14} />
              Sheet
            </button>
            <select
              aria-label="Sheet actions"
              value=""
              disabled={doc.readonly || !!error}
              onChange={(event) =>
                manageSheet(event.target.value as SheetAction)
              }
            >
              <option value="" disabled>
                Sheet actions…
              </option>
              <option value="rename">Rename sheet…</option>
              <option value="duplicate">Duplicate sheet…</option>
              <option value="delete" disabled={names.length <= 1}>
                Delete sheet…
              </option>
            </select>
          </>
        )}
        <button
          title="Undo cell edit"
          disabled={doc.readonly || !!error}
          onClick={undo}
        >
          <Undo2 size={15} />
          Undo
        </button>
        <button
          title="Redo cell edit"
          disabled={doc.readonly || !!error}
          onClick={redo}
        >
          <Redo2 size={15} />
          Redo
        </button>
        <button
          disabled={doc.readonly || !!error}
          onClick={() => append(false)}
        >
          <Plus size={14} />
          Row
        </button>
        <button disabled={doc.readonly || !!error} onClick={() => append(true)}>
          <Plus size={14} />
          Column
        </button>
        {doc.binary && (
          <button onClick={onSaveCopy} disabled={!!error}>
            Save XLSX Copy…
          </button>
        )}
        <span className="spreadsheet-selection">{selection}</span>
        <span className="muted">Offline</span>
      </div>
      {error ? (
        <p role="alert" className="spreadsheet-error">
          {error}
        </p>
      ) : (
        <div ref={container} className="spreadsheet-grid" />
      )}
      {sheetAction && (
        <Modal
          title={
            sheetAction === "create"
              ? "Create Sheet"
              : sheetAction === "rename"
                ? "Rename Sheet"
                : sheetAction === "duplicate"
                  ? "Duplicate Sheet"
                  : "Delete Sheet"
          }
          onClose={() => setSheetAction(undefined)}
        >
          <form
            className="dialog-body"
            onSubmit={(event) => {
              event.preventDefault();
              applySheetAction();
            }}
          >
            {sheetAction === "delete" ? (
              <p>
                Delete “{sheet}” and its contents? Formulas that refer to it
                will become #REF!. This stays unsaved until you save the
                workbook, and Undo can restore it.
              </p>
            ) : (
              <label>
                Sheet name
                <input
                  aria-label="Sheet name"
                  value={sheetName}
                  onChange={(event) => setSheetName(event.target.value)}
                  onFocus={(event) => event.target.select()}
                />
              </label>
            )}
            {sheetError && <p role="alert">{sheetError}</p>}
            <footer>
              <button type="button" onClick={() => setSheetAction(undefined)}>
                Cancel
              </button>
              <button
                className="primary"
                disabled={sheetAction !== "delete" && !sheetName}
              >
                {sheetAction === "delete" ? "Delete Sheet" : "Apply"}
              </button>
            </footer>
          </form>
        </Modal>
      )}
      <div className="spreadsheet-note">
        {doc.binary
          ? "Workbook data editor · Formulas shown as text · Advanced Excel formatting may change on save; originals are backed up in Islet app data."
          : "CSV · Values stay as text · Double-click a cell to edit · ⌘S / Ctrl+S to save"}
      </div>
    </section>
  );
});
export default SpreadsheetEditor;
