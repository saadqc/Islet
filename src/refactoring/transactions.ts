import { inverseEdits } from '../core/edits';
import type { LocationSnapshot } from '../core/types';
import { DocumentStore } from "../core/documents";
import {
  documentId,
  offsetAt,
  type TextEdit,
  type DocumentModel,
  uriPath,
} from "../core/types";
export interface OffsetEdit {
  from: number;
  to: number;
  text: string;
  selected?: boolean;
}
export interface FileChange {
  documentId: string;
  hostId: string;
  path: string;
  version: number;
  diskRevision: string;
  before: string;
  after: string;
  edits: OffsetEdit[];
  priorDirty: boolean;
  appliedVersion?: number;
  beforeLocation?: LocationSnapshot;
}
export interface EditTransaction {
  id: string;
  label: string;
  files: FileChange[];
  state: "preview" | "applied" | "undone";
  journal?: { documentId: string; state: string; error?: string }[];
}
export function applyOffsets(text: string, edits: OffsetEdit[]) {
  const sorted = [...edits].sort((a, b) => a.from - b.from || a.to - b.to);
  let end = -1;
  for (const e of sorted) {
    if (e.from < 0 || e.to < e.from || e.to > text.length || e.from < end)
      throw new Error("Overlapping or invalid edits");
    end = e.to;
  }
  for (const e of sorted.reverse())
    text = text.slice(0, e.from) + e.text + text.slice(e.to);
  return text;
}
export class TransactionService {
  transactions: EditTransaction[] = [];
  constructor(public documents: DocumentStore) {}
  preview(
    label: string,
    changes: { document: DocumentModel; edits: OffsetEdit[] }[],
  ): EditTransaction {
    const files = changes
      .filter((c) => c.edits.length)
      .map(({ document: d, edits }) => ({
        documentId: d.id,
        hostId: d.hostId,
        path: d.path,
        version: d.version,
        diskRevision: d.diskRevision,
        before: d.text,
        after: applyOffsets(d.text, edits),
        edits,
        priorDirty: d.dirty,
      }));
    const tx: EditTransaction = {
      id: crypto.randomUUID(),
      label,
      files,
      state: "preview",
    };
    return tx;
  }
  async fromWorkspaceEdit(
    label: string,
    hostId: string,
    edit: any,
  ): Promise<EditTransaction> {
    const mapped = new Map<
      string,
      { path: string; version?: number; edits: TextEdit[] }
    >();
    if (edit?.documentChanges) {
      for (const change of edit.documentChanges) {
        if (!change.textDocument || !Array.isArray(change.edits))
          throw new Error(
            "Resource operations are not supported; no changes were applied",
          );
        const path = uriPath(change.textDocument.uri);
        mapped.set(path, {
          path,
          version: change.textDocument.version,
          edits: change.edits,
        });
      }
    }
    for (const [uri, edits] of Object.entries(edit?.changes || {})) {
      const path = uriPath(uri);
      mapped.set(path, { path, edits: edits as TextEdit[] });
    }
    const changes = [];
    const snapshots: {
      document: DocumentModel;
      text: string;
      version: number;
      diskRevision: string;
    }[] = [];
    for (const value of mapped.values()) {
      const d = await this.documents.open(hostId, value.path);
      if (value.version != null && value.version !== d.version)
        throw new Error("Language result is stale; request the preview again");
      snapshots.push({
        document: d,
        text: d.text,
        version: d.version,
        diskRevision: d.diskRevision,
      });
      changes.push({
        document: d,
        edits: value.edits.map((e) => ({
          from: offsetAt(d.text, e.range.start),
          to: offsetAt(d.text, e.range.end),
          text: e.newText,
        })),
      });
    }
    for (const s of snapshots) {
      if (
        s.document.version !== s.version ||
        s.document.text !== s.text ||
        s.document.diskRevision !== s.diskRevision
      )
        throw new Error(
          "Rename preview is stale; document changed while loading edits",
        );
    }
    return this.preview(label, changes);
  }
  assertCurrent(tx: EditTransaction, undo = false) {
    for (const file of tx.files) {
      const doc = this.documents.require(file.documentId);
      if (
        doc.version !== (undo ? file.appliedVersion : file.version) ||
        doc.text !== (undo ? file.after : file.before)
      )
        throw new Error(
          "Preview is stale; document changed. Refresh the preview.",
        );
    }
  }
  async preflight(tx: EditTransaction, undo = false) {
    for (const file of tx.files) {
      const doc = this.documents.require(file.documentId);
      if (
        doc.version !== (undo ? file.appliedVersion : file.version) ||
        doc.text !== (undo ? file.after : file.before)
      )
        throw new Error(
          "Preview is stale; document changed. Refresh the preview.",
        );
      await this.documents.validate(doc);
      if (doc.readonly) throw new Error("A changed file is read-only");
    }
  }
  async apply(tx: EditTransaction) {
    if (tx.state !== "preview") throw new Error("Transaction is not a preview");
    await this.preflight(tx);
    this.assertCurrent(tx);
    for(const file of tx.files){const location=this.documents.require(file.documentId).location;file.beforeLocation=location?{...location}:undefined;}
    this.documents.applyChanges(
      tx.files.map((f) => ({ id: f.documentId, text: f.after, edits:f.edits })),
    );
    for (const f of tx.files)
      f.appliedVersion = this.documents.require(f.documentId).version;
    tx.state = "applied";
    this.transactions.push(tx);
    this.documents.emit();
    return tx;
  }
  async undo(
    tx = [...this.transactions].reverse().find((t) => t.state === "applied"),
  ) {
    if (!tx) throw new Error("No grouped edit to undo");
    await this.preflight(tx, true);
    this.assertCurrent(tx, true);
    this.documents.applyChanges(
      tx.files.map((f) => ({ id: f.documentId, text: f.before, edits:inverseEdits(f.before,f.edits),location:f.beforeLocation })),
    );
    tx.state = "undone";
    this.documents.emit();
    return tx;
  }
  async save(tx: EditTransaction) {
    await this.preflightForSave(tx);
    tx.journal = tx.files.map((f) => ({
      documentId: f.documentId,
      state: "pending",
    }));
    await this.documents.transport("journal.save", { key: tx.id, value: tx });
    for (const item of tx.journal) {
      try {
        const expected = tx.files.find(
          (f) => f.documentId === item.documentId,
        )!;
        const current = this.documents.require(item.documentId);
        if (
          current.text !== expected.after ||
          current.version !== expected.appliedVersion
        )
          throw new Error(
            "Document changed after the transaction; save it explicitly after review",
          );
        await this.documents.save(item.documentId);
        item.state = "saved";
      } catch (e) {
        item.state =
          this.documents.require(item.documentId).saveState || "uncertain";
        item.error = String(e);
      }
      await this.documents.transport("journal.save", { key: tx.id, value: tx });
    }
    return tx.journal;
  }
  async preflightForSave(tx: EditTransaction) {
    for (const f of tx.files) {
      const d = this.documents.require(f.documentId);
      if (d.readonly) throw new Error("A transaction file is read-only");
      if (d.text !== f.after)
        throw new Error("A transaction document changed after apply");
      await this.documents.validate(d);
    }
  }
}
