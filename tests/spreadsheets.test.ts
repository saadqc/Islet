import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import {
  SpreadsheetSession,
  blankSpreadsheet,
  checkDimensions,
  assertWorkbookSave,
} from "../src/spreadsheets/workbook";
import { DocumentStore } from "../src/core/documents";
import { entryPath } from "../src/shell/NewEntryDialog";
import { validatePreferences } from "../src/settings/preferences";
// @ts-ignore The shared host is JavaScript and is also bundled into SSH helpers.
import { Engine } from "../remote-helper/engine.mjs";

test("CSV grid keeps identifiers, quotes, multiline values, ragged rows and delimiter", () => {
  const source =
    'id;name;notes\n0012;"مرحبا; world";"line one\nline two"\n0000;other\n';
  const editor = new SpreadsheetSession("data.csv", source);
  const grid = editor.data("Sheet1");
  assert.equal(grid[1][0], "0012");
  assert.equal(grid[1][2], "line one\nline two");
  grid[2][1] = "changed";
  const saved = editor.serialize("Sheet1", grid);
  assert.match(saved, /0000;changed\n$/);
  const read = new SpreadsheetSession("data.csv", saved);
  assert.equal(read.data("Sheet1")[1][0], "0012");
  assert.equal(read.data("Sheet1")[1][1], "مرحبا; world");
  assert.equal(read.data("Sheet1")[2].length, 2);
  grid[2][1] = "other";
  assert.equal(editor.serialize("Sheet1", grid), source);
  const ragged = new SpreadsheetSession(
    "ragged.csv",
    "a;b;c\n0012;x;y\n" + "\n".repeat(20) + ";;;;;;;;Added",
  );
  assert.equal(ragged.data("Sheet1")[1][0], "0012");
  const raw = new SpreadsheetSession(
    "raw.csv",
    "code,value\n=1+1,<img src=x onerror=alert(1)>",
  );
  assert.equal(raw.data("Sheet1")[1][0], "=1+1");
});
for (const extension of ["xls", "xlsx"])
  test(`${extension} edits round trip types, formulas and other sheets`, () => {
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["ID", "Amount", "Flag"],
      ["0007", 12.5, true],
    ]);
    sheet.D2 = { t: "n", f: "B2*2", v: 25 };
    sheet["!ref"] = "A1:D2";
    XLSX.utils.book_append_sheet(book, sheet, "First");
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([["keep", 98]]),
      "Second",
    );
    const source = XLSX.write(book, { type: "base64", bookType: extension });
    const editor = new SpreadsheetSession(`book.${extension}`, source),
      grid = editor.data("First");
    grid[1][1] = "20.5";
    const serialized = editor.serialize("First", grid);
    const saved = XLSX.read(serialized, { type: "base64" });
    assert.equal(saved.Sheets.First.A2.v, "0007");
    assert.equal(saved.Sheets.First.B2.v, 20.5);
    assert.equal(saved.Sheets.First.C2.v, true);
    if (extension === "xlsx") assert.equal(saved.Sheets.First.D2.f, "B2*2");
    assert.equal(saved.Sheets.Second.B1.v, 98);
    const unchangedGrid = editor.data("First");
    unchangedGrid[1][1] = 12.5;
    assert.equal(editor.serialize("First", unchangedGrid), source);
    editor.serialize("First", grid);
    const second = editor.data("Second");
    second[0][1] = 99;
    const again = XLSX.read(editor.serialize("Second", second), {
      type: "base64",
    });
    assert.equal(again.Sheets.First.B2.v, 20.5);
    assert.equal(again.Sheets.Second.B1.v, 99);
    if (extension === "xls") {
      grid[1][3] = "=B2*2";
      const withFormula = editor.serialize("First", grid);
      assert.equal(
        XLSX.read(withFormula, { type: "base64" }).Sheets.First.D2.f,
        "B2*2",
      );
      assert.throws(
        () => assertWorkbookSave("book.xls", withFormula),
        /cannot write formulas/,
      );
    }
    const blank = blankSpreadsheet(`new.${extension}`);
    assert.equal(
      new SpreadsheetSession(`new.${extension}`, blank.text).names[0],
      "Sheet1",
    );
  });

test("creation names and stored folder preference validate without path traversal", () => {
  assert.equal(entryPath("/project/", "new.csv"), "/project/new.csv");
  for (const name of [
    "",
    "..",
    ".",
    "../other",
    "a/b",
    "a\\b",
    "a\nfile",
    " x ",
  ])
    assert.throws(() => entryPath("/project", name));
  assert.equal(validatePreferences({}).folderOpenMode, "double");
  assert.equal(
    validatePreferences({ folderOpenMode: "single" }).folderOpenMode,
    "single",
  );
  assert.equal(
    validatePreferences({ folderOpenMode: "bad" } as any).folderOpenMode,
    "double",
  );
  assert.throws(() => checkDimensions(5001, 1), /limit/);
  assert.throws(() => checkDimensions(500, 256), /limit/);
  assert.throws(
    () => new SpreadsheetSession("broken.csv", 'a,"unterminated'),
    /malformed/,
  );
});

test("binary workbooks use guarded atomic saves, verified original backups, recovery and conflicts", async (t) => {
  const dir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "islet-workbook-test-")),
  );
  const engine = new Engine({ dataDir: path.join(dir, ".state") });
  t.after(async () => {
    await engine.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  await engine.request("root.open", { path: dir });
  const transport = (operation: string, payload: any) =>
    engine.request(operation, payload);
  const store = new DocumentStore(transport as any);
  const file = path.join(dir, "book.xlsx"),
    content = blankSpreadsheet(file);
  await engine.request("fs.create", { path: file, ...content });
  await assert.rejects(
    engine.request("fs.create", { path: file, ...content }),
    /exist/i,
  );
  await fs.chmod(file, 0o640);
  const original = await fs.readFile(file);
  const doc = await store.open("local", file);
  assert.equal(doc.binary, true);
  assert.equal(doc.spreadsheet, true);
  const editor = new SpreadsheetSession(file, doc.text);
  store.change(doc.id, editor.serialize("Sheet1", [["changed", 42]]));
  const recovered = new DocumentStore(transport as any);
  recovered.restore(store.snapshot());
  assert.equal(recovered.require(doc.id).dirty, true);
  await recovered.save(doc.id);
  assert.equal(XLSX.read(await fs.readFile(file)).Sheets.Sheet1.B1.v, 42);
  assert.equal((await fs.stat(file)).mode & 0o777, 0o640);
  const folders = await fs.readdir(path.join(dir, ".state/workbook-backups"));
  const backupDir = path.join(dir, ".state/workbook-backups", folders[0]);
  const backups = await fs.readdir(backupDir);
  assert.deepEqual(
    await fs.readFile(path.join(backupDir, backups[0])),
    original,
  );
  // An old editor must not overwrite the newer workbook.
  await assert.rejects(store.save(doc.id), /changed on disk/);
  store.resolveConflict(doc.id, "reload");
  assert.equal(store.require(doc.id).dirty, false);
  await fs.writeFile(file, original);
  await store.checkExternal(doc.id);
  assert.equal(store.require(doc.id).text, content.text);
  // Canonical scoping also applies to creation and binary saves.
  await assert.rejects(
    engine.request("fs.create", {
      path: path.join(os.tmpdir(), "outside-islet.xlsx"),
      ...content,
    }),
    /outside attached/,
  );
  await engine.request("fs.create", {
    path: path.join(dir, "folder"),
    directory: true,
  });
  assert.equal((await fs.stat(path.join(dir, "folder"))).isDirectory(), true);
  await assert.rejects(
    engine.request("file.save", {
      path: file,
      text: "bad!",
      binary: true,
      expectedRevision: (
        await engine.request("file.read", { path: file, binary: true })
      ).revision,
    }),
    /Invalid workbook/,
  );
  assert.deepEqual(await fs.readFile(file), original);
});

test("binary uncertain saves reconcile by bytes and corrupt backups block writes", async (t) => {
  const dir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "islet-workbook-recovery-")),
  );
  const engine = new Engine({ dataDir: path.join(dir, ".state") });
  t.after(async () => {
    await engine.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  await engine.request("root.open", { path: dir });
  const file = path.join(dir, "book.xlsx"),
    content = blankSpreadsheet(file);
  await engine.request("fs.create", { path: file, ...content });
  let loseReply = true;
  const store = new DocumentStore(async (op: string, payload: any) => {
    const result = await engine.request(op, payload);
    if (op === "file.save" && loseReply) {
      loseReply = false;
      throw Object.assign(new Error("Connection lost"), {
        code: "SAVE_UNCERTAIN",
      });
    }
    return result;
  });
  const doc = await store.open("local", file);
  const session = new SpreadsheetSession(file, doc.text);
  store.change(doc.id, session.serialize("Sheet1", [["recovered"]]));
  await assert.rejects(store.save(doc.id), /Connection lost/);
  assert.equal(doc.saveState, "uncertain");
  await store.checkExternal(doc.id);
  assert.equal(doc.saveState, "saved");
  assert.equal(doc.dirty, false);
  // Backups are verified before any replacement, including an existing backup.
  await fs.writeFile(file, Buffer.from(content.text, "base64"));
  await store.checkExternal(doc.id);
  const folders = await fs.readdir(path.join(dir, ".state/workbook-backups"));
  const backupDir = path.join(dir, ".state/workbook-backups", folders[0]);
  const names = await fs.readdir(backupDir);
  await fs.writeFile(path.join(backupDir, names[0]), "corrupted backup");
  store.change(doc.id, session.serialize("Sheet1", [["must not overwrite"]]));
  await assert.rejects(store.save(doc.id), /backup could not be verified/);
  assert.equal((await fs.readFile(file)).toString("base64"), content.text);
});
