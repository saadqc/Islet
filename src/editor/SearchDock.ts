import { StateEffect, StateField, EditorSelection } from "@codemirror/state";
import { type EditorView, type Panel, type ViewUpdate } from "@codemirror/view";
import {
  search,
  SearchQuery,
  getSearchQuery,
  setSearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
  closeSearchPanel,
} from "@codemirror/search";
export const replaceMode = StateEffect.define<boolean>();
const mode = StateField.define<boolean>({
  create: () => false,
  update: (value, tr) => {
    for (const e of tr.effects) if (e.is(replaceMode)) value = e.value;
    return value;
  },
});
class SearchDock implements Panel {
  dom = document.createElement("div");
  top = false;
  find = document.createElement("input");
  replacement = document.createElement("input");
  count = document.createElement("output");
  second = document.createElement("div");
  options: Record<string, HTMLButtonElement> = {};
  buttons: HTMLButtonElement[] = [];
  constructor(readonly view: EditorView) {
    this.dom.className = "file-search-dock";
    this.dom.setAttribute("role", "search");
    this.dom.setAttribute("aria-label", "Find in file");
    const header = document.createElement("div");
    header.className = "search-dock-heading";
    const title = document.createElement("strong");
    title.textContent = "Find in file";
    header.append(title);
    const toggle = this.button("Toggle replacement", "Replace", () =>
      view.dispatch({ effects: replaceMode.of(!view.state.field(mode)) }),
    );
    header.append(toggle);
    const close = this.button("Close file search", "×", () => {
      closeSearchPanel(view);
      view.focus();
    });
    close.className = "search-dock-close";
    header.append(close);
    const row = document.createElement("div");
    row.className = "search-dock-row";
    this.find.type = "text";
    this.find.placeholder = "Find";
    this.find.setAttribute("aria-label", "Find in file");
    this.find.setAttribute("main-field", "true");
    this.find.autocomplete = "off";
    this.count.setAttribute("aria-label", "File search results");
    this.count.setAttribute("aria-live", "polite");
    row.append(this.find, this.count);
    for (const [label, text, action] of [
      ["Previous match", "↑", findPrevious],
      ["Next match", "↓", findNext],
    ] as const) {
      const b = this.button(label, text, () => action(view));
      this.buttons.push(b);
      row.append(b);
    }
    for (const [id, text, label] of [
      ["caseSensitive", "Aa", "Match case"],
      ["wholeWord", "W", "Whole words"],
      ["regexp", ".*", "Regular expression"],
    ]) {
      const b = this.button(label, text, () => {
        b.setAttribute(
          "aria-pressed",
          String(b.getAttribute("aria-pressed") !== "true"),
        );
        this.query();
      });
      b.setAttribute("aria-pressed", "false");
      this.options[id] = b;
      row.append(b);
    }
    this.second.className = "search-dock-row search-dock-replacement";
    this.replacement.placeholder = "Replace with";
    this.replacement.setAttribute("aria-label", "Replace with");
    this.second.append(this.replacement);
    for (const [label, action] of [
      ["Replace", replaceNext],
      ["Replace all", replaceAll],
    ] as const) {
      const b = this.button(label, label, () => action(view));
      b.dataset.mutates = "true";
      this.buttons.push(b);
      this.second.append(b);
    }
    this.dom.append(header, row, this.second);
    this.find.addEventListener("input", () => this.query(true));
    this.replacement.addEventListener("input", () => this.query());
    this.dom.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeSearchPanel(view);
        view.focus();
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        if (e.target === this.replacement) replaceNext(view);
        else (e.shiftKey ? findPrevious : findNext)(view);
      }
    });
    this.sync();
  }
  button(label: string, text: string, action: () => void) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    b.setAttribute("aria-label", label);
    b.title = label;
    b.addEventListener("click", action);
    return b;
  }
  query(navigate = false) {
    this.view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({
          search: this.find.value,
          replace: this.replacement.value,
          caseSensitive:
            this.options.caseSensitive.getAttribute("aria-pressed") === "true",
          wholeWord:
            this.options.wholeWord.getAttribute("aria-pressed") === "true",
          regexp: this.options.regexp.getAttribute("aria-pressed") === "true",
        }),
      ),
    });
    if (navigate && getSearchQuery(this.view.state).valid) {
      this.view.dispatch({
        selection: EditorSelection.cursor(this.view.state.selection.main.from),
      });
      findNext(this.view);
    }
  }
  sync() {
    const q = getSearchQuery(this.view.state);
    if (this.find.value !== q.search) this.find.value = q.search;
    if (this.replacement.value !== q.replace)
      this.replacement.value = q.replace;
    for (const id of Object.keys(this.options))
      this.options[id].setAttribute(
        "aria-pressed",
        String(q[id as "caseSensitive" | "wholeWord" | "regexp"]),
      );
    this.second.hidden = !this.view.state.field(mode);
    let count = 0,
      index = 0;
    if (q.valid) {
      const cursor = q.getCursor(this.view.state);
      const selection = this.view.state.selection.main;
      for (let item = cursor.next(); !item.done; item = cursor.next()) {
        count++;
        if (item.value.from <= selection.from) index = count;
        if (count > 10000) break;
      }
    }
    this.count.textContent = !q.search
      ? ""
      : !q.valid
        ? "Invalid expression"
        : count
          ? `${Math.max(1, index)} of ${count > 10000 ? "10,000+" : count}`
          : "No results";
    this.find.setAttribute("aria-invalid", String(!!q.search && !q.valid));
    for (const b of this.buttons)
      b.disabled =
        !count || (b.dataset.mutates === "true" && this.view.state.readOnly);
  }
  update(update: ViewUpdate) {
    if (
      update.docChanged ||
      update.selectionSet ||
      update.transactions.some((t) =>
        t.effects.some((e) => e.is(setSearchQuery) || e.is(replaceMode)),
      )
    )
      this.sync();
  }
}
export const fileSearch = [
  mode,
  search({ top: false, createPanel: (view) => new SearchDock(view) }),
];
