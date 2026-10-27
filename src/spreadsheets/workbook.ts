import * as XLSX from "xlsx";
import Papa from "papaparse";
import { isBinaryWorkbook } from "./formats";

export type CellValue = string | number | boolean;
export type Grid = CellValue[][];
export const MAX_ROWS = 5000,
  MAX_COLUMNS = 256,
  MAX_CELLS = 100000;
export function checkDimensions(rows: number, columns: number) {
  if (rows > MAX_ROWS || columns > MAX_COLUMNS || rows * columns > MAX_CELLS)
    throw new Error(
      "Spreadsheet exceeds the editor limit: 5,000 rows, 256 columns, or 100,000 cells per sheet. The file has not been modified.",
    );
}
function display(cell?: XLSX.CellObject): CellValue {
  if (!cell) return "";
  if (cell.f) return "=" + cell.f;
  if (cell.t === "e") return cell.w || "#ERROR!";
  return (cell.v as CellValue) ?? "";
}
function editedCell(value: CellValue): XLSX.CellObject | undefined {
  if (value === "") return undefined;
  if (typeof value === "number") return { t: "n", v: value };
  if (typeof value === "boolean") return { t: "b", v: value };
  if (value.startsWith("=")) return { t: "n", f: value.slice(1) };
  // Leading zeros are significant; never silently turn identifiers into numbers.
  if (
    /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value) &&
    Number.isFinite(Number(value))
  )
    return { t: "n", v: Number(value) };
  return { t: "s", v: value };
}
function csvDelimiter(source: string) {
  // Sniff the first nonempty logical record. Padded/ragged later rows must not
  // make a valid semicolon/tab-separated file fall back to a comma.
  let best = ",",
    fields = 1;
  for (const delimiter of [",", ";", "\t", "|"]) {
    const sample = Papa.parse<string[]>(source, {
      delimiter,
      preview: 1,
      skipEmptyLines: "greedy",
    });
    if ((sample.data[0]?.length || 0) > fields) {
      fields = sample.data[0].length;
      best = delimiter;
    }
  }
  return fields > 1 ? best : undefined;
}
export class SpreadsheetSession {
  readonly binary: boolean;
  readonly names: string[];
  readonly grids = new Map<string, Grid>();
  readonly original: XLSX.WorkBook;
  private baseline = new Map<string, Grid>();
  private delimiter = ",";
  private trailingNewline = false;
  private csvRows: string[][] = [];
  constructor(
    readonly path: string,
    readonly source: string,
  ) {
    if (source.length > 14 * 1024 * 1024)
      throw new Error("Spreadsheets are limited to 10 MB.");
    this.binary = isBinaryWorkbook(path);
    if (this.binary) {
      if (!source)
        throw new Error(
          "This workbook is empty or invalid. Create a new workbook using New File.",
        );
      this.original = XLSX.read(source, {
        type: "base64",
        cellStyles: true,
        cellNF: true,
        bookVBA: true,
      });
      this.names = this.original.SheetNames;
      if (!this.names.length)
        throw new Error("This workbook has no worksheets.");
      for (const name of this.names) {
        const sheet = this.original.Sheets[name];
        const end = sheet["!ref"]
          ? XLSX.utils.decode_range(sheet["!ref"]).e
          : { r: 0, c: 0 };
        checkDimensions(end.r + 1, end.c + 1);
        if (sheet["!type"] && sheet["!type"] !== "sheet") continue;
        const rows: Grid = [];
        for (let r = 0; r <= end.r; r++) {
          const row: CellValue[] = [];
          for (let c = 0; c <= end.c; c++)
            row.push(display(sheet[XLSX.utils.encode_cell({ r, c })]));
          rows.push(row);
        }
        this.grids.set(name, rows);
      }
    } else {
      const parsed = Papa.parse<string[]>(source, {
        delimiter: csvDelimiter(source),
        dynamicTyping: false,
        skipEmptyLines: false,
      });
      if (parsed.errors.some((e) => e.type === "Quotes"))
        throw new Error(
          "CSV contains malformed quoted fields. Fix it in a text editor before opening the grid.",
        );
      this.delimiter = parsed.meta.delimiter || ",";
      this.trailingNewline = source.endsWith("\n");
      this.csvRows = parsed.data;
      if (
        this.trailingNewline &&
        this.csvRows.at(-1)?.length === 1 &&
        this.csvRows.at(-1)?.[0] === ""
      )
        this.csvRows.pop();
      if (!source) this.csvRows = [];
      checkDimensions(
        this.csvRows.length,
        this.csvRows.reduce((max, row) => Math.max(max, row.length), 1),
      );
      this.names = ["Sheet1"];
      this.original = XLSX.utils.book_new();
      this.grids.set(
        "Sheet1",
        this.csvRows.map((row) => [...row]),
      );
    }
    this.baseline = new Map(
      [...this.grids].map(([name, rows]) => [
        name,
        rows.map((row) => [...row]),
      ]),
    );
  }
  data(name: string): Grid {
    return (this.grids.get(name) || []).map((row) => [...row]);
  }
  serialize(name: string, data: Grid): string {
    checkDimensions(
      data.length,
      data.reduce((max, row) => Math.max(max, row.length), 1),
    );
    this.grids.set(
      name,
      data.map((row) => [...row]),
    );
    const unchanged = [...this.grids].every(([sheet, rows]) => {
      const original = this.baseline.get(sheet) || [];
      for (let r = 0; r < Math.max(rows.length, original.length); r++) {
        for (
          let c = 0;
          c < Math.max(rows[r]?.length || 0, original[r]?.length || 0);
          c++
        )
          if (String(rows[r]?.[c] ?? "") !== String(original[r]?.[c] ?? ""))
            return false;
      }
      return true;
    });
    if (unchanged) return this.source;
    if (!this.binary) {
      let last = this.csvRows.length - 1;
      for (let r = 0; r < data.length; r++)
        if (data[r].some((v) => v !== "" && v != null))
          last = Math.max(last, r);
      const rows = data.slice(0, last + 1).map((row, r) => {
        let end = (this.csvRows[r]?.length || 1) - 1;
        row.forEach((v, c) => {
          if (v !== "" && v != null) end = Math.max(end, c);
        });
        return row.slice(0, end + 1).map((v) => String(v ?? ""));
      });
      return (
        Papa.unparse(rows, { delimiter: this.delimiter, newline: "\n" }) +
        (this.trailingNewline ? "\n" : "")
      );
    }
    const book = structuredClone(this.original);
    for (const [sheetName, rows] of this.grids) {
      const sheet = book.Sheets[sheetName];
      let maxRow = XLSX.utils.decode_range(sheet["!ref"] || "A1").e.r;
      let maxCol = XLSX.utils.decode_range(sheet["!ref"] || "A1").e.c;
      rows.forEach((row, r) =>
        row.forEach((value, c) => {
          const address = XLSX.utils.encode_cell({ r, c }),
            original = this.original.Sheets[sheetName][address];
          if (String(display(original)) === String(value ?? "")) return;
          const cell = editedCell(value ?? "");
          if (cell) {
            // Retain cell formatting where CE supports it; clear stale cached text.
            sheet[address] = { ...original, ...cell };
            delete sheet[address].w;
            delete sheet[address].h;
            delete sheet[address].r;
            if (!cell.f) delete sheet[address].f;
            else delete sheet[address].v;
            maxRow = Math.max(maxRow, r);
            maxCol = Math.max(maxCol, c);
          } else delete sheet[address];
        }),
      );
      sheet["!ref"] = XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: maxRow, c: maxCol },
      });
    }
    // CE does not calculate formulas. Do not retain stale cached results after edits.
    for (const sheet of Object.values(book.Sheets))
      for (const [key, cell] of Object.entries(sheet))
        if (!key.startsWith("!") && cell.f) {
          delete cell.v;
          delete cell.w;
        }
    return XLSX.write(book, {
      type: "base64",
      bookType:
        /\.xls$/i.test(this.path) && !hasFormulas(book) ? "xls" : "xlsx",
      compression: true,
    });
  }
}
export function blankSpreadsheet(path: string): {
  text: string;
  binary?: boolean;
} {
  if (!isBinaryWorkbook(path)) return { text: "" };
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[""]]), "Sheet1");
  return {
    binary: true,
    text: XLSX.write(book, {
      type: "base64",
      bookType: /\.xls$/i.test(path) ? "xls" : "xlsx",
    }),
  };
}

function hasFormulas(book: XLSX.WorkBook) {
  return Object.values(book.Sheets).some((sheet) =>
    Object.entries(sheet).some(
      ([key, cell]) => !key.startsWith("!") && (cell.f || cell.F),
    ),
  );
}
export function assertWorkbookSave(path: string, text: string) {
  if (/\.xls$/i.test(path) && hasFormulas(XLSX.read(text, { type: "base64" })))
    throw new Error(
      "SheetJS CE cannot write formulas to legacy XLS. Use Save XLSX Copy to preserve them; the original XLS has not been modified.",
    );
}
export function xlsxCopy(text: string) {
  return {
    binary: true,
    text: XLSX.write(
      XLSX.read(text, { type: "base64", cellStyles: true, cellNF: true }),
      { type: "base64", bookType: "xlsx", compression: true },
    ),
  };
}
