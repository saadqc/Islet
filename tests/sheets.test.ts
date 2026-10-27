import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  changeWorkbookSheets,
  rewriteSheetReferences,
  validateSheetName,
  suggestedSheetName,
} from "../src/spreadsheets/sheets";
import { blankSpreadsheet } from "../src/spreadsheets/workbook";

test("sheet names reject case-insensitive duplicates and Excel-invalid names", () => {
  for (const name of [
    "",
    " x ",
    "a/b",
    "a:b",
    "a?b",
    "a*b",
    "a[b]",
    "a\\b",
    "'leading",
    "trailing'",
    "History",
    "__proto__",
    "x".repeat(32),
  ])
    assert.throws(() => validateSheetName(name, []));
  assert.throws(() => validateSheetName("FIRST", ["First"]), /already exists/);
  validateSheetName("FIRST", ["First"], "First");
  validateSheetName("Owner's Plan", []);
  assert.equal(suggestedSheetName(["Sheet1", "sheet2"]), "Sheet3");
  assert.equal(suggestedSheetName(["First Copy"], "First"), "First Copy 1");
});
test("sheet references rewrite tokens without touching strings or external workbook references", () => {
  const formula = `SUM(First!A1,'First'!B2,First:Last!C3,"First!A1",'[book.xlsx]First'!A1,[book.xlsx]First!A1,OtherFirst!A1)`;
  assert.equal(
    rewriteSheetReferences(formula, "First", "Owner's Plan"),
    `SUM('Owner''s Plan'!A1,'Owner''s Plan'!B2,'Owner''s Plan:Last'!C3,"First!A1",'[book.xlsx]First'!A1,[book.xlsx]First!A1,OtherFirst!A1)`,
  );
  assert.equal(
    rewriteSheetReferences(`'Owner''s Plan'!A1`, "Owner's Plan", "Renamed"),
    "'Renamed'!A1",
  );
  assert.equal(
    rewriteSheetReferences("First!A1+Other!A1", "First"),
    "#REF!A1+Other!A1",
  );
});
for (const extension of ["xls", "xlsx"])
  test(`${extension} creates, renames, duplicates and deletes sheets with data intact`, () => {
    const path = `book.${extension}`;
    let result = changeWorkbookSheets(
      path,
      blankSpreadsheet(path).text,
      "create",
      "Sheet1",
      "Data",
    );
    let book = XLSX.read(result.text, { type: "base64" });
    book.Sheets.Data = XLSX.utils.aoa_to_sheet([["0012", 42]]);
    result = {
      name: "Data",
      text: XLSX.write(book, { type: "base64", bookType: extension }),
    };
    result = changeWorkbookSheets(
      path,
      result.text,
      "rename",
      "Data",
      "Owner's Plan",
    );
    result = changeWorkbookSheets(
      path,
      result.text,
      "duplicate",
      "Owner's Plan",
      "Copy",
    );
    book = XLSX.read(result.text, { type: "base64" });
    assert.deepEqual(book.SheetNames, ["Sheet1", "Owner's Plan", "Copy"]);
    assert.equal(book.Sheets.Copy.A1.v, "0012");
    assert.equal(book.Sheets.Copy.B1.v, 42);
    result = changeWorkbookSheets(path, result.text, "delete", "Owner's Plan");
    assert.deepEqual(XLSX.read(result.text, { type: "base64" }).SheetNames, [
      "Sheet1",
      "Copy",
    ]);
    assert.throws(
      () =>
        changeWorkbookSheets(
          path,
          blankSpreadsheet(path).text,
          "delete",
          "Sheet1",
        ),
      /at least one visible/,
    );
  });
test("renaming/deleting sheets updates formulas, local names and internal links", () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[12]]), "First");
  const other = XLSX.utils.aoa_to_sheet([["link"]]);
  other.A1.l = { Target: "#First!A1" };
  other.B1 = { t: "n", f: "First!A1*2", v: 24 };
  other["!ref"] = "A1:B1";
  XLSX.utils.book_append_sheet(book, other, "Other");
  book.Workbook = {
    Names: [
      { Name: "local", Sheet: 0, Ref: "First!$A$1" },
      { Name: "other", Sheet: 1, Ref: "First!$A$1" },
    ],
  };
  let changed = changeWorkbookSheets(
    "book.xlsx",
    XLSX.write(book, { type: "base64", bookType: "xlsx" }),
    "rename",
    "First",
    "New Name",
  );
  let saved = XLSX.read(changed.text, { type: "base64" });
  assert.equal(saved.Sheets.Other.B1.f, "'New Name'!A1*2");
  assert.equal(saved.Sheets.Other.A1.l?.Target, "#'New Name'!A1");
  assert.equal(saved.Workbook?.Names?.[0].Ref, "'New Name'!$A$1");
  changed = changeWorkbookSheets(
    "book.xlsx",
    changed.text,
    "delete",
    "New Name",
  );
  saved = XLSX.read(changed.text, { type: "base64" });
  assert.equal(saved.Sheets.Other.B1.f, "#REF!A1*2");
  assert.equal(saved.Workbook?.Names?.length, 1);
  assert.equal(saved.Workbook?.Names?.[0].Sheet, 0);
});
