import catalog from "./catalog.json";

type Theme = "dark" | "light";
interface IconTheme {
  icons: Record<string, string>;
  file: string;
  folder: string;
  folderNames: Record<string, string>;
  fileNames: Record<string, string>;
  fileExtensions: Record<string, string>;
}
const lookup = (map: Record<string, string>, name: string) =>
  Object.hasOwn(map, name) ? map[name] : undefined;

/** Resolve names only: file contents and remote paths never become asset URLs. */
export function fileIcon(path: string, folder = false, theme: Theme = "dark") {
  const pack: IconTheme = catalog[theme];
  const name =
    path
      .replace(/\\/g, "/")
      .replace(/\/+$/, "")
      .split("/")
      .pop()
      ?.toLowerCase() || "";
  if (!folder) {
    const ext = name.split(".").pop();
    const office =
      ext &&
      lookup(
        { xls: "excel", xlsx: "excel", doc: "word", docx: "word", csv: "csv" },
        ext,
      );
    if (office) return `/icons/office/${office}-${theme}.svg`;
  }
  let key: string | undefined;
  const named = (id: string) => (theme === "light" ? `${id}_light` : id);
  if (folder) {
    key = lookup(pack.folderNames, name);
  } else {
    // PyCharm-style treatment of packages, environment variants and test files.
    if (name === "__init__.py") key = named("file_python");
    else if (/^\.env(?:[._-]|$)/.test(name)) key = named("file_env");
    else if (/^dockerfile(?:\.|$)/.test(name)) key = named("file_docker");
    else if (/^(?:test_.+|.+_test)\.py$/.test(name))
      key = named("file_python_tests");
    else if (/_test\.go$/.test(name)) key = named("file_go_test");
    else key = lookup(pack.fileNames, name);
    // Prefer compound extensions (e.g. component.test.tsx) over the last suffix.
    if (!key) {
      const parts = name.split(".");
      for (let index = 1; index < parts.length && !key; index++)
        key = lookup(pack.fileExtensions, parts.slice(index).join("."));
    }
  }
  return `/icons/jetbrains/${(key && lookup(pack.icons, key)) || pack.icons[folder ? pack.folder : pack.file]}`;
}
