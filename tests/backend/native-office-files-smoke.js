(async () => {
  const call = (operation, payload = {}) =>
    window.__TAURI_INTERNALS__.invoke("host_request", { operation, payload });
  const wait = async (predicate) => {
    for (let i = 0; i < 400; i++) {
      const result = await predicate();
      if (result) return result;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("Native office/file condition timed out");
  };
  const report = {
    platform: "macOS WKWebView",
    origin: location.origin,
    checks: [],
    limitations: [
      "Synthetic editor transactions; physical Finder drag and native Save As chooser interaction require manual testing.",
    ],
  };
  try {
    const info = await call("app.info"),
      root = info.dataDir.replace(/\/data$/, "/files");
    await call("updater.configure", { autoCheck: false, autoDownload: false });
    if (location.port === "1420") throw new Error("Expected bundled assets");
    const tree = (name) =>
      [...document.querySelectorAll(".tree-row")].find(
        (e) => e.getAttribute("aria-label") === name,
      );
    report.phase = "tree";
    report.dataDir = info.dataDir;
    await call("session.save", {
      key: "native-office-progress",
      value: report,
    });
    const args = await call("app.initialArgs");
    const standalone = args.some((value) => value.endsWith("/native.docx"));
    if (!standalone) {
      const project = await wait(() =>
        document.querySelector('.tree-row[data-root="true"]'),
      );
      if (project.getAttribute("aria-expanded") === "false")
        project.querySelector(".tree-chevron").click();
      await wait(() => tree("native.docx"));
      tree("native.docx").click();
    }
    report.phase = "docx ready";
    await call("session.save", {
      key: "native-office-progress",
      value: report,
    });
    await wait(() => document.querySelector(".docx-editor[data-ready=true]"));
    if (standalone) {
      if (document.querySelectorAll(".tree-row").length)
        throw new Error("Standalone file added a project folder");
      report.checks.push(
        "Selected DOCX opens directly without adding its parent folder",
      );
    }
    if (document.querySelector(".changes-bar"))
      throw new Error("Opening a DOCX must not mark it dirty");
    const zoomValue = document.querySelector(
      '[aria-label="Reset document zoom to 100%"]',
    );
    const page = await wait(() =>
      document.querySelector(".docx-editor .superdoc-page"),
    );
    const width = page.getBoundingClientRect().width;
    document.querySelector('[aria-label="Zoom in"]').click();
    await wait(
      () =>
        zoomValue.textContent === "110%" &&
        page.getBoundingClientRect().width > width + 40,
    );
    document.querySelector('[aria-label="Zoom out"]').click();
    await wait(() => zoomValue.textContent === "100%");
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "-",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await wait(() => zoomValue.textContent === "90%");
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "0",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await wait(() => zoomValue.textContent === "100%");
    if (document.querySelector(".changes-bar"))
      throw new Error("Zoom marked the document dirty");
    report.checks.push(
      "Visible native zoom controls resize the page; keyboard zoom/reset keeps the file clean",
    );
    report.phase = "DOCX input";
    const pm = await wait(() => document.querySelector(".ProseMirror"));
    pm.focus();
    if (!document.execCommand("insertText", false, "Native offline DOCX edit"))
      throw new Error("Native editing command failed");
    await wait(() => document.querySelector(".changes-bar"));
    const before = await call("file.read", {
      path: root + "/native.docx",
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
    await wait(async () => {
      const after = await call("file.read", {
        path: root + "/native.docx",
        binary: true,
      });
      return (
        after.revision !== before.revision &&
        !document.querySelector(".changes-bar")
      );
    });
    report.checks.push(
      "Bundled offline DOCX renders and edits, binary guarded save completes",
    );
    await call("root.open", {
      path: root,
      clientId: "native-transfer-fixture",
    });
    await call("desktop.clipboard.copyFiles", {
      hostId: "local",
      paths: [root + "/clipboard.txt", root + "/source-folder"],
    });
    const copied = await call("desktop.clipboard.readFiles");
    if (
      JSON.stringify(copied) !==
      JSON.stringify([root + "/clipboard.txt", root + "/source-folder"])
    )
      throw new Error(
        "Native file URL clipboard mismatch: " + JSON.stringify(copied),
      );
    const job = await call("files.copy", {
      sources: copied.map((path) => ({ hostId: "local", path })),
      target: { hostId: "local", path: root + "/target" },
    });
    await wait(async () => {
      const s = await call("files.status", { id: job.id });
      if (s.status === "failed") throw new Error(s.error);
      return s.status === "complete";
    });
    report.checks.push(
      "AppKit file URL clipboard round trip and file/folder copy via bundled runtime",
    );
    await call("session.save", {
      key: "native-office-stage",
      value: { ready: true },
    });
    await wait(() =>
      document
        .querySelector(".tab.active")
        ?.textContent.includes("associated.csv"),
    );
    await wait(() => document.querySelector(".jss_worksheet"));
    report.checks.push(
      "Native CLI positional file opens the selected CSV in the running window",
    );
    report.passed = true;
  } catch (error) {
    report.passed = false;
    report.error = String(error);
    report.dom = document.body.innerText.slice(-1800);
    report.stack = error.stack;
  }
  await call("session.save", {
    key: "native-office-files-validation",
    value: report,
  });
})();
