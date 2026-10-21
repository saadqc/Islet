import { StreamLanguage, type StreamParser } from "@codemirror/language";
import { python } from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";
import { markdown } from "@codemirror/lang-markdown";
import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";
import { xml } from "@codemirror/lang-xml";
import { sql } from "@codemirror/lang-sql";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { properties } from "@codemirror/legacy-modes/mode/properties";

const requirements: StreamParser<{}> = {
  startState: () => ({}),
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match(/#.*/)) return "comment";
    if (
      stream.sol() &&
      stream.match(
        /(?:-r|--requirement|-c|--constraint|-e|--editable|--[\w-]+)/,
      )
    )
      return "keyword";
    if (stream.match(/(?:https?|git\+https?|file):\S+/)) return "link";
    if (stream.match(/(?:===|==|~=|!=|<=|>=|<|>|;|@)/)) return "operator";
    if (stream.match(/\d[\w.*+-]*/)) return "number";
    if (stream.match(/"[^"\n]*"|'[^'\n]*'/)) return "string";
    if (stream.match(/[\w][\w.-]*/)) return "variableName";
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: "#" } },
};

export function syntaxName(path: string, text = ""): string {
  const name = path.split(/[\\/]/).pop()!.toLowerCase();
  if (/\.pyi?$/.test(name)) return "Python";
  if (/\.[cm]?[jt]sx?$/.test(name))
    return /tsx?$/.test(name) ? "TypeScript" : "JavaScript";
  if (/\.(?:md|markdown)$/.test(name)) return "Markdown";
  if (/\.(?:json|jsonc|jsonl)$/.test(name)) return "JSON";
  if (/\.ya?ml$/.test(name)) return "YAML";
  if (/\.toml$/.test(name) || name === "uv.lock" || name === "poetry.lock")
    return "TOML";
  if (/\.(?:xml|xsd|xsl|xslt|svg|plist)$/.test(name)) return "XML";
  if (/\.sql$/.test(name)) return "SQL";
  if (
    /^(?:dockerfile|containerfile)(?:\..*)?$/.test(name) ||
    /\.dockerfile$/.test(name)
  )
    return "Dockerfile";
  if (/^requirements(?:[._-][\w.-]+)?\.txt$/.test(name)) return "Requirements";
  if (
    /\.(?:ini|cfg|conf|properties)$/.test(name) ||
    /^\.env(?:\..*)?$/.test(name)
  )
    return "INI";
  if (
    /\.(?:sh|bash|zsh|ksh)$/.test(name) ||
    /^\.(?:bashrc|bash_profile|zshrc|zprofile)$/.test(name) ||
    /^#![^\n]*\b(?:ba|z|k)?sh\b/.test(text)
  )
    return "Shell";
  return "Plain Text";
}

export function language(path: string, text = "") {
  switch (syntaxName(path, text)) {
    case "Python":
      return python();
    case "JavaScript":
    case "TypeScript":
      return javascript({
        typescript: /\.[cm]?tsx?$/i.test(path),
        jsx: /\.[jt]sx$/i.test(path),
      });
    case "Markdown":
      return markdown();
    case "JSON":
      return json();
    case "YAML":
      return yaml();
    case "XML":
      return xml();
    case "SQL":
      return sql();
    case "TOML":
      return StreamLanguage.define(toml);
    case "Shell":
      return StreamLanguage.define(shell);
    case "Dockerfile":
      return StreamLanguage.define(dockerFile);
    case "INI":
      return StreamLanguage.define(properties);
    case "Requirements":
      return StreamLanguage.define(requirements);
    default:
      return [];
  }
}
