(async () => {
  const call = (operation, payload = {}) =>
    window.__TAURI_INTERNALS__.invoke("host_request", { operation, payload });
  if ((await call("app.windowId")) !== "main") return;
  const wait = async (fn) => {
    for (let i = 0; i < 400; i++) {
      const value = await fn();
      if (value) return value;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw Error("Native project test timed out");
  };
  const report = { checks: [], passed: false };
  const checkpoint = async (stage) =>
    call("session.save", {
      key: "native-projects-progress",
      value: { stage, ...report },
    });
  try {
    await call("app.testWindow", { focus: true });
    await checkpoint("welcome");
    await call("updater.configure", { autoCheck: false, autoDownload: false });
    await wait(
      () => document.querySelectorAll(".recent-projects button").length === 6,
    );
    const menu = await call("app.testDock");
    if (menu.length !== 4 || menu.some((name) => name.includes("/")))
      throw Error("Dock menu must show four basenames");
    report.checks.push(
      "Native Dock menu contains four recent projects without full paths",
    );
    document.querySelector(".recent-projects button").click();
    const root = await wait(() =>
      document.querySelector('.tree-row[data-root="true"]'),
    );
    if (root.getAttribute("aria-expanded") !== "false")
      throw Error("New roots must be collapsed");
    await wait(
      async () => (await call("app.testWindow")).title === "Project-5",
    );
    report.checks.push(
      "Recent project opens in the empty window; actual native window title uses its first basename; roots start collapsed",
    );
    await call("app.testDock", { action: 1 });
    await checkpoint("dock opened second window");
    const other = await wait(async () =>
      (await call("app.windows")).find(
        (window) =>
          window.id !== "main" &&
          !window.empty &&
          window.firstFolder === "Project-4",
      ),
    );
    await call("app.testWindow", { windowId: other.id, close: true });
    await call("app.testWindow", { focus: true });
    await checkpoint("closing clean window");
    await wait(
      async () =>
        !(await call("app.windows")).some((window) => window.id === other.id),
    );
    report.checks.push(
      "Actual native Dock action opens the selected project; clean native window close finishes",
    );
    // New Workspace must be empty, even while another project is open.
    document.querySelector(".workspace-switch").click();
    const newWorkspace = await wait(() =>
      [...document.querySelectorAll('[role="menuitem"]')].find((e) =>
        e.textContent.includes("New Workspace"),
      ),
    );
    newWorkspace.click();
    await checkpoint("new workspace requested");
    const fresh = await wait(async () =>
      (await call("app.windows")).find(
        (window) => window.id !== "main" && window.empty,
      ),
    );
    await call("app.testWindow", { windowId: fresh.id, close: true });
    await call("app.testWindow", { focus: true });
    await wait(
      async () =>
        !(await call("app.windows")).some((window) => window.id === fresh.id),
    );
    report.checks.push(
      "New Workspace opens a separate empty native window with no inherited folders",
    );
    await checkpoint("editing dirty buffer");
    root.querySelector(".tree-chevron").click();
    const file = await wait(() =>
      [...document.querySelectorAll(".tree-row")].find(
        (e) => e.getAttribute("aria-label") === "notes.txt",
      ),
    );
    file.click();
    const content = await wait(() => document.querySelector(".cm-content"));
    const view = content.cmTile.root.view;
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: "UNSAVED NATIVE RECOVERY",
      },
    });
    await wait(() => document.querySelector(".changes-bar"));
    await call("app.testWindow", { close: true });
    await wait(() =>
      [...document.querySelectorAll('[role="dialog"]')].some((el) =>
        el.textContent.includes("Keep Recovery and Close"),
      ),
    );
    report.checks.push(
      "Dirty native close offers Save or Keep Recovery before closing",
    );
    report.passed = true;
    await call("session.save", {
      key: "native-projects-result",
      value: report,
    });
    [...document.querySelectorAll("button")]
      .find((el) => el.textContent === "Keep Recovery and Close")
      .click();
  } catch (error) {
    report.error = String(error) + "\n" + String(error.stack || "");
    await call("session.save", {
      key: "native-projects-result",
      value: report,
    });
  }
})();
