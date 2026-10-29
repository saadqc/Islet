// Existing editor workflows explicitly open their fixture roots. Default
// collapsed behavior is tested separately by projects-ui.mjs.
export async function openFixtureRoots(page) {
  await page.context().addInitScript(() => {
    const opened = new WeakSet();
    const expand = () =>
      document
        .querySelectorAll('.tree-row[data-root="true"]')
        .forEach((row) => {
          if (opened.has(row)) return;
          opened.add(row);
          if (row.getAttribute("aria-expanded") === "false")
            row.querySelector(".tree-chevron").click();
        });
    const start = () => {
      new MutationObserver(expand).observe(document.documentElement, {
        subtree: true,
        childList: true,
      });
      expand();
    };
    if (document.documentElement) start();
    else document.addEventListener("DOMContentLoaded", start, { once: true });
  });
}
