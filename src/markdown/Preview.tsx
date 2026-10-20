import { useEffect, useRef, useState } from "react";
import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";
import hljs from "highlight.js/lib/core";
import python from "highlight.js/lib/languages/python";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
hljs.registerLanguage("python", python);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("json", json);
hljs.registerLanguage("bash", bash);
import DOMPurify from "dompurify";
import { request } from "../core/bridge";
import type { DocumentModel } from "../core/types";
const md: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  highlight: (code: string, language: string): string =>
    language && hljs.getLanguage(language)
      ? hljs.highlight(code, { language }).value
      : md.utils.escapeHtml(code),
}).use(taskLists, { enabled: false, label: true });
md.renderer.rules.heading_open = (tokens, idx, options, _env, self) => {
  const content = tokens[idx + 1]?.content || "";
  tokens[idx].attrSet(
    "id",
    content
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-|-$/g, ""),
  );
  return self.renderToken(tokens, idx, options);
};
export function resolvePath(path: string, relative: string) {
  const parts = (path.slice(0, path.lastIndexOf("/") + 1) + relative).split(
    "/",
  );
  const out: string[] = [];
  for (const part of parts) {
    if (part === "..") out.pop();
    else if (part && part !== ".") out.push(part);
  }
  return "/" + out.join("/");
}
export function Preview({
  document: doc,
  onOpen,
  onError,
  scroll,
  onScroll,
  fragment,
  onBack,
  onForward,
  onSource,
  onFragmentJump,
}: {
  document: DocumentModel;
  onOpen: (hostId: string, path: string, fragment?: string) => void;
  onError: (s: string) => void;
  scroll: number;
  onScroll: (n: number) => void;
  fragment?: string;
  onBack: () => void;
  onForward: () => void;
  onSource: () => void;
  onFragmentJump: (scrollTop: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [network, setNetwork] = useState(false);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    href?: string;
  } | null>(null);
  function open(href: string) {
    if (href.startsWith("#")) {
      const element = ref.current;
      const target = element?.querySelector<HTMLElement>(
        `[id="${CSS.escape(decodeURIComponent(href.slice(1)))}"]`,
      );
      if (element && target) {
        const top =
          target.getBoundingClientRect().top -
          element.getBoundingClientRect().top +
          element.scrollTop;
        onFragmentJump(top);
        element.scrollTop = top;
      }
      return;
    }
    if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) {
      request("app.openExternal", { url: href }).catch((x) =>
        onError(String(x)),
      );
      return;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) {
      onError("This link protocol is not permitted.");
      return;
    }
    const [path, hash] = href.split("#");
    onOpen(
      doc.hostId,
      resolvePath(doc.path, decodeURIComponent(path)),
      hash ? decodeURIComponent(hash) : undefined,
    );
  }
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let alive = true;
    // Parse into an inert template and remove image URLs before adding any nodes to the live DOM.
    const template = document.createElement("template");
    template.innerHTML = DOMPurify.sanitize(md.render(doc.text), {
      FORBID_TAGS: [
        "script",
        "style",
        "iframe",
        "object",
        "embed",
        "form",
        "source",
      ],
      FORBID_ATTR: ["style", "srcset"],
    });
    const assets: Array<{ img: HTMLImageElement; src: string }> = [];
    for (const img of template.content.querySelectorAll("img")) {
      const src = img.getAttribute("src") || "";
      img.removeAttribute("src");
      img.removeAttribute("srcset");
      assets.push({ img, src });
    }
    element.replaceChildren(template.content);
    element.scrollTop =
      scroll >= 0
        ? scroll
        : ((doc.location?.head || 0) / Math.max(1, doc.text.length)) *
          Math.max(0, element.scrollHeight - element.clientHeight);
    for (const { img, src } of assets) {
      if (/^https?:/i.test(src)) {
        if (network) {
          img.referrerPolicy = "no-referrer";
          img.src = src;
        } else {
          img.alt = `Network image blocked: ${img.alt}`;
          img.classList.add("blocked-image");
        }
      } else if (!/^[a-z][a-z0-9+.-]*:/i.test(src) && !src.startsWith("//")) {
        request<any>("fs.readAsset", {
          hostId: doc.hostId,
          path: resolvePath(doc.path, decodeURIComponent(src.split("#")[0])),
        })
          .then((data) => {
            if (alive) img.src = `data:${data.mime};base64,${data.base64}`;
          })
          .catch(() => {
            img.alt = `Image unavailable: ${img.alt}`;
          });
      }
    }
    if (fragment)
      element.querySelector(`[id="${CSS.escape(fragment)}"]`)?.scrollIntoView();
    return () => {
      alive = false;
    };
  }, [doc.id, doc.text, network, fragment]);
  useEffect(() => {
    const element = ref.current;
    if (element && scroll >= 0 && Math.abs(element.scrollTop - scroll) > 1)
      element.scrollTop = scroll;
  }, [scroll]);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", close);
    };
  }, [menu]);
  return (
    <div className="markdown-shell">
      <div className="reader-tools">
        <span>Reading mode</span>
        <label>
          <input
            type="checkbox"
            checked={network}
            onChange={(e) => setNetwork(e.target.checked)}
          />
          Allow network images
        </label>
      </div>
      <article
        ref={ref}
        className="markdown"
        onScroll={(e) => onScroll(e.currentTarget.scrollTop)}
        onClick={(e) => {
          const a = (e.target as Element).closest("a");
          if (a) {
            e.preventDefault();
            open(a.getAttribute("href") || "");
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({
            x: Math.min(e.clientX, window.innerWidth - 225),
            y: Math.min(e.clientY, window.innerHeight - 220),
            href:
              (e.target as Element).closest("a")?.getAttribute("href") ||
              undefined,
          });
        }}
      />
      {menu && (
        <div
          role="menu"
          className="context-menu"
          style={{ left: menu.x, top: menu.y }}
        >
          {[
            [
              "Copy",
              () =>
                navigator.clipboard.writeText(
                  window.getSelection()?.toString() || "",
                ),
            ],
            ...(menu.href
              ? [
                  [
                    "Copy Link",
                    () => navigator.clipboard.writeText(menu.href!),
                  ],
                  ["Open Link", () => open(menu.href!)],
                ]
              : []),
            ["Back", onBack],
            ["Forward", onForward],
            ["Edit Source", onSource],
          ].map(([label, action]) => (
            <button
              key={String(label)}
              role="menuitem"
              onClick={() => {
                (action as () => void)();
                setMenu(null);
              }}
            >
              {String(label)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
