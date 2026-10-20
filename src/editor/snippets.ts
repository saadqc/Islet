/** Expand LSP tab stops to safe plain text when a server returns snippets despite plain completion negotiation. */
export function expandSnippet(template: string): {
  text: string;
  from: number;
  to: number;
} {
  const fields = new Map<number, string>();
  const stops: { index: number; from: number; to: number }[] = [];
  let output = "";
  function append(source: string, record = true): string {
    let text = "";
    for (let i = 0; i < source.length; i++) {
      const c = source[i];
      if (
        c === "\\" &&
        i + 1 < source.length &&
        /[\\$},|]/.test(source[i + 1])
      ) {
        text += source[++i];
        continue;
      }
      if (c !== "$") {
        text += c;
        continue;
      }
      const numeric = /^\d+/.exec(source.slice(i + 1));
      if (numeric) {
        const index = Number(numeric[0]),
          value = fields.get(index) || "";
        if (record)
          stops.push({
            index,
            from: output.length + text.length,
            to: output.length + text.length + value.length,
          });
        text += value;
        i += numeric[0].length;
        continue;
      }
      if (source[i + 1] !== "{") {
        text += c;
        continue;
      }
      let end = i + 2,
        depth = 1;
      for (; end < source.length; end++) {
        if (source[end] === "\\") {
          end++;
          continue;
        }
        if (source[end] === "{") depth++;
        if (source[end] === "}" && !--depth) break;
      }
      if (depth) {
        text += "$";
        continue;
      }
      const body = source.slice(i + 2, end),
        match =
          /^(\d+|[A-Za-z_][A-Za-z_\d]*)(?::([\s\S]*)|\|([\s\S]*)\|)?$/.exec(
            body,
          );
      let value = "";
      if (match) {
        const index = /^\d+$/.test(match[1]) ? Number(match[1]) : undefined;
        value =
          match[2] !== undefined
            ? append(match[2], false)
            : match[3] !== undefined
              ? append(match[3].split(/(?<!\\),/)[0], false)
              : index !== undefined
                ? fields.get(index) || ""
                : "";
        if (index !== undefined) {
          fields.set(index, value);
          if (record)
            stops.push({
              index,
              from: output.length + text.length,
              to: output.length + text.length + value.length,
            });
        }
      }
      text += value;
      i = end;
    }
    return text;
  }
  output = append(template);
  const first = stops.sort(
    (a, b) =>
      (a.index === 0 ? Infinity : a.index) -
      (b.index === 0 ? Infinity : b.index),
  )[0];
  return {
    text: output,
    from: first?.from ?? output.length,
    to: first?.to ?? output.length,
  };
}
