(async () => {
  const call = (operation, payload = {}) =>
    window.__TAURI_INTERNALS__.invoke("host_request", { operation, payload });
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const wait = async (predicate) => {
    for (let i = 0; i < 200; i++) {
      const value = predicate();
      if (value) return value;
      await sleep(50);
    }
    throw new Error("Native UI condition timed out.");
  };
  const report = {
    platform: "macOS WKWebView",
    userAgent: navigator.userAgent,
    started: new Date().toISOString(),
    checks: [],
    limitations: [
      "Synthetic editor transactions validate WKWebView rendering and Tauri IPC; physical IME/dead-key and trackpad gestures require human verification.",
    ],
  };
  try {
    await wait(() => window.__TAURI_INTERNALS__);
    const info = await call("app.info");
    report.runtime = info;
    report.checks.push("Native Tauri-to-Node IPC and bundled runtime");
    const project = await wait(() =>
      document.querySelector('.tree-row[data-root="true"]'),
    );
    if (project.getAttribute("aria-expanded") === "false")
      project.querySelector(".tree-chevron").click();
    await wait(() =>
      [...document.querySelectorAll(".tree-row")].find((e) =>
        e.textContent.includes("main.py"),
      ),
    );
    [...document.querySelectorAll(".tree-row")]
      .find((e) => e.textContent.includes("main.py"))
      .click();
    await wait(() => document.querySelector(".cm-content"));
    await document.fonts.ready;
    const { EditorView } =
      await import("/node_modules/.vite/deps/@codemirror_view.js");
    const view = EditorView.findFromDOM(document.querySelector(".cm-editor"));
    if (!view) throw new Error("Native CodeMirror view unavailable.");
    report.codeFont = getComputedStyle(view.contentDOM).fontFamily;
    report.fontReady = document.fonts.check('13px "JetBrains Mono"');
    if (!report.fontReady) throw new Error("Bundled code font not ready");
    report.checks.push(
      "Bundled fonts and real CodeMirror surface in WKWebView",
    );
    const before = view.state.doc.toString();
    const inserted = "\n# café e\u0301 😃 اردو\n";
    view.dispatch({
      changes: { from: before.length, insert: inserted },
      selection: { anchor: before.length + inserted.length },
    });
    await sleep(120);
    if (view.state.doc.toString() !== before + inserted)
      throw new Error("Unicode insertion mismatch");
    view.focus();
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "z",
        code: "KeyZ",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await sleep(50);
    report.undo = { expected: before.length, actual: view.state.doc.length };
    if (view.state.doc.toString() !== before)
      throw new Error("Native editor undo mismatch");
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "z",
        code: "KeyZ",
        metaKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await sleep(50);
    report.redo = {
      expected: before.length + inserted.length,
      actual: view.state.doc.length,
    };
    if (view.state.doc.toString() !== before + inserted)
      throw new Error("Native editor redo mismatch");
    report.checks.push(
      "Unicode/combining marks/RTL insertion, selection, undo/redo",
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", metaKey: true, bubbles: true }),
    );
    await sleep(500);
    const saved = await call("fs.read", {
      hostId: "local",
      path: info.dataDir.replace(/native-data$/, "native-fixture/main.py"),
    });
    if (saved.text !== before + inserted)
      throw new Error("Native save did not persist editor text");
    report.checks.push(
      "Native application Save persisted Unicode text through revision-checked IPC",
    );
    const original = view.scrollDOM.scrollTop;
    view.scrollDOM.scrollTop = 100;
    const scroll = view.scrollDOM.scrollTop;
    if (scroll <= 0) throw new Error("Native scroll surface did not scroll");
    view.dispatch({
      selection: { anchor: 0 },
      effects: EditorView.scrollIntoView(0),
    });
    await sleep(80);
    report.scroll = {
      original,
      requested: 100,
      actual: scroll,
      returned: view.scrollDOM.scrollTop,
    };
    report.checks.push("WKWebView scroll surface and caret reveal");
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "F",
        metaKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
    await wait(() => document.querySelector('[role="dialog"]'));
    if (
      !document
        .querySelector('[role="dialog"]')
        .textContent.includes("Search in folder")
    )
      throw new Error("Search folder field is absent");
    report.checks.push("Native global Find dialog exposes Search in folder");
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    report.passed = true;
  } catch (error) {
    report.passed = false;
    report.error = String(error) + " " + (error.stack || "");
  }
  report.finished = new Date().toISOString();
  await call("session.save", { key: "native-validation", value: report });
})();
