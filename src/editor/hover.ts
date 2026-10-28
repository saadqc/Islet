import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
import python from "highlight.js/lib/languages/python";
import typescript from "highlight.js/lib/languages/typescript";
import javascript from "highlight.js/lib/languages/javascript";
hljs.registerLanguage("python", python);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("javascript", javascript);
const markdown = new MarkdownIt({
  html: false,
  breaks: false,
  linkify: false,
  highlight: (text, lang) =>
    lang && hljs.getLanguage(lang)
      ? hljs.highlight(text, { language: lang, ignoreIllegals: true }).value
      : "",
});
markdown.renderer.rules.image = () => "";
export function hoverMarkdown(contents: unknown): string {
  if (Array.isArray(contents)) return contents.map(hoverMarkdown).join("\n\n");
  if (typeof contents === "string") return contents;
  if (contents && typeof contents === "object" && "value" in contents) {
    const value = String(contents.value);
    if ("language" in contents) {
      const fence = "`".repeat(
        Math.max(3, ...(value.match(/`+/g) || []).map((s) => s.length + 1)),
      );
      return `${fence}${String(contents.language)}\n${value}\n${fence}`;
    }
    return value;
  }
  return "";
}
export function renderHover(contents: unknown, unresolved = false) {
  const dom = document.createElement("div");
  dom.className = "islet-lsp-tip";
  dom.setAttribute("role", "tooltip");
  dom.innerHTML = DOMPurify.sanitize(markdown.render(hoverMarkdown(contents)), {
    FORBID_TAGS: ["img", "iframe", "style", "script", "form"],
    FORBID_ATTR: ["style"],
  });
  for (const paragraph of dom.querySelectorAll("p"))
    if (!paragraph.textContent?.trim() && !paragraph.querySelector("code"))
      paragraph.remove();
  for (const link of dom.querySelectorAll("a")) {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
  if (unresolved) {
    const hint = document.createElement("p");
    hint.className = "hover-type-hint";
    hint.textContent =
      "The language service could not resolve this type. Check the project interpreter and imports.";
    dom.append(hint);
  }
  return dom;
}
