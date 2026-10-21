import type { Request } from "../core/bridge";
import type { Root } from "../core/types";
import type { LanguageManager } from "../languages/client";

/** An omitted interpreter preserves configuration; an empty string selects auto-detection. */
export function mergeRootConfiguration(
  previous: Root | undefined,
  incoming: Root,
): Root {
  return {
    ...previous,
    ...incoming,
    ...(incoming.interpreter === undefined &&
    previous?.interpreter !== undefined
      ? { interpreter: previous.interpreter }
      : {}),
  };
}

export function mergeManifestRoots(previous: Root[], incoming: Root[]): Root[] {
  return incoming.map((root) =>
    mergeRootConfiguration(
      previous.find(
        (item) => item.hostId === root.hostId && item.path === root.path,
      ),
      root,
    ),
  );
}

export async function attachWorkspaceRoot(
  input: Partial<Root> & Pick<Root, "hostId" | "path">,
  languages: LanguageManager,
  transport: Request,
): Promise<Root> {
  const previous = languages.roots.find(
    (root) => root.hostId === input.hostId && root.path === input.path,
  );
  const opened = await transport<Root>("root.open", {
    ...previous,
    ...input,
    clientId: languages.clientId,
  });
  const canonicalPrevious = languages.roots.find(
    (root) => root.hostId === opened.hostId && root.path === opened.path,
  );
  const root = mergeRootConfiguration(canonicalPrevious, opened);
  await languages.updateRoot(root);
  return root;
}
