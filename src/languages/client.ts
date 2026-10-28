import { loadCallerTree, type CallItem, type CallerTree } from "./callers";
import type { DocumentStore } from "../core/documents";
import { request, onHostEvent, type Request } from "../core/bridge";
import {
  fileUri,
  uriPath,
  positionAt,
  ownerOf,
  type Root,
  type DocumentModel,
  type Position,
  type Range,
} from "../core/types";
export interface LanguageLocation {
  hostId: string;
  path: string;
  range: Range;
}
export interface LspDiagnostic {
  range: Range;
  message: string;
  severity?: number;
  source?: string;
}
export interface LanguageState {
  sessionId: string;
  root: Root;
  language: string;
  capabilities: any;
  status: "starting" | "ready" | "failed";
  error?: string;
}
interface Session extends LanguageState {
  nextId: number;
  pending: Map<
    number,
    {
      resolve: (r: any) => void;
      reject: (e: any) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >;
  opened: Map<string, number>;
  ready?: Promise<void>;
}
export class LanguageManager {
  clientId: string = crypto.randomUUID();
  sessions = new Map<string, Session>();
  roots: Root[] = [];
  diagnostics = new Map<string, LspDiagnostic[]>();
  private listeners = new Set<() => void>();
  private unsubscribe?: () => void;
  documents?: DocumentStore;
  private connecting?: Promise<void>;
  private starting = new Map<string, Promise<Session | undefined>>();
  private generations = new Map<string, number>();
  constructor(public transport: Request = request) {}
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  emit = () => this.listeners.forEach((fn) => fn());
  async connect() {
    if (this.unsubscribe) return;
    if (!this.connecting)
      this.connecting = (async () => {
        const offMessage = await onHostEvent("lsp-message", (event) =>
          this.receive(event),
        );
        const offStatus = await onHostEvent("host-event", (event) => {
          const affected = [...this.sessions.entries()].filter(([, session]) =>
            event.type === "language-exit"
              ? session.sessionId === event.sessionId
              : event.type === "connection" &&
                event.state !== "ready" &&
                session.root.hostId === event.hostId,
          );
          for (const [key, session] of affected) {
            session.status = "failed";
            session.error =
              event.message || event.error || "Connection changed";
            for (const pending of session.pending.values()) {
              clearTimeout(pending.timer);
              pending.reject(new Error(session.error));
            }
            session.pending.clear();
            this.starting.delete(key);
            this.sessions.delete(key);
          }
          if (affected.length) this.emit();
        });
        this.unsubscribe = () => {
          offMessage();
          offStatus();
        };
      })();
    await this.connecting;
  }
  receive(event: any) {
    const session = [...this.sessions.values()].find(
      (s) => s.sessionId === event.sessionId,
    );
    if (!session) return;
    const message = event.message;
    if (message?.id != null && ("result" in message || "error" in message)) {
      const pending = session.pending.get(message.id);
      if (pending) {
        clearTimeout(pending.timer);
        session.pending.delete(message.id);
        message.error
          ? pending.reject(new Error(message.error.message))
          : pending.resolve(message.result);
      }
    } else if (message?.method === "textDocument/publishDiagnostics") {
      const params = message.params,
        opened = session.opened.get(params.uri);
      if (params.version != null && opened != null && params.version !== opened)
        return;
      this.diagnostics.set(
        JSON.stringify([session.root.hostId, uriPath(params.uri)]),
        params.diagnostics || [],
      );
      this.emit();
    } else if (message?.id != null) {
      const settings = this.configuration(session);
      const result =
        message.method === "workspace/configuration"
          ? message.params.items.map((item: any) =>
              item.section
                ? (item.section
                    .split(".")
                    .reduce(
                      (value: any, key: string) => value?.[key],
                      settings,
                    ) ?? null)
                : settings,
            )
          : message.method === "workspace/workspaceFolders"
            ? [{ uri: fileUri(session.root.path), name: session.root.label }]
            : null;
      void this.send(session, { jsonrpc: "2.0", id: message.id, result }).catch(
        () => {},
      );
    }
  }
  private configuration(session: Session) {
    const projectPaths = [
      ...new Set([
        session.root.path,
        ...[...session.opened.keys()]
          .map((uri) => uriPath(uri).slice(0, uriPath(uri).lastIndexOf("/")))
          .filter(
            (path) =>
              path === session.root.path ||
              path.startsWith(session.root.path + "/"),
          ),
      ]),
    ];
    return {
      python: {
        pythonPath: session.root.interpreter,
        analysis: {
          typeCheckingMode: "basic",
          diagnosticMode: "openFilesOnly",
          autoSearchPaths: true,
          useLibraryCodeForTypes: true,
          extraPaths: projectPaths,
        },
      },
      basedpyright: {
        analysis: {
          typeCheckingMode: "basic",
          diagnosticMode: "openFilesOnly",
          autoSearchPaths: true,
          useLibraryCodeForTypes: true,
          extraPaths: projectPaths,
        },
      },
      typescript: { preferences: { includePackageJsonAutoImports: "on" } },
      javascript: { preferences: { includePackageJsonAutoImports: "on" } },
    };
  }
  private send(s: Session, message: any) {
    return this.transport("lsp.send", { sessionId: s.sessionId, message });
  }
  private rpc(
    s: Session,
    method: string,
    params: any,
    signal?: AbortSignal,
  ): Promise<any> {
    if (signal?.aborted)
      return Promise.reject(new DOMException("Canceled", "AbortError"));
    const id = ++s.nextId;
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        s.pending.delete(id);
      };
      const cancel = () => {
        void this.send(s, {
          jsonrpc: "2.0",
          method: "$/cancelRequest",
          params: { id },
        }).catch(() => {});
      };
      const abort = () => {
        cleanup();
        cancel();
        reject(new DOMException("Canceled", "AbortError"));
      };
      const timer = setTimeout(() => {
        cleanup();
        cancel();
        reject(new Error("Language request timed out"));
      }, 20000);
      s.pending.set(id, {
        resolve: (value) => {
          cleanup();
          resolve(value);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
        timer,
      });
      signal?.addEventListener("abort", abort, { once: true });
      this.send(s, { jsonrpc: "2.0", id, method, params }).catch((error) => {
        cleanup();
        reject(error);
      });
    });
  }
  async ensure(
    root: Root,
    document?: DocumentModel,
  ): Promise<Session | undefined> {
    const language = document ? languageFor(document.path) : "python";
    if (!language) return;
    const key = JSON.stringify([
      root.hostId,
      root.id,
      language,
      language === "python" ? root.interpreter || "" : "",
    ]);
    let pending = this.starting.get(key);
    if (!pending) {
      pending = this.createSession(root, document);
      this.starting.set(key, pending);
      pending.catch(() => {
        if (this.starting.get(key) === pending) this.starting.delete(key);
      });
    }
    const session = await pending;
    if (session && document) await this.sync(session, document);
    return session;
  }
  private async createSession(
    root: Root,
    document?: DocumentModel,
  ): Promise<Session | undefined> {
    const language = document ? languageFor(document.path) : "python";
    if (!language) return;
    const generationKey = JSON.stringify([root.hostId, root.id, language]);
    const generation = this.generations.get(generationKey) || 0;
    await this.connect();
    const key = JSON.stringify([
      root.hostId,
      root.id,
      language,
      language === "python" ? root.interpreter || "" : "",
    ]);
    let session = this.sessions.get(key);
    if (!session) {
      const start = await this.transport("lsp.start", {
        root,
        language,
        interpreter: language === "python" ? root.interpreter : undefined,
        clientId: this.clientId,
      });
      if ((this.generations.get(generationKey) || 0) !== generation) {
        await this.transport("lsp.stop", { sessionId: start.sessionId }).catch(
          () => {},
        );
        throw new Error("Language intelligence restarted");
      }
      session = {
        sessionId: start.sessionId,
        root: { ...root, interpreter: root.interpreter || start.interpreter },
        language,
        capabilities: {},
        status: "starting",
        nextId: 0,
        pending: new Map(),
        opened: new Map(),
      };
      this.sessions.set(key, session);
      const current = session;
      session.ready = (async () => {
        try {
          const result = await this.rpc(
            current,
            "initialize",
            initializeParams(current.root),
          );
          current.capabilities = result.capabilities || {};
          await this.send(current, {
            jsonrpc: "2.0",
            method: "initialized",
            params: {},
          });
          await this.send(current, {
            jsonrpc: "2.0",
            method: "workspace/didChangeConfiguration",
            params: {
              settings: this.configuration(current),
            },
          });
          current.status = "ready";
        } catch (error) {
          current.status = "failed";
          current.error = String(error);
          throw error;
        } finally {
          this.emit();
        }
      })();
    }
    await session.ready;
    if ((this.generations.get(generationKey) || 0) !== generation)
      throw new Error("Language intelligence restarted");
    if (document) await this.sync(session, document);
    return session;
  }
  async sync(s: Session, d: DocumentModel) {
    const uri = fileUri(d.path),
      version = s.opened.get(uri);
    if (version == null) {
      s.opened.set(uri, d.version);
      await this.send(s, {
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: {
          textDocument: {
            uri,
            languageId: languageId(d.path),
            version: d.version,
            text: d.text,
          },
        },
      });
      s.opened.set(uri, d.version);
      await this.send(s, {
        jsonrpc: "2.0",
        method: "workspace/didChangeConfiguration",
        params: { settings: this.configuration(s) },
      });
    } else if (version !== d.version) {
      s.opened.set(uri, d.version);
      await this.send(s, {
        jsonrpc: "2.0",
        method: "textDocument/didChange",
        params: {
          textDocument: { uri, version: d.version },
          contentChanges: [{ text: d.text }],
        },
      });
      s.opened.set(uri, d.version);
    }
  }
  async request(
    document: DocumentModel,
    method: string,
    position?: Position | number,
    extra: any = {},
    signal?: AbortSignal,
  ): Promise<any> {
    const root = ownerOf(this.roots, document.hostId, document.path);
    if (!root) throw new Error("This document has no owning language project");
    const version = document.version;
    const s = await this.ensure(root, document);
    if (!s)
      throw new Error(
        "Language intelligence is available for Python and JavaScript/TypeScript",
      );
    const result = await this.rpc(
      s,
      method,
      {
        textDocument: { uri: fileUri(document.path) },
        ...(position == null
          ? {}
          : {
              position:
                typeof position === "number"
                  ? positionAt(document.text, position)
                  : position,
            }),
        ...extra,
      },
      signal,
    );
    if (document.version !== version)
      throw new Error("Language result is stale; try again");
    return result;
  }
  async hover(doc: DocumentModel, offset: number) {
    const version = doc.version;
    const value = await this.request(doc, "textDocument/hover", offset);
    if (!value) return value;
    const text = (contents: any): string =>
      Array.isArray(contents)
        ? contents.map(text).join("\n")
        : typeof contents === "string"
          ? contents
          : contents?.value || "";
    const unresolved = (contents: any) =>
      /\b(?:Unknown|unknown)\b/.test(
        text(contents)
          .split(/```[\w]*\n/)
          .slice(0, 2)
          .join("\n"),
      );
    if (!unresolved(value.contents)) return value;
    // Ask the language service at an actual definition, never invent a type
    // from identifier names or text patterns. Keep original hover coordinates.
    try {
      const locations = await this.locations(
        doc,
        "textDocument/definition",
        offset,
      );
      for (const target of locations.slice(0, 2)) {
        if (!ownerOf(this.roots, target.hostId, target.path) || !this.documents)
          continue;
        const source = await this.documents.open(target.hostId, target.path);
        const better = await this.request(
          source,
          "textDocument/hover",
          target.range.start,
        );
        if (doc.version !== version)
          throw new Error("Language result is stale; try again");
        if (better?.contents && !unresolved(better.contents))
          return { ...value, contents: better.contents };
      }
    } catch (error) {
      if (doc.version !== version) throw error;
    }
    return { ...value, unresolvedType: true };
  }
  async locations(
    doc: DocumentModel,
    method: string,
    offset: number,
  ): Promise<LanguageLocation[]> {
    if (!languageFor(doc.path) || !ownerOf(this.roots, doc.hostId, doc.path))
      return [];
    const value = await this.request(
      doc,
      method,
      offset,
      method.includes("references")
        ? { context: { includeDeclaration: true } }
        : {},
    );
    const values = Array.isArray(value) ? value : value ? [value] : [];
    return values.map((v) => ({
      hostId: doc.hostId,
      path: uriPath(v.targetUri || v.uri),
      range: v.targetSelectionRange || v.targetRange || v.range,
    }));
  }
  async definition(doc: DocumentModel, offset: number) {
    let results = await this.locations(doc, "textDocument/definition", offset);
    if (results.length === 1 && results[0].path === doc.path) {
      const r = results[0].range,
        p = positionAt(doc.text, offset);
      if (
        p.line >= r.start.line &&
        p.line <= r.end.line &&
        p.character >= r.start.character &&
        p.character <= r.end.character
      )
        results = await this.references(doc, offset);
    }
    return results;
  }
  async callers(
    doc: DocumentModel,
    offset: number,
    signal?: AbortSignal,
  ): Promise<CallerTree | undefined> {
    const root = ownerOf(this.roots, doc.hostId, doc.path);
    if (!root)
      throw new Error("Add this file's folder to a workspace to find callers.");
    const participants = [
      ...(this.documents?.documents.values() || [doc]),
    ].filter(
      (item) =>
        item.hostId === doc.hostId &&
        languageFor(item.path) === languageFor(doc.path) &&
        ownerOf(this.roots, item.hostId, item.path)?.id === root.id,
    );
    const versions = participants.map((item) => ({
      item,
      version: item.version,
    }));
    const check = () => {
      if (signal?.aborted) throw new DOMException("Canceled", "AbortError");
      if (versions.some(({ item, version }) => item.version !== version))
        throw new Error(
          "Code changed during caller analysis. Refresh callers to try again.",
        );
    };
    const session = await this.ensure(root, doc);
    check();
    if (!session?.capabilities.callHierarchyProvider)
      throw new Error("This language server does not provide caller analysis.");
    for (const item of participants) {
      check();
      await this.ensure(root, item);
    }
    const prepare = async (position: Position) => {
      check();
      return this.rpc(
        session,
        "textDocument/prepareCallHierarchy",
        { textDocument: { uri: fileUri(doc.path) }, position },
        signal,
      ) as Promise<CallItem[] | null>;
    };
    const position = positionAt(doc.text, offset);
    let items = await prepare(position);
    if (!items?.length) {
      const symbols = await this.request(
        doc,
        "textDocument/documentSymbol",
        undefined,
        {},
        signal,
      );
      let nearest: any;
      const contains = (range: Range) =>
        range &&
        (position.line > range.start.line ||
          (position.line === range.start.line &&
            position.character >= range.start.character)) &&
        (position.line < range.end.line ||
          (position.line === range.end.line &&
            position.character <= range.end.character));
      const visit = (values: any[]) => {
        for (const value of values || []) {
          if (contains(value.range || value.location?.range)) {
            if ([6, 9, 12].includes(value.kind)) nearest = value;
            visit(value.children);
          }
        }
      };
      visit(symbols);
      if (nearest)
        items = await prepare(
          (nearest.selectionRange || nearest.range || nearest.location.range)
            .start,
        );
    }
    check();
    const target =
      items?.find((item) => [6, 9, 12].includes(item.kind)) || items?.[0];
    if (!target) return;
    const result = await loadCallerTree(
      target,
      doc.hostId,
      async (item) => {
        check();
        const calls = await this.rpc(
          session,
          "callHierarchy/incomingCalls",
          { item },
          signal,
        );
        check();
        return calls || [];
      },
      signal,
    );
    check();
    return result;
  }
  references(doc: DocumentModel, offset: number) {
    return this.locations(doc, "textDocument/references", offset);
  }
  prepareRename(doc: DocumentModel, offset: number) {
    return this.request(doc, "textDocument/prepareRename", offset);
  }
  async rename(doc: DocumentModel, offset: number, newName: string) {
    const owning = ownerOf(this.roots, doc.hostId, doc.path);
    const participants = [
      ...(this.documents?.documents.values() || [doc]),
    ].filter(
      (d) =>
        d.hostId === doc.hostId &&
        languageFor(d.path) === languageFor(doc.path) &&
        ownerOf(this.roots, d.hostId, d.path)?.id === owning?.id,
    );
    const before = participants.map((document) => ({
      document,
      version: document.version,
      text: document.text,
    }));
    for (const item of before)
      if (owning) await this.ensure(owning, item.document);
    const result = await this.request(doc, "textDocument/rename", offset, {
      newName,
    });
    for (const item of before)
      if (
        item.document.version !== item.version ||
        item.document.text !== item.text
      )
        throw new Error(
          "Rename preview is stale; an open document changed during analysis",
        );
    return result;
  }
  symbols(doc: DocumentModel) {
    return this.request(doc, "textDocument/documentSymbol");
  }
  async semanticTokens(doc: DocumentModel) {
    const root = ownerOf(this.roots, doc.hostId, doc.path);
    if (!root) return;
    const s = await this.ensure(root, doc);
    if (!s?.capabilities.semanticTokensProvider) return;
    const version = doc.version,
      result = await this.request(doc, "textDocument/semanticTokens/full");
    return {
      version,
      data: result?.data || [],
      legend: s.capabilities.semanticTokensProvider.legend,
    };
  }
  async close() {
    for (const s of this.sessions.values()) {
      for (const p of s.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error("Workspace closed"));
      }
      try {
        await this.transport("lsp.stop", { sessionId: s.sessionId });
      } catch {}
    }
    this.sessions.clear();
    this.starting.clear();
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.connecting = undefined;
  }
  interpreterFor(document: DocumentModel): string | undefined {
    const root = ownerOf(this.roots, document.hostId, document.path);
    if (!root) return;
    if (root.interpreter) return root.interpreter;
    const key = JSON.stringify([root.hostId, root.id, "python", ""]);
    return this.sessions.get(key)?.root.interpreter;
  }
  async updateRoot(root: Root) {
    const previous = this.roots.find(
      (item) => item.hostId === root.hostId && item.path === root.path,
    );
    this.roots = previous
      ? this.roots.map((item) => (item === previous ? root : item))
      : [...this.roots, root];
    if (previous && (previous.interpreter || "") !== (root.interpreter || "")) {
      await this.restart(previous.id, "python", previous.hostId);
      const documents = [...(this.documents?.documents.values() || [])].filter(
        (document) =>
          languageFor(document.path) === "python" &&
          ownerOf(this.roots, document.hostId, document.path) === root,
      );
      await Promise.all(
        documents.map((document) => this.ensure(root, document)),
      );
    }
    this.emit();
  }
  async restart(rootId?: string, language?: string, hostId?: string) {
    const matches = (host: string, id: string, kind: string) =>
      (!rootId || id === rootId) &&
      (!language || kind === language) &&
      (!hostId || host === hostId);
    const targets = new Set<string>();
    for (const root of this.roots)
      for (const kind of ["python", "javascript"])
        if (matches(root.hostId, root.id, kind))
          targets.add(JSON.stringify([root.hostId, root.id, kind]));
    for (const key of [...this.starting.keys(), ...this.sessions.keys()]) {
      const [host, id, kind] = JSON.parse(key);
      if (matches(host, id, kind)) {
        targets.add(JSON.stringify([host, id, kind]));
        this.starting.delete(key);
      }
    }
    for (const key of targets)
      this.generations.set(key, (this.generations.get(key) || 0) + 1);
    for (const [key, session] of [...this.sessions]) {
      if (!matches(session.root.hostId, session.root.id, session.language))
        continue;
      this.sessions.delete(key);
      for (const pending of session.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Language intelligence restarted"));
      }
      session.pending.clear();
      await this.transport("lsp.stop", { sessionId: session.sessionId });
    }
    for (const document of this.documents?.documents.values() || []) {
      const root = ownerOf(this.roots, document.hostId, document.path);
      if (
        root &&
        matches(root.hostId, root.id, languageFor(document.path) || "")
      )
        this.diagnostics.delete(document.id);
    }
    this.emit();
  }
}
export function languageFor(path: string) {
  return /\.pyi?$/.test(path)
    ? "python"
    : /\.(?:[cm]?[jt]s|[jt]sx)$/.test(path)
      ? "javascript"
      : undefined;
}
export function languageId(path: string) {
  return /\.pyi?$/.test(path)
    ? "python"
    : /\.tsx$/.test(path)
      ? "typescriptreact"
      : /\.jsx$/.test(path)
        ? "javascriptreact"
        : /\.[cm]?ts$/.test(path)
          ? "typescript"
          : "javascript";
}

function initializeParams(root: Root) {
  return {
    processId: null,
    rootUri: fileUri(root.path),
    workspaceFolders: [{ uri: fileUri(root.path), name: root.label }],
    capabilities: {
      workspace: {
        configuration: true,
        workspaceFolders: true,
        workspaceEdit: { documentChanges: true, resourceOperations: [] },
      },
      general: { positionEncodings: ["utf-16"] },
      textDocument: {
        synchronization: { didSave: true },
        completion: {
          completionItem: {
            snippetSupport: false,
            documentationFormat: ["markdown", "plaintext"],
            resolveSupport: {
              properties: ["documentation", "detail", "additionalTextEdits"],
            },
          },
        },
        hover: { contentFormat: ["markdown", "plaintext"] },
        signatureHelp: {
          signatureInformation: {
            documentationFormat: ["plaintext"],
            parameterInformation: { labelOffsetSupport: true },
          },
        },
        definition: { linkSupport: true },
        callHierarchy: { dynamicRegistration: false },
        references: {},
        documentSymbol: { hierarchicalDocumentSymbolSupport: true },
        rename: { prepareSupport: true },
        publishDiagnostics: { versionSupport: true },
        semanticTokens: {
          requests: { full: true },
          tokenTypes: [
            "namespace",
            "type",
            "class",
            "enum",
            "interface",
            "struct",
            "typeParameter",
            "parameter",
            "variable",
            "property",
            "enumMember",
            "event",
            "function",
            "method",
            "macro",
            "keyword",
            "modifier",
            "comment",
            "string",
            "number",
            "regexp",
            "operator",
            "decorator",
          ],
          tokenModifiers: [
            "declaration",
            "definition",
            "readonly",
            "static",
            "deprecated",
            "abstract",
            "async",
            "modification",
            "documentation",
            "defaultLibrary",
          ],
          formats: ["relative"],
          overlappingTokenSupport: false,
          multilineTokenSupport: false,
        },
      },
    },
    initializationOptions: {
      preferences: {
        includeCompletionsForModuleExports: true,
        includeCompletionsWithInsertText: true,
      },
      hostInfo: "islet",
    },
  };
}
