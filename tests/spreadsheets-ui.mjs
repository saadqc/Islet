import { openFixtureRoots } from "./project-tree-helper.mjs";
import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";

const fixture = await fs.realpath(
  await fs.mkdtemp(path.join(os.tmpdir(), "islet-spreadsheet-ui-")),
);
const evidence = path.join(
  os.homedir(),
  "islet-ui-screens",
  "offline-spreadsheets-20261027",
);
await fs.mkdir(evidence, { recursive: true });
await fs.mkdir(path.join(fixture, "nested"));
await fs.writeFile(path.join(fixture, "nested", "inside.txt"), "nested file\n");
await fs.writeFile(
  path.join(fixture, "data.csv"),
  "\uFEFFid;name;amount\r\n0012;Original;12\r\n0000;Other;7\r\n",
);
await fs.writeFile(path.join(fixture, "notes.txt"), "text still works\n");
for (const type of ["xls", "xlsx"]) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      ["Code", "Amount"],
      ["0007", 12.5],
    ]),
    "First",
  );
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([["Unchanged", true]]),
    "Second",
  );
  await fs.writeFile(
    path.join(fixture, "book." + type),
    XLSX.write(book, { bookType: type, type: "buffer" }),
  );
}
let preferences = {},
  browser;
const saved = new Map(),
  errors = [],
  external = [];
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.ISLET_CHROMIUM || chromium.executablePath(),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error("BROWSER", msg.text());
  });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
      external.push(url.href);
      return route.abort();
    }
    if (url.pathname === "/host/request") {
      const { operation, payload = {} } = route.request().postDataJSON();
      let result;
      if (operation === "settings.load") result = preferences;
      else if (operation === "settings.save") {
        preferences = payload.value;
        result = true;
      } else if (operation === "session.load")
        result = saved.get(payload.key) || null;
      else if (operation === "session.save") {
        saved.set(payload.key, payload.value);
        result = true;
      } else if (
        operation === "session.list" ||
        operation === "app.pendingRequests"
      )
        result = [];
      else if (operation === "session.register") result = true;
      else return route.continue();
      return route.fulfill({ json: { result } });
    }
    if (url.pathname.startsWith("/assets/")) {
      const filename = path.basename(url.pathname);
      return route.fulfill({
        body: await fs.readFile(path.join("dist/assets", filename)),
        contentType: filename.endsWith(".css")
          ? "text/css"
          : filename.endsWith(".js")
            ? "application/javascript"
            : "font/woff2",
      });
    }
    if (url.pathname === "/") {
      return route.fulfill({
        body: await fs.readFile("dist/index.html", "utf8"),
        contentType: "text/html",
        headers: {
          "content-security-policy":
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'",
        },
      });
    }
    return route.continue();
  });
  const tree = (name) =>
    page.locator(".tree-name").getByText(name, { exact: true });
  const open = async (name) => {
    await tree(name).click();
    await expect(page.locator(".tab.active")).toContainText(name);
  };
  const cell = (x, y) =>
    page.locator(`.jss_worksheet tbody td[data-x="${x}"][data-y="${y}"]`);
  const edit = async (x, y, value) => {
    await cell(x, y).dblclick();
    const input = cell(x, y).locator("input, textarea");
    await expect(input).toBeVisible();
    await input.fill(value);
    await page.keyboard.press("Enter");
    await expect(cell(x, y)).toHaveText(value);
  };
  const create = async (directory, name) => {
    await page
      .getByRole("button", {
        name: directory ? "New Folder" : "New File",
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog", {
      name: directory ? "New Folder" : "New File",
      exact: true,
    });
    await dialog
      .getByLabel(directory ? "Folder name" : "File name", { exact: true })
      .fill(name);
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  };
  await openFixtureRoots(page);
  await page.goto("http://127.0.0.1:1420/?root=" + encodeURIComponent(fixture));
  await tree("data.csv").waitFor();
  // Folder labels select on one click and expand exactly once on double click.
  await tree("nested").click();
  await expect(tree("inside.txt")).toHaveCount(0);
  await tree("nested").dblclick();
  await expect(tree("inside.txt")).toBeVisible();
  await tree("nested").dblclick();
  await expect(tree("inside.txt")).toHaveCount(0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Expand folders with").selectOption("single");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await tree("nested").click();
  await expect(tree("inside.txt")).toBeVisible();
  await tree("nested").click();
  await expect(tree("inside.txt")).toHaveCount(0);
  assert.equal(preferences.folderOpenMode, "single");
  await open("data.csv");
  await expect(
    page.getByRole("region", { name: "Spreadsheet editor" }),
  ).toBeVisible();
  await expect(cell(0, 1)).toHaveText("0012");
  await edit(1, 1, "Changed");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(cell(1, 1)).toHaveText("Original");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(cell(1, 1)).toHaveText("Changed");
  await page.keyboard.press("ControlOrMeta+s");
  await expect
    .poll(() => fs.readFile(path.join(fixture, "data.csv"), "utf8"))
    .toContain("0012;Changed;12\r\n");
  assert.ok(
    (await fs.readFile(path.join(fixture, "data.csv")))
      .subarray(0, 3)
      .equals(Buffer.from([239, 187, 191])),
  );
  await page.screenshot({ path: path.join(evidence, "csv-dark-1440.png") });
  await page.getByRole("button", { name: "Row", exact: true }).click();
  await page.getByRole("button", { name: "Column", exact: true }).click();
  await edit(8, 20, "Added");
  await page.keyboard.press("ControlOrMeta+s");
  await expect
    .poll(() => fs.readFile(path.join(fixture, "data.csv"), "utf8"))
    .toContain("Added");
  for (const type of ["xls", "xlsx"]) {
    await open("book." + type);
    await expect(cell(0, 1)).toHaveText("0007");
    await edit(1, 1, "37.25");
    await page.getByLabel("Worksheet", { exact: true }).selectOption("Second");
    await expect(cell(0, 0)).toHaveText("Unchanged");
    await page.getByLabel("Worksheet", { exact: true }).selectOption("First");
    await expect(cell(1, 1)).toHaveText("37.25");
    await page.keyboard.press("ControlOrMeta+s");
    await expect
      .poll(
        async () =>
          XLSX.read(await fs.readFile(path.join(fixture, "book." + type)))
            .Sheets.First.B2.v,
      )
      .toBe(37.25);
  }
  // Sheet lifecycle is an unsaved workbook change and participates in Undo/Redo.
  const manageSheet = async (action, name) => {
    if (action === "create")
      await page
        .getByRole("button", { name: "Create sheet", exact: true })
        .click();
    else
      await page
        .getByLabel("Sheet actions", { exact: true })
        .selectOption(action);
    const title = {
      create: "Create Sheet",
      rename: "Rename Sheet",
      duplicate: "Duplicate Sheet",
      delete: "Delete Sheet",
    }[action];
    const dialog = page.getByRole("dialog", { name: title, exact: true });
    if (action !== "delete")
      await dialog.getByLabel("Sheet name", { exact: true }).fill(name);
    await dialog
      .getByRole("button", {
        name: action === "delete" ? "Delete Sheet" : "Apply",
        exact: true,
      })
      .click();
    await expect(dialog).toHaveCount(0);
  };
  await manageSheet("create", "Budget");
  await expect(page.getByLabel("Worksheet", { exact: true })).toHaveValue(
    "Budget",
  );
  await edit(0, 0, "Rent");
  await page.getByLabel("Worksheet", { exact: true }).selectOption("First");
  await edit(2, 1, "=Budget!A1");
  await page.getByLabel("Worksheet", { exact: true }).selectOption("Budget");
  await manageSheet("rename", "Budget 2026");
  await manageSheet("duplicate", "Budget Copy");
  await expect(cell(0, 0)).toHaveText("Rent");
  await manageSheet("delete");
  await expect(
    page.getByLabel("Worksheet", { exact: true }).locator("option"),
  ).toHaveCount(3);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByLabel("Worksheet", { exact: true })).toHaveValue(
    "Budget Copy",
  );
  await expect(cell(0, 0)).toHaveText("Rent");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(
    page.getByLabel("Worksheet", { exact: true }).locator("option"),
  ).toHaveCount(3);
  await page.keyboard.press("ControlOrMeta+s");
  await expect
    .poll(
      async () =>
        XLSX.read(await fs.readFile(path.join(fixture, "book.xlsx")))
          .SheetNames,
    )
    .toEqual(["First", "Second", "Budget 2026"]);
  assert.equal(
    XLSX.read(await fs.readFile(path.join(fixture, "book.xlsx"))).Sheets.First
      .C2.f,
    "'Budget 2026'!A1",
  );
  await page.getByLabel("Worksheet", { exact: true }).selectOption("First");
  // Legacy formula edits must never be silently flattened by XLS export.
  await open("book.xls");
  await edit(2, 1, "=B2*2");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.locator(".notification")).toContainText(
    "cannot write formulas",
  );
  await page
    .getByRole("button", { name: "Save XLSX Copy…", exact: true })
    .click();
  const copyDialog = page.getByRole("dialog", {
    name: "Save XLSX Copy",
    exact: true,
  });
  await copyDialog
    .getByLabel("File name", { exact: true })
    .fill("formulas.xlsx");
  await copyDialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(copyDialog).toHaveCount(0);
  assert.equal(
    XLSX.read(await fs.readFile(path.join(fixture, "formulas.xlsx"))).Sheets
      .First.C2.f,
    "B2*2",
  );
  assert.equal(
    XLSX.read(await fs.readFile(path.join(fixture, "book.xls"))).Sheets.First
      .C2,
    undefined,
  );
  await page
    .getByRole("button", { name: "Dismiss message", exact: true })
    .click();
  await open("data.csv");
  await page
    .getByRole("button", { name: "Edit CSV Source", exact: true })
    .click();
  await expect(page.locator(".cm-content")).toContainText("Changed");
  await page.getByRole("button", { name: "Show Grid", exact: true }).click();
  await expect(cell(0, 1)).toHaveText("0012");
  await open("book.xlsx");
  // A draft in the active cell is part of recovery before Enter or blur.
  await cell(1, 1).dblclick();
  await cell(1, 1).locator("input, textarea").fill("Live cell draft");
  await expect
    .poll(() =>
      [...saved.values()].some((value) =>
        value.documents?.some(
          (d) =>
            d.path.endsWith("book.xlsx") &&
            d.dirty &&
            XLSX.read(d.text, { type: "base64" }).Sheets.First.B2.v ===
              "Live cell draft",
        ),
      ),
    )
    .toBe(true);
  await page.reload();
  await expect(cell(1, 1)).toHaveText("Live cell draft");
  // Unsaved workbook edits survive reload through the actual session snapshot.
  await edit(1, 1, "88.5");
  await expect
    .poll(() =>
      [...saved.values()].some((value) =>
        value.documents?.some(
          (d) =>
            d.path.endsWith("book.xlsx") &&
            d.dirty &&
            XLSX.read(d.text, { type: "base64" }).Sheets.First.B2.v === 88.5,
        ),
      ),
    )
    .toBe(true);
  await page.reload();
  await expect(cell(1, 1)).toHaveText("88.5");
  await expect(page.locator(".app")).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+s");
  await expect
    .poll(
      async () =>
        XLSX.read(await fs.readFile(path.join(fixture, "book.xlsx"))).Sheets
          .First.B2.v,
    )
    .toBe(88.5);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Appearance").selectOption("light");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  for (const width of [1280, 1024, 768]) {
    await page.setViewportSize({ width, height: 820 });
    await expect(page.locator(".app")).toHaveCount(1);
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await page.screenshot({
      path: path.join(evidence, `workbook-light-${width}.png`),
      animations: "disabled",
    });
    assert.ok(await cell(0, 1).isVisible());
  }
  // Disk conflicts keep the unsaved grid until an explicit reload.
  await edit(1, 1, "99.5");
  const externallyChanged = XLSX.read(
    await fs.readFile(path.join(fixture, "book.xlsx")),
  );
  externallyChanged.Sheets.First.B2.v = 77;
  await fs.writeFile(
    path.join(fixture, "book.xlsx"),
    XLSX.write(externallyChanged, { type: "buffer", bookType: "xlsx" }),
  );
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.locator(".conflict-banner")).toContainText(
    "changed on disk",
  );
  await page
    .getByRole("button", { name: "Review conflict…", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Reload Disk Version", exact: true })
    .click();
  await expect(cell(1, 1)).toHaveText("77");
  await page
    .getByRole("button", { name: "Dismiss message", exact: true })
    .click();
  await page.setViewportSize({ width: 1280, height: 900 });
  // Creating into a selected nested folder, with duplicate protection.
  await tree("nested").click();
  await create(true, "created folder");
  assert.equal(
    (
      await fs.stat(path.join(fixture, "nested", "created folder"))
    ).isDirectory(),
    true,
  );
  await create(false, "created.xlsx");
  assert.equal(
    XLSX.read(await fs.readFile(path.join(fixture, "nested", "created.xlsx")))
      .SheetNames[0],
    "Sheet1",
  );
  await create(false, "created.xls");
  assert.equal(
    XLSX.read(await fs.readFile(path.join(fixture, "nested", "created.xls")))
      .SheetNames[0],
    "Sheet1",
  );
  await page.keyboard.press("ControlOrMeta+n");
  const dialog = page.getByRole("dialog", { name: "New File", exact: true });
  await dialog.getByLabel("File name", { exact: true }).fill("created.xls");
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(/exist/i);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await create(false, "created.csv");
  await edit(0, 0, "hello");
  await page.keyboard.press("ControlOrMeta+s");
  await expect
    .poll(() =>
      fs.readFile(path.join(fixture, "nested", "created.csv"), "utf8"),
    )
    .toBe("hello");
  await open("notes.txt");
  await expect(page.locator(".cm-content")).toContainText("text still works");
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    "PASS offline CSV/XLS/XLSX edits and disk round trips, BOM/CRLF, worksheet switching, undo/redo, recovery, creation/duplicates, configurable folder clicks, strict CSP, 1440/1280/1024/768 layouts; zero external requests.",
  );
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) {
    await page.screenshot({ path: path.join(evidence, "failure.png") });
    console.error((await page.locator("body").innerText()).slice(-1800));
  }
  throw error;
} finally {
  await browser?.close();
  await fs.rm(fixture, { recursive: true, force: true });
}
