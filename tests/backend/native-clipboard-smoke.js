(async () => {
  const call = (operation, payload = {}) =>
    window.__TAURI_INTERNALS__.invoke("host_request", { operation, payload });
  const wait = async (fn) => {
    for (let i = 0; i < 200; i++) {
      const value = fn();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw Error("Native clipboard test timed out");
  };
  const report = { passed: false };
  try {
    await call("app.testWindow", { focus: true });
    await call("updater.configure", { autoCheck: false, autoDownload: false });
    const recent = await wait(() =>
      document.querySelector(".recent-projects button"),
    );
    recent.click();
    const root = await wait(() =>
      document.querySelector('.tree-row[data-root="true"]'),
    );
    if (root.getAttribute("aria-expanded") === "false")
      root.querySelector(".tree-chevron").click();
    const file = await wait(() =>
      document.querySelector('.tree-row[aria-label="notes.txt"]'),
    );
    file.click();
    const content = await wait(() => document.querySelector(".cm-content"));
    const view = content.cmTile.root.view;
    const text = "Native paste café اردو\nPermission-free clipboard";
    await call("desktop.clipboard.writeText", { text });
    if (navigator.clipboard)
      Object.defineProperty(navigator.clipboard, "readText", {
        configurable: true,
        value: async () => {
          throw Error("Restricted web Clipboard API was called");
        },
      });
    view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
    view.focus();
    content.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 500,
        clientY: 200,
      }),
    );
    const paste = await wait(() =>
      document.querySelector('[role="menuitem"][aria-label="Paste"]'),
    );
    paste.click();
    await wait(() => view.state.doc.toString() === text);
    report.passed = true;
    report.check =
      "Native editor context-menu paste succeeds with web Clipboard API blocked";
  } catch (error) {
    report.error = String(error) + "\n" + String(error.stack || "");
  }
  await call("session.save", { key: "native-clipboard-result", value: report });
})();
