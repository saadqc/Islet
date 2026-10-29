// Debug-only WKWebView qualification; launches with a disposable ISLET_DATA_DIR.
(async () => {
  const call = (operation, payload = {}) =>
    window.__TAURI_INTERNALS__.invoke("host_request", { operation, payload });
  const wait = async (predicate) => {
    for (let i = 0; i < 200; i++) {
      const result = await predicate();
      if (result) return result;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("Native spreadsheet condition timed out");
  };
  const report = {
    platform: "macOS WKWebView",
    origin: location.origin,
    checks: [],
    limitations: [
      "Synthetic DOM and grid transactions; physical keyboard/clipboard/IME input is not certified.",
    ],
  };
  try {
    const info = await call("app.info");
    const root = info.dataDir.replace(/\/data$/, "/files");
    await call("updater.configure", { autoCheck: false, autoDownload: false });
    if (location.port === "1420")
      throw new Error("Expected bundled assets, not the development server");
    const tree = (name) =>
      [...document.querySelectorAll(".tree-row")].find(
        (row) => row.getAttribute("aria-label") === name,
      );
    const project = await wait(() =>
      document.querySelector('.tree-row[data-root="true"]'),
    );
    if (project.getAttribute("aria-expanded") === "false")
      project.querySelector(".tree-chevron").click();
    for (const name of ["native.csv", "native.xls", "native.xlsx"]) {
      await wait(() => tree(name));
      tree(name).click();
      const table = await wait(
        () =>
          document.querySelector(".tab.active")?.textContent.includes(name) &&
          document.querySelector(".jss_worksheet"),
      );
      let element = table,
        grid;
      while (element && !grid) {
        const candidate = element.jssWorksheet || element.jspreadsheet;
        if (candidate?.setValueFromCoords) grid = candidate;
        element = element.parentElement;
      }
      if (!grid) throw new Error("Native grid instance unavailable");
      const before = await call("file.read", {
        hostId: "local",
        path: root + "/" + name,
        ...(name.endsWith(".csv") ? {} : { binary: true }),
      });
      grid.setValueFromCoords(1, 1, "42.75");
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "s",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await wait(async () => {
        const file = await call("file.read", {
          hostId: "local",
          path: root + "/" + name,
          ...(name.endsWith(".csv") ? {} : { binary: true }),
        });
        return file.revision !== before.revision;
      });
      report.checks.push(
        name +
          ": bundled editor, editable grid and revision-checked Tauri IPC save",
      );
    }
    // Create and rename a sheet in the real bundled WKWebView.
    document.querySelector('[aria-label="Create sheet"]').click();
    let sheetDialog = await wait(() =>
      document.querySelector('[role="dialog"][aria-label="Create Sheet"]'),
    );
    let sheetInput = sheetDialog.querySelector(
      'input[aria-label="Sheet name"]',
    );
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set.call(sheetInput, "Native Sheet");
    sheetInput.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    sheetDialog.querySelector("form").requestSubmit();
    await wait(
      () =>
        document.querySelector('[aria-label="Worksheet"]')?.value ===
          "Native Sheet" && !document.querySelector('[role="dialog"]'),
    );
    const actions = document.querySelector('[aria-label="Sheet actions"]');
    actions.value = "rename";
    actions.dispatchEvent(new Event("change", { bubbles: true }));
    sheetDialog = await wait(() =>
      document.querySelector('[role="dialog"][aria-label="Rename Sheet"]'),
    );
    sheetInput = sheetDialog.querySelector('input[aria-label="Sheet name"]');
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set.call(sheetInput, "Native Renamed");
    sheetInput.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    sheetDialog.querySelector("form").requestSubmit();
    await wait(
      () =>
        document.querySelector('[aria-label="Worksheet"]')?.value ===
          "Native Renamed" && !document.querySelector('[role="dialog"]'),
    );
    const priorSheetSave = await call("file.read", {
      hostId: "local",
      path: root + "/native.xlsx",
      binary: true,
    });
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "s",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await wait(
      async () =>
        (
          await call("file.read", {
            hostId: "local",
            path: root + "/native.xlsx",
            binary: true,
          })
        ).revision !== priorSheetSave.revision,
    );
    report.checks.push("Native create/rename sheet dialogs and workbook save");
    tree("files").click();
    document.querySelector('.project-header [aria-label="New Folder"]').click();
    const dialog = await wait(() =>
      document.querySelector('[role="dialog"][aria-label="New Folder"]'),
    );
    const input = dialog.querySelector('input[aria-label="Folder name"]');
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set.call(input, "native-created");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    dialog.querySelector("form").requestSubmit();
    await wait(() => !document.querySelector('[role="dialog"]'));
    if (
      !(
        await call("fs.stat", {
          hostId: "local",
          path: root + "/native-created",
        })
      ).isDirectory
    )
      throw new Error("Native folder creation failed");
    report.checks.push(
      "Native new-folder dialog creates through the scoped provider",
    );
    report.resources = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name);
    const external = report.resources.filter(
      (url) =>
        /^https?:/.test(url) &&
        !url.startsWith(location.origin + "/") &&
        !url.startsWith("http://ipc.localhost/"),
    );
    if (external.length)
      throw new Error(
        "Unexpected editor network resources: " + external.join(","),
      );
    report.passed = true;
  } catch (error) {
    report.passed = false;
    report.error = String(error) + " " + (error.stack || "");
  }
  await call("session.save", {
    key: "native-spreadsheets-validation",
    value: report,
  });
})();
