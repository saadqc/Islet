import * as XLSX from "xlsx";
import { isBinaryWorkbook } from "./formats";

export type SheetAction = "create" | "rename" | "duplicate" | "delete";
export function validateSheetName(
  name: string,
  names: string[],
  except?: string,
) {
  if (
    !name ||
    name.trim() !== name ||
    name.length > 31 ||
    /[\\/?*\[\]:\x00-\x1f\x7f]/.test(name) ||
    name.startsWith("'") ||
    name.endsWith("'")
  )
    throw new Error(
      "Use 1–31 characters, without surrounding spaces, leading/trailing apostrophes, or \\ / ? * [ ] : characters.",
    );
  if (name === "__proto__")
    throw new Error(
      "This name is reserved by the editor. Choose another sheet name.",
    );
  if (name.toLowerCase() === "history")
    throw new Error("History is reserved by Excel. Choose another sheet name.");
  if (
    names.some(
      (existing) =>
        existing !== except && existing.toLowerCase() === name.toLowerCase(),
    )
  )
    throw new Error("A sheet with this name already exists.");
}
export function suggestedSheetName(names: string[], original?: string) {
  const base = original
    ? Array.from(original).reduce(
        (value, char) =>
          value.length + char.length <= 24 ? value + char : value,
        "",
      ) + " Copy"
    : "Sheet";
  for (let i = original ? 0 : 1; ; i++) {
    const name = base + (i ? (original ? " " : "") + i : "");
    if (
      !names.some((existing) => existing.toLowerCase() === name.toLowerCase())
    )
      return name;
  }
}

/** Rewrite sheet tokens, leaving quoted strings and external workbook links intact. */
export function rewriteSheetReferences(
  formula: string,
  oldName: string,
  newName?: string,
) {
  const replace = (token: string, original: string) => {
    if (token.includes("[") || token.includes("]")) return original;
    const names = token.split(":");
    if (!names.some((name) => name.toLowerCase() === oldName.toLowerCase()))
      return original;
    if (newName === undefined) return "#REF!";
    return (
      "'" +
      names
        .map((name) =>
          name.toLowerCase() === oldName.toLowerCase() ? newName : name,
        )
        .join(":")
        .replaceAll("'", "''") +
      "'!"
    );
  };
  let result = "",
    i = 0;
  while (i < formula.length) {
    const start = i;
    if (formula[i] === '"') {
      i++;
      while (i < formula.length) {
        if (formula[i++] === '"') {
          if (formula[i] === '"') i++;
          else break;
        }
      }
      result += formula.slice(start, i);
    } else if (formula[i] === "'") {
      let token = "";
      i++;
      while (i < formula.length) {
        if (formula[i] === "'") {
          i++;
          if (formula[i] === "'") {
            token += "'";
            i++;
          } else break;
        } else token += formula[i++];
      }
      if (formula[i] === "!") {
        i++;
        result += replace(token, formula.slice(start, i));
      } else result += formula.slice(start, i);
    } else if (formula[i] === "[") {
      // Skip an external workbook prefix and its following unquoted sheet name.
      const end = formula.indexOf("]", i);
      if (end === -1) {
        result += formula[i++];
        continue;
      }
      i = end + 1;
      while (i < formula.length && /[\p{L}\p{N}_.$:]/u.test(formula[i])) i++;
      if (formula[i] === "!") i++;
      result += formula.slice(start, i);
    } else if (/[\p{L}\p{N}_.$]/u.test(formula[i])) {
      while (i < formula.length && /[\p{L}\p{N}_.$:]/u.test(formula[i])) i++;
      const token = formula.slice(start, i);
      if (formula[i] === "!") {
        i++;
        result += replace(token, formula.slice(start, i));
      } else result += token;
    } else result += formula[i++];
  }
  return result;
}
function rewriteSheet(
  sheet: XLSX.WorkSheet,
  oldName: string,
  newName?: string,
) {
  for (const [key, cell] of Object.entries(sheet)) {
    if (key.startsWith("!")) continue;
    if (cell.f) {
      cell.f = rewriteSheetReferences(cell.f, oldName, newName);
      delete cell.v;
      delete cell.w;
    }
    if (cell.l?.Target?.startsWith("#"))
      cell.l.Target =
        "#" + rewriteSheetReferences(cell.l.Target.slice(1), oldName, newName);
  }
}
export function changeWorkbookSheets(
  path: string,
  source: string,
  action: SheetAction,
  sheet: string,
  name = "",
) {
  if (!isBinaryWorkbook(path))
    throw new Error(
      "CSV supports a single sheet. Use an XLS/XLSX workbook for multiple sheets.",
    );
  const book = XLSX.read(source, {
    type: "base64",
    cellStyles: true,
    cellNF: true,
    bookVBA: true,
  });
  const index = book.SheetNames.indexOf(sheet);
  if (index === -1) throw new Error("This worksheet no longer exists.");
  if (action !== "delete")
    validateSheetName(
      name,
      book.SheetNames,
      action === "rename" ? sheet : undefined,
    );
  if (action === "rename" && name === sheet)
    throw new Error("Enter a different sheet name.");
  if (
    (action === "create" || action === "duplicate") &&
    book.SheetNames.length >= 128
  )
    throw new Error("Workbooks are limited to 128 sheets in this editor.");
  const metadata = book.Workbook?.Sheets;
  let active = name;
  if (action === "create" || action === "duplicate") {
    const added =
      action === "create"
        ? XLSX.utils.aoa_to_sheet([[""]])
        : structuredClone(book.Sheets[sheet]);
    if (action === "duplicate") rewriteSheet(added, sheet, name);
    XLSX.utils.book_append_sheet(book, added, name);
    if (metadata) metadata.push({ name, Hidden: 0 });
    if (action === "duplicate" && book.Workbook?.Names) {
      const locals = book.Workbook.Names.filter(
        (item) => item.Sheet === index,
      ).map((item) => ({
        ...item,
        Sheet: book.SheetNames.length - 1,
        Ref: rewriteSheetReferences(item.Ref, sheet, name),
      }));
      book.Workbook.Names.push(...locals);
    }
  } else if (action === "rename") {
    book.SheetNames[index] = name;
    book.Sheets[name] = book.Sheets[sheet];
    delete book.Sheets[sheet];
    if (metadata?.[index]) metadata[index].name = name;
    for (const worksheet of Object.values(book.Sheets))
      rewriteSheet(worksheet, sheet, name);
    for (const defined of book.Workbook?.Names || [])
      defined.Ref = rewriteSheetReferences(defined.Ref, sheet, name);
  } else {
    const visible = book.SheetNames.filter((_, i) => !metadata?.[i]?.Hidden);
    if (
      book.SheetNames.length <= 1 ||
      (visible.length <= 1 && visible.includes(sheet))
    )
      throw new Error("Keep at least one visible sheet in the workbook.");
    book.SheetNames.splice(index, 1);
    delete book.Sheets[sheet];
    metadata?.splice(index, 1);
    for (const worksheet of Object.values(book.Sheets))
      rewriteSheet(worksheet, sheet);
    if (book.Workbook?.Names)
      book.Workbook.Names = book.Workbook.Names.filter(
        (item) => item.Sheet !== index,
      ).map((item) => ({
        ...item,
        Sheet:
          item.Sheet !== undefined && item.Sheet > index
            ? item.Sheet - 1
            : item.Sheet,
        Ref: rewriteSheetReferences(item.Ref, sheet),
      }));
    active = book.SheetNames[Math.min(index, book.SheetNames.length - 1)];
  }
  let formulas = false;
  for (const worksheet of Object.values(book.Sheets))
    for (const [key, cell] of Object.entries(worksheet))
      if (!key.startsWith("!") && cell.f) {
        formulas = true;
        delete cell.v;
        delete cell.w;
      }
  return {
    name: active,
    text: XLSX.write(book, {
      type: "base64",
      bookType: /\.xls$/i.test(path) && !formulas ? "xls" : "xlsx",
      compression: true,
    }),
  };
}
