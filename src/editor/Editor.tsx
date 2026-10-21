import { minimalEdits } from "../core/edits";
import { expandSnippet } from "./snippets";
import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import {
  EditorState,
  Transaction,
  Compartment,
  StateEffect,
  StateField,
  RangeSet,
  EditorSelection,
} from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  highlightSpecialChars,
  Decoration,
  gutter,
  GutterMarker,
  hoverTooltip,
  type DecorationSet,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyField,
  historyKeymap,
  indentWithTab,
  toggleComment,
  undo,
  redo,
  selectAll,
  indentMore,
  indentLess,
} from "@codemirror/commands";
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
  HighlightStyle,
  syntaxTree,
} from "@codemirror/language";
import {
  autocompletion,
  completionKeymap,
  closeBrackets,
  closeBracketsKeymap,
  type CompletionContext,
} from "@codemirror/autocomplete";
import {
  searchKeymap,
  highlightSelectionMatches,
  openSearchPanel,
} from "@codemirror/search";
import { setDiagnostics, lintGutter } from "@codemirror/lint";
import { python } from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";
import { markdown } from "@codemirror/lang-markdown";
import { tags } from "@lezer/highlight";
import {
  offsetAt,
  positionAt,
  type DocumentModel,
  type LocationSnapshot,
} from "../core/types";
import { LanguageManager, type LanguageLocation } from "../languages/client";
import { BookmarkStore } from "../navigation/bookmarks";
import { applyOffsets } from "../refactoring/transactions";
export interface EditorSettings {
  theme?: string;
  fontSize?: number;
  fontFamily?: string;
  lineHeight?: number;
  ligatures?: boolean;
  wrap?: boolean;
  tabSize?: number;
}
export interface EditorProps {
  document: DocumentModel;
  settings?: EditorSettings;
  languages?: LanguageManager;
  bookmarks?: BookmarkStore;
  onChange: (text: string) => void;
  onEdit?: (changes: { from: number; to: number; inserted: number }[]) => void;
  onNavigate?: (locations: LanguageLocation[]) => void;
  onContextMenu?: (target: { x: number; y: number; offset: number }) => void;
  onSelection?: (snapshot: LocationSnapshot) => void;
  onCommand?: (id: string) => void;
  onError?: (message: string) => void;
}
export interface EditorHandle {
  view: EditorView | null;
  focus: () => void;
  snapshot: () => LocationSnapshot | undefined;
  restore: (location: LocationSnapshot) => void;
  reveal: (location: LocationSnapshot) => void;
  command: (id: string) => void;
  toggleBookmark: (offset?: number) => void;
  functionOffset: (direction: 1 | -1) => Promise<number | undefined>;
}
const states = new Map<string, EditorState>();
export function migrateEditorState(oldId: string, newId: string) {
  const state = states.get(oldId);
  if (state) {
    states.set(newId, state);
    states.delete(oldId);
  }
}
const semanticEffect = StateEffect.define<DecorationSet>();
const semanticField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const effect of tr.effects)
      if (effect.is(semanticEffect)) value = effect.value;
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});
const modifierEffect = StateEffect.define<{
  from: number;
  to: number;
} | null>();
const modifierField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const effect of tr.effects)
      if (effect.is(modifierEffect))
        value = effect.value
          ? Decoration.set([
              Decoration.mark({ class: "cm-modifier-symbol" }).range(
                effect.value.from,
                effect.value.to,
              ),
            ])
          : Decoration.none;
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});
function modifierHover(view: EditorView, event: MouseEvent | KeyboardEvent) {
  const active = event.metaKey || event.ctrlKey;
  view.dom.classList.toggle("islet-modifier", active);
  if (!active) {
    if (view.state.field(modifierField).size)
      view.dispatch({ effects: modifierEffect.of(null) });
    return;
  }
  if (!("clientX" in event)) return;
  const offset = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (offset == null) return;
  const word = view.state.wordAt(offset);
  if (word)
    view.dispatch({
      effects: modifierEffect.of({ from: word.from, to: word.to }),
    });
  else view.dispatch({ effects: modifierEffect.of(null) });
}
const bookmarkEffect = StateEffect.define<RangeSet<GutterMarker>>();
const bookmarkField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const e of tr.effects) if (e.is(bookmarkEffect)) value = e.value;
    return value;
  },
});
class BookmarkMarker extends GutterMarker {
  toDOM() {
    const marker = document.createElement("span");
    marker.className = "islet-bookmark";
    marker.textContent = "◆";
    marker.title = "Line bookmark";
    return marker;
  }
}
const bookmarkMarker = new BookmarkMarker();
function syntax(dark: boolean) {
  return syntaxHighlighting(
    HighlightStyle.define([
      { tag: tags.keyword, color: dark ? "#CF8E6D" : "#0033B3" },
      {
        tag: [tags.string, tags.special(tags.string)],
        color: dark ? "#6AAB73" : "#067D17",
      },
      { tag: [tags.number, tags.bool], color: dark ? "#2AACB8" : "#1750EB" },
      {
        tag: tags.comment,
        color: dark ? "#7A7E85" : "#8C8C8C",
        fontStyle: dark ? "normal" : "italic",
      },
      {
        tag: tags.definition(tags.function(tags.variableName)),
        color: dark ? "#56A8F5" : "#00627A",
      },
      {
        tag: [tags.propertyName, tags.attributeName],
        color: dark ? "#C77DBB" : "#871094",
      },
      {
        tag: [tags.meta, tags.annotation],
        color: dark ? "#B3AE60" : "#9E880D",
      },
      {
        tag: [tags.typeName, tags.className],
        color: dark ? "#BCBEC4" : "#080808",
      },
      { tag: tags.regexp, color: dark ? "#6AAB73" : "#067D17" },
    ]),
  );
}
function theme(settings: EditorSettings = {}) {
  const dark = settings.theme !== "light";
  return [
    syntax(dark),
    EditorView.theme(
      {
        "&": {
          height: "100%",
          fontSize: (settings.fontSize || 13) + "px",
          color: dark ? "#BCBEC4" : "#080808",
          backgroundColor: dark ? "#191A1C" : "#FFFFFF",
        },
        ".cm-scroller": {
          fontFamily: settings.fontFamily || '"JetBrains Mono", monospace',
          lineHeight: String(settings.lineHeight || 1.55),
          fontVariantLigatures:
            settings.ligatures === false ? "none" : "normal",
        },
        ".cm-content": {
          padding: "8px 0",
          caretColor: dark ? "#BCBEC4" : "#080808",
        },
        ".cm-line": { padding: "0 14px 0 6px" },
        ".cm-gutters": {
          backgroundColor: dark ? "#191A1C" : "#FFFFFF",
          color: dark ? "#4B5059" : "#AEB3C2",
          border: "none",
        },
        ".cm-lineNumbers .cm-gutterElement": {
          minWidth: "34px",
          padding: "0 7px",
        },
        ".cm-activeLine,.cm-activeLineGutter": {
          backgroundColor: dark ? "#1F2024" : "#F5F8FE",
        },
        "&.cm-focused .cm-selectionBackground,.cm-selectionBackground,::selection":
          { backgroundColor: dark ? "#214283" : "#A6D2FF" },
        ".cm-cursor": { borderLeftColor: dark ? "#BCBEC4" : "#080808" },
        ".cm-tooltip": {
          backgroundColor: dark ? "#26282C" : "#FFFFFF",
          color: dark ? "#D1D3D9" : "#080808",
          border: "1px solid " + (dark ? "#33353B" : "#E9EAEE"),
          borderRadius: "6px",
          boxShadow: "0 5px 18px #0003",
          fontFamily: "Inter,sans-serif",
          fontSize: "12px",
        },
        ".cm-tooltip-autocomplete ul li": { padding: "4px 9px" },
        ".cm-tooltip-autocomplete ul li[aria-selected]": {
          backgroundColor: dark ? "#2A4371" : "#D0DFFE",
          color: "inherit",
        },
        ".cm-completionDetail": {
          color: dark ? "#9FA2A8" : "#5F6269",
          fontStyle: "normal",
          marginLeft: "18px",
        },
        ".cm-bookmark-gutter": {
          width: "16px",
          cursor: "pointer",
          color: "#56A8F5",
        },
        ".cm-foldGutter": { width: "14px" },
        ".cm-panels": {
          backgroundColor: dark ? "#26282C" : "#F7F6F8",
          color: "inherit",
        },
        ".cm-searchMatch": { backgroundColor: dark ? "#5D4B28" : "#FFE3A1" },
        ".cm-searchMatch-selected": {
          backgroundColor: dark ? "#906B27" : "#FFD580",
        },
        ".cm-sem-function,.cm-sem-method": {
          color: dark ? "#56A8F5" : "#00627A",
        },
        ".cm-sem-property": { color: dark ? "#C77DBB" : "#871094" },
        ".cm-sem-parameter": { color: dark ? "#BCBEC4" : "#080808" },
        ".cm-sem-readonly": { fontStyle: "italic" },
        ".cm-sem-deprecated": { textDecoration: "line-through" },
        ".cm-sem-decorator": { color: dark ? "#B3AE60" : "#9E880D" },
        ".islet-lsp-tip": {
          padding: "9px 12px",
          maxWidth: "520px",
          whiteSpace: "pre-wrap",
        },
        ".islet-signature": {
          position: "absolute",
          zIndex: "60",
          maxWidth: "600px",
          whiteSpace: "pre-wrap",
        },
        ".islet-modifier .cm-content": { cursor: "pointer" },
        ".cm-modifier-symbol": {
          textDecoration: "underline",
          textUnderlineOffset: "2px",
        },
      },
      { dark },
    ),
    settings.wrap ? EditorView.lineWrapping : [],
  ];
}
function language(path: string) {
  return /\.pyi?$/.test(path)
    ? python()
    : /\.[cm]?[jt]sx?$/.test(path)
      ? javascript({
          typescript: /\.[cm]?tsx?$/.test(path),
          jsx: /\.[jt]sx$/.test(path),
        })
      : /\.(?:md|markdown)$/.test(path)
        ? markdown()
        : [];
}
function plain(contents: any): string {
  if (Array.isArray(contents)) return contents.map(plain).join("\n\n");
  return typeof contents === "string" ? contents : contents?.value || "";
}
export const Editor = forwardRef<EditorHandle, EditorProps>(
  function Editor(props, ref) {
    const container = useRef<HTMLDivElement>(null),
      viewRef = useRef<EditorView | null>(null),
      propsRef = useRef(props),
      themeComp = useRef(new Compartment()),
      docRef = useRef(props.document),
      timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
      syncingExternal = useRef(false);
    propsRef.current = props;
    const snapshot = (): LocationSnapshot | undefined => {
      const v = viewRef.current;
      if (!v) return;
      const d = docRef.current;
      return {
        documentId: d.id,
        hostId: d.hostId,
        path: d.path,
        anchor: v.state.selection.main.anchor,
        head: v.state.selection.main.head,
        scrollTop: v.scrollDOM.scrollTop,
        scrollLeft: v.scrollDOM.scrollLeft,
      };
    };
    const restore = (location: LocationSnapshot) => {
      const v = viewRef.current;
      if (!v) return;
      v.focus();
      v.dispatch({
        selection: EditorSelection.single(
          Math.min(location.anchor, v.state.doc.length),
          Math.min(location.head, v.state.doc.length),
        ),
      });
      requestAnimationFrame(() => {
        v.scrollDOM.scrollTop = location.scrollTop;
        v.scrollDOM.scrollLeft = location.scrollLeft;
      });
    };
    const reveal = (location: LocationSnapshot) => {
      const v = viewRef.current;
      if (!v || docRef.current.id !== location.documentId) return;
      const head = Math.min(location.head, v.state.doc.length);
      v.focus();
      v.dispatch({
        selection: EditorSelection.single(
          Math.min(location.anchor, v.state.doc.length),
          head,
        ),
      });
      // Run after a newly mounted editor's exact viewport restoration. Semantic
      // navigation reveals the target; Back/Forward use restore() unchanged.
      requestAnimationFrame(() => {
        if (viewRef.current !== v) return;
        v.dispatch({
          effects: EditorView.scrollIntoView(head, { y: "center" }),
        });
      });
    };
    const bookmarks = () => {
      const p = propsRef.current,
        v = viewRef.current;
      if (!v) return;
      const markers = (p.bookmarks?.bookmarks || [])
        .filter((b) => b.documentId === docRef.current.id && !b.unresolved)
        .map((b) =>
          bookmarkMarker.range(
            v.state.doc.lineAt(Math.min(b.offset, v.state.doc.length)).from,
          ),
        )
        .sort((a, b) => a.from - b.from);
      v.dispatch({ effects: bookmarkEffect.of(RangeSet.of(markers, true)) });
    };
    const error = (e: any) => {
      if (e?.name !== "AbortError" && !String(e).includes("stale"))
        propsRef.current.onError?.(e.message || String(e));
    };
    const runCommand = (id: string) => {
      const v = viewRef.current,
        p = propsRef.current;
      if (!v) return;
      if (
        docRef.current.readonly &&
        [
          "cut",
          "paste",
          "comment",
          "indent",
          "outdent",
          "undo",
          "redo",
        ].includes(id)
      ) {
        p.onError?.("This document is read-only");
        return;
      }
      if (id === "undo") undo(v);
      else if (id === "redo") redo(v);
      else if (id === "select-all") selectAll(v);
      else if (id === "find" || id === "replace") openSearchPanel(v);
      else if (id === "comment") toggleComment(v);
      else if (id === "indent") indentMore(v);
      else if (id === "outdent") indentLess(v);
      else if (id === "bookmark") {
        p.bookmarks?.toggle(docRef.current, v.state.selection.main.head);
        bookmarks();
        p.onCommand?.("bookmarks-changed");
      } else if (id === "copy")
        void navigator.clipboard.writeText(
          v.state.sliceDoc(
            v.state.selection.main.from,
            v.state.selection.main.to,
          ),
        );
      else if (id === "cut") {
        void navigator.clipboard.writeText(
          v.state.sliceDoc(
            v.state.selection.main.from,
            v.state.selection.main.to,
          ),
        );
        v.dispatch(v.state.replaceSelection(""));
      } else if (id === "paste")
        void navigator.clipboard
          .readText()
          .then((text) => v.dispatch(v.state.replaceSelection(text)))
          .catch(error);
      else p.onCommand?.(id);
      v.focus();
    };
    const toggleBookmark = (offset?: number) => {
      const p = propsRef.current,
        v = viewRef.current;
      if (!v) return;
      p.bookmarks?.toggle(
        docRef.current,
        offset ?? v.state.selection.main.head,
      );
      bookmarks();
      p.onCommand?.("bookmarks-changed");
    };
    const functionOffset = async (direction: 1 | -1) => {
      const v = viewRef.current,
        p = propsRef.current;
      if (!v) return;
      const d = docRef.current,
        current = v.state.selection.main.head;
      let offsets: number[] = [];
      try {
        if (p.languages) {
          const symbols = await p.languages.symbols(d);
          const collect = (values: any[]) => {
            for (const value of values || []) {
              if ([6, 12].includes(value.kind))
                offsets.push(
                  offsetAt(
                    d.text,
                    (
                      value.selectionRange ||
                      value.location?.range ||
                      value.range
                    ).start,
                  ),
                );
              collect(value.children);
            }
          };
          collect(symbols);
        }
      } catch {}
      if (!offsets.length) offsets = functionOffsets(v.state);
      return offsets
        .filter((n) => (direction === 1 ? n > current : n < current))
        .sort((a, b) => direction * (a - b))[0];
    };
    useImperativeHandle(ref, () => ({
      get view() {
        return viewRef.current;
      },
      focus: () => viewRef.current?.focus(),
      snapshot,
      restore,
      reveal,
      command: runCommand,
      toggleBookmark,
      functionOffset,
    }));
    const refreshLanguage = async () => {
      const p = propsRef.current,
        d = docRef.current,
        v = viewRef.current;
      if (!p.languages || !v || d.text.length > 5 * 1024 * 1024) return;
      try {
        const tokens = await p.languages.semanticTokens(d);
        if (tokens && tokens.version === d.version && viewRef.current === v) {
          let line = 0,
            column = 0;
          const decorations: any[] = [];
          for (let i = 0; i < tokens.data.length; i += 5) {
            line += tokens.data[i];
            column =
              tokens.data[i] === 0
                ? column + tokens.data[i + 1]
                : tokens.data[i + 1];
            const from = offsetAt(d.text, { line, character: column }),
              to = from + tokens.data[i + 2],
              type = tokens.legend.tokenTypes[tokens.data[i + 3]];
            const modifiers = tokens.legend.tokenModifiers.filter(
              (_: string, n: number) => (tokens.data[i + 4] & (1 << n)) !== 0,
            );
            if (to <= v.state.doc.length && to > from)
              decorations.push(
                Decoration.mark({
                  class: [
                    "cm-sem-" + type,
                    ...modifiers.map((m: string) => "cm-sem-" + m),
                  ].join(" "),
                }).range(from, to),
              );
          }
          v.dispatch({
            effects: semanticEffect.of(Decoration.set(decorations, true)),
          });
        }
      } catch {
        /* Syntax colors remain active if the service is unavailable. */
      }
    };
    useEffect(() => {
      if (!container.current) return;
      const completion = async (context: CompletionContext) => {
        const p = propsRef.current,
          d = docRef.current;
        if (!p.languages || context.view?.composing) return null;
        const word = context.matchBefore(/[\w$]*/),
          before = context.state.sliceDoc(
            Math.max(0, context.pos - 1),
            context.pos,
          );
        if (!context.explicit && !word?.text && before !== ".") return null;
        try {
          const result = await p.languages.request(
            d,
            "textDocument/completion",
            context.pos,
            {
              context: {
                triggerKind: before === "." ? 2 : 1,
                triggerCharacter: before === "." ? "." : undefined,
              },
            },
          );
          const completionVersion = d.version;
          const items = Array.isArray(result) ? result : result?.items || [];
          return {
            from: word?.from ?? context.pos,
            options: items.map((item: any) => ({
              label: item.label,
              detail: item.detail,
              type: [2, 3].includes(item.kind)
                ? "function"
                : [7, 8, 22].includes(item.kind)
                  ? "class"
                  : [5, 6, 10].includes(item.kind)
                    ? "variable"
                    : "text",
              info: plain(item.documentation) || undefined,
              apply: async (
                view: EditorView,
                _completion: any,
                from: number,
                to: number,
              ) => {
                try {
                  if (d.version !== completionVersion)
                    throw new Error(
                      "Completion changed; request completion again",
                    );
                  let resolved = item;
                  if (item.data && p.languages)
                    try {
                      resolved = {
                        ...item,
                        ...(await p.languages.request(
                          d,
                          "completionItem/resolve",
                          undefined,
                          item,
                        )),
                      };
                    } catch {}
                  if (d.version !== completionVersion)
                    throw new Error("Completion changed during resolution");
                  const edits = [
                    ...(resolved.additionalTextEdits || []).map((e: any) => ({
                      from: offsetAt(d.text, e.range.start),
                      to: offsetAt(d.text, e.range.end),
                      insert: e.newText,
                    })),
                  ];
                  const te = resolved.textEdit;
                  const rawText =
                    te?.newText ?? resolved.insertText ?? resolved.label;
                  const expanded =
                    resolved.insertTextFormat === 2
                      ? expandSnippet(rawText)
                      : {
                          text: rawText,
                          from: rawText.length,
                          to: rawText.length,
                        };
                  edits.push(
                    te
                      ? {
                          from: offsetAt(
                            d.text,
                            (te.range || te.replace || te.insert).start,
                          ),
                          to: offsetAt(
                            d.text,
                            (te.range || te.replace || te.insert).end,
                          ),
                          insert: expanded.text,
                        }
                      : { from, to, insert: expanded.text },
                  );
                  const insert = edits[edits.length - 1],
                    beforeDelta = edits
                      .filter((e) => e !== insert && e.to <= insert.from)
                      .reduce(
                        (n, e) => n + e.insert.length - (e.to - e.from),
                        0,
                      );
                  view.dispatch({
                    changes: edits,
                    selection: {
                      anchor: insert.from + expanded.from + beforeDelta,
                      head: insert.from + expanded.to + beforeDelta,
                    },
                    userEvent: "input.complete",
                  });
                } catch (e) {
                  error(e);
                }
              },
            })),
          };
        } catch {
          return null;
        }
      };
      const config = {
        doc: props.document.text,
        extensions: [
          history(),
          drawSelection(),
          dropCursor(),
          rectangularSelection(),
          crosshairCursor(),
          highlightSpecialChars(),
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          foldGutter(),
          lintGutter(),
          highlightSelectionMatches(),
          semanticField,
          modifierField,
          bookmarkField,
          gutter({
            class: "cm-bookmark-gutter",
            markers: (view) => view.state.field(bookmarkField),
            initialSpacer: () => bookmarkMarker,
            domEventHandlers: {
              mousedown(view, line) {
                propsRef.current.bookmarks?.toggle(docRef.current, line.from);
                bookmarks();
                propsRef.current.onCommand?.("bookmarks-changed");
                return true;
              },
            },
          }),
          language(props.document.path),
          themeComp.current.of(theme(props.settings)),
          EditorState.tabSize.of(props.settings?.tabSize || 4),
          EditorState.readOnly.of(!!props.document.readonly),
          EditorView.editable.of(!props.document.readonly),
          EditorState.allowMultipleSelections.of(true),
          autocompletion({
            override: [completion],
            activateOnTyping: true,
            defaultKeymap: true,
          }),
          hoverTooltip(async (view, pos) => {
            const p = propsRef.current;
            if (!p.languages || view.composing) return null;
            try {
              const value = await p.languages.request(
                docRef.current,
                "textDocument/hover",
                pos,
              );
              if (!value) return null;
              return {
                pos,
                end: pos,
                above: true,
                create: () => {
                  const dom = document.createElement("div");
                  dom.className = "islet-lsp-tip";
                  dom.textContent = plain(value.contents);
                  return { dom };
                },
              };
            } catch {
              return null;
            }
          }),
          keymap.of([
            {
              key: "Alt-Shift-ArrowUp",
              run: () => {
                propsRef.current.onCommand?.("previousBookmark");
                return true;
              },
            },
            {
              key: "Alt-Shift-ArrowDown",
              run: () => {
                propsRef.current.onCommand?.("nextBookmark");
                return true;
              },
            },
            {
              key: "Mod-s",
              run: () => {
                propsRef.current.onCommand?.("save");
                return true;
              },
            },
            {
              key: "Mod-b",
              run: () => {
                propsRef.current.onCommand?.("definition");
                return true;
              },
            },
            {
              key: "Alt-F7",
              run: () => {
                propsRef.current.onCommand?.("references");
                return true;
              },
            },
            {
              key: "Shift-F6",
              run: () => {
                propsRef.current.onCommand?.("rename");
                return true;
              },
            },
            {
              key: "Mod-F11",
              run: () => {
                runCommand("bookmark");
                return true;
              },
            },
            {
              key: "Mod-Shift-F11",
              run: () => {
                propsRef.current.onCommand?.("bookmarks");
                return true;
              },
            },
            {
              key: "Mod-[",
              run: () => {
                propsRef.current.onCommand?.("back");
                return true;
              },
            },
            {
              key: "Mod-]",
              run: () => {
                propsRef.current.onCommand?.("forward");
                return true;
              },
            },
            {
              key: "Ctrl-Alt-ArrowUp",
              run: () => {
                propsRef.current.onCommand?.("previous-function");
                return true;
              },
            },
            {
              key: "Ctrl-Alt-ArrowDown",
              run: () => {
                propsRef.current.onCommand?.("next-function");
                return true;
              },
            },
            {
              key: "Mod-Shift-f",
              run: () => {
                propsRef.current.onCommand?.("find-files");
                return true;
              },
            },
            {
              key: "Mod-Shift-r",
              run: () => {
                propsRef.current.onCommand?.("replace-files");
                return true;
              },
            },
            {
              key: "Shift-F10",
              run: (view) => {
                const c = view.coordsAtPos(view.state.selection.main.head);
                propsRef.current.onContextMenu?.({
                  x: c?.left || 0,
                  y: c?.bottom || 0,
                  offset: view.state.selection.main.head,
                });
                return true;
              },
            },
            indentWithTab,
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            ...foldKeymap,
            ...completionKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const text = update.state.doc.toString();
              if (!syncingExternal.current) propsRef.current.onChange(text);
              const edits: { from: number; to: number; inserted: number }[] =
                [];
              update.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
                edits.push({ from, to, inserted: inserted.length });
              });
              for (const bookmark of propsRef.current.bookmarks?.bookmarks ||
                []) {
                if (bookmark.documentId !== docRef.current.id) continue;
                bookmark.offset = update.state.doc.lineAt(
                  update.changes.mapPos(
                    Math.min(bookmark.offset, update.startState.doc.length),
                    1,
                  ),
                ).from;
                bookmark.line =
                  update.state.doc.lineAt(bookmark.offset).number - 1;
                bookmark.context = update.state.doc.line(
                  bookmark.line + 1,
                ).text;
                bookmark.before =
                  bookmark.line > 0
                    ? update.state.doc.line(bookmark.line).text
                    : "";
                bookmark.after =
                  bookmark.line + 2 <= update.state.doc.lines
                    ? update.state.doc.line(bookmark.line + 2).text
                    : "";
              }
              propsRef.current.onEdit?.(edits.reverse());
              queueMicrotask(() => {
                if (viewRef.current) bookmarks();
              });
              states.set(docRef.current.id, update.state);
              clearTimeout(timer.current);
              timer.current = setTimeout(() => void refreshLanguage(), 300);
            }
            if (update.selectionSet || update.docChanged) {
              const location = snapshot();
              if (location) propsRef.current.onSelection?.(location);
            }
          }),
          EditorView.domEventHandlers({
            contextmenu(event, view) {
              event.preventDefault();
              // macOS also emits contextmenu for Control-left-click. That
              // gesture belongs to semantic navigation, so it must not open a
              // menu whose dismissal would restore the source selection.
              if (event.ctrlKey || event.metaKey) return true;
              propsRef.current.onContextMenu?.({
                x: event.clientX,
                y: event.clientY,
                offset:
                  view.posAtCoords({ x: event.clientX, y: event.clientY }) ??
                  view.state.selection.main.head,
              });
              return true;
            },
            mousedown(event, view) {
              if (
                (event.metaKey || event.ctrlKey) &&
                event.button === 0 &&
                propsRef.current.languages
              ) {
                const offset = view.posAtCoords({
                  x: event.clientX,
                  y: event.clientY,
                });
                if (offset != null) {
                  event.preventDefault();
                  view.focus();
                  view.dispatch({ selection: EditorSelection.cursor(offset) });
                  void propsRef.current.languages
                    .definition(docRef.current, offset)
                    .then((result) => propsRef.current.onNavigate?.(result))
                    .catch(error);
                  return true;
                }
              }
              return false;
            },
            mousemove(event, view) {
              modifierHover(view, event);
              return false;
            },
            keydown(event, view) {
              modifierHover(view, event);
              return false;
            },
            keyup(event, view) {
              modifierHover(view, event);
              if (
                (event.key === "(" || event.key === ",") &&
                propsRef.current.languages &&
                !view.composing
              ) {
                void propsRef.current.languages
                  .request(
                    docRef.current,
                    "textDocument/signatureHelp",
                    view.state.selection.main.head,
                  )
                  .then((value) => {
                    container.current
                      ?.querySelector(".islet-signature")
                      ?.remove();
                    if (!value?.signatures?.length) return;
                    const div = document.createElement("div");
                    div.className = "islet-signature cm-tooltip";
                    const signature =
                      value.signatures[value.activeSignature || 0];
                    const param =
                      signature.parameters?.[
                        value.activeParameter ?? signature.activeParameter ?? 0
                      ];
                    div.textContent =
                      signature.label +
                      (param
                        ? "\nParameter: " +
                          (typeof param.label === "string"
                            ? param.label
                            : signature.label.slice(...param.label))
                        : "");
                    const coords = view.coordsAtPos(
                        view.state.selection.main.head,
                      ),
                      rect = container.current!.getBoundingClientRect();
                    div.style.left =
                      Math.max(8, (coords?.left || rect.left) - rect.left) +
                      "px";
                    div.style.top =
                      Math.max(0, (coords?.top || rect.top) - rect.top - 55) +
                      "px";
                    container.current!.append(div);
                    setTimeout(() => div.remove(), 7000);
                  })
                  .catch(() => {});
              }
              return false;
            },
          }),
        ],
      };
      const saved = states.get(props.document.id);
      const initial = saved
        ? EditorState.fromJSON(
            saved.toJSON({ history: historyField }),
            config,
            { history: historyField },
          )
        : EditorState.create(config);
      const view = new EditorView({
        state: initial,
        parent: container.current,
      });
      viewRef.current = view;
      docRef.current = props.document;
      bookmarks();
      if (props.document.location) restore(props.document.location);
      void refreshLanguage();
      const unsubscribe = props.languages?.subscribe(() => {
        if (viewRef.current !== view) return;
        const values =
          props.languages?.diagnostics.get(docRef.current.id) || [];
        view.dispatch(
          setDiagnostics(
            view.state,
            values.map((d) => ({
              from: offsetAt(docRef.current.text, d.range.start),
              to: offsetAt(docRef.current.text, d.range.end),
              severity:
                d.severity === 1
                  ? "error"
                  : d.severity === 2
                    ? "warning"
                    : "info",
              message: d.message,
              source: d.source,
            })),
          ),
        );
      });
      return () => {
        states.set(docRef.current.id, view.state);
        propsRef.current.document.location = snapshot();
        unsubscribe?.();
        clearTimeout(timer.current);
        view.destroy();
        viewRef.current = null;
      };
    }, []);
    useEffect(() => {
      const v = viewRef.current;
      if (!v) return;
      if (docRef.current.id !== props.document.id) {
        states.set(docRef.current.id, v.state);
        const next = states.get(props.document.id);
        docRef.current = props.document;
        if (next) v.setState(next);
        else {
          const saved = states.get(props.document.id);
          void saved;
          v.dispatch({
            changes: {
              from: 0,
              to: v.state.doc.length,
              insert: props.document.text,
            },
          });
          states.set(props.document.id, v.state);
        }
        bookmarks();
        if (props.document.location) restore(props.document.location);
      } else if (v.state.doc.toString() !== props.document.text) {
        const previous = v.state.doc.toString();
        const metadata = props.document.lastChange;
        const exact =
          metadata?.version === props.document.version &&
          metadata.before === previous;
        const edits = exact
          ? metadata.edits
          : minimalEdits(previous, props.document.text);
        const location = exact ? metadata.location : props.document.location;
        const scroll = {
          top: v.scrollDOM.scrollTop,
          left: v.scrollDOM.scrollLeft,
        };
        syncingExternal.current = true;
        try {
          v.dispatch({
            changes: edits.map((e) => ({
              from: e.from,
              to: e.to,
              insert: e.text,
            })),
            ...(location
              ? {
                  selection: EditorSelection.single(
                    location.anchor,
                    location.head,
                  ),
                }
              : {}),
            annotations: Transaction.addToHistory.of(false),
          });
        } finally {
          syncingExternal.current = false;
        }
        const top = location?.scrollTop ?? scroll.top,
          left = location?.scrollLeft ?? scroll.left;
        v.scrollDOM.scrollTop = top;
        v.scrollDOM.scrollLeft = left;
        requestAnimationFrame(() => {
          if (viewRef.current === v) {
            v.scrollDOM.scrollTop = top;
            v.scrollDOM.scrollLeft = left;
          }
        });
      }
      void refreshLanguage();
    }, [props.document.id, props.document.version]);
    useEffect(() => {
      viewRef.current?.dispatch({
        effects: themeComp.current.reconfigure(theme(props.settings)),
      });
    }, [
      props.settings?.theme,
      props.settings?.fontSize,
      props.settings?.lineHeight,
      props.settings?.ligatures,
      props.settings?.wrap,
    ]);
    useEffect(() => {
      bookmarks();
    }, [props.bookmarks?.bookmarks, props.document.id]);
    return (
      <div
        className="islet-editor"
        ref={container}
        style={{ height: "100%", position: "relative", overflow: "hidden" }}
      />
    );
  },
);
export function functionOffsets(state: EditorState): number[] {
  const offsets: number[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (
        /^(FunctionDefinition|FunctionDeclaration|MethodDeclaration)$/.test(
          node.name,
        )
      )
        offsets.push(node.from);
      if (
        node.name === "VariableDeclaration" ||
        node.name === "PropertyDeclaration"
      ) {
        for (
          let expression = node.node.firstChild;
          expression;
          expression = expression.nextSibling
        ) {
          let value = expression;
          while (value.name === "ParenthesizedExpression") {
            const inner = value.firstChild?.nextSibling;
            if (!inner) break;
            value = inner;
          }
          if (
            value.name !== "ArrowFunction" ||
            expression.prevSibling?.name !== "Equals"
          )
            continue;
          let binding = expression.prevSibling.prevSibling;
          while (
            binding &&
            ![
              "VariableDefinition",
              "PropertyDefinition",
              ",",
              "const",
              "let",
              "var",
            ].includes(binding.name)
          )
            binding = binding.prevSibling;
          if (
            binding &&
            (binding.name === "VariableDefinition" ||
              binding.name === "PropertyDefinition")
          )
            offsets.push(binding.from);
        }
      }
    },
  });
  return [...new Set(offsets)].sort((a, b) => a - b);
}
export default Editor;
