import {minimalEdits,mapOffset,type OffsetChange} from './edits';
import { request, type Request } from "./bridge";
import {
  documentId,
  type FileSnapshot,
  type DocumentModel,
  type LocationSnapshot,
} from "./types";
export class DocumentStore {
  documents = new Map<string, DocumentModel>();
  private listeners = new Set<() => void>();
  constructor(public transport: Request = request) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  emit = () => this.listeners.forEach((fn) => fn());
  async open(hostId: string, path: string): Promise<DocumentModel> {
    const id = documentId(hostId, path);
    const current = this.documents.get(id);
    if (current) return current;
    const snapshot = await this.transport<FileSnapshot>("file.read", {
      hostId,
      path,
    });
    return this.add({ ...snapshot, hostId, path: snapshot.path || path });
  }
  add(snapshot: FileSnapshot): DocumentModel {
    const id = documentId(snapshot.hostId, snapshot.path);
    const existing = this.documents.get(id);
    if (existing) return existing;
    const doc: DocumentModel = {
      ...snapshot,
      id,
      text: snapshot.text,
      version: 1,
      diskRevision: snapshot.revision,
      savedText: snapshot.text,
      dirty: false,
      saveState: "saved",
      markdownMode: /\.(?:md|markdown)$/i.test(snapshot.path)
        ? "preview"
        : undefined,
    };
    this.documents.set(id, doc);
    this.emit();
    return doc;
  }
  private updateDocument(doc:DocumentModel,text:string,edits?:OffsetChange[],location?:LocationSnapshot) {
    if(doc.text===text)return;
    const before=doc.text, changes=edits||minimalEdits(before,text);
    const prior=doc.location;
    const nextLocation=location?{...location}:prior?{...prior,anchor:mapOffset(prior.anchor,changes),head:mapOffset(prior.head,changes)}:undefined;
    doc.text=text;doc.version++;doc.dirty=text!==doc.savedText;doc.saveState=doc.dirty?'pending':'saved';
    doc.location=nextLocation;
    doc.lastChange={version:doc.version,before,edits:changes.map(e=>({...e})),location:nextLocation};
  }
  change(id:string,text:string,edits?:OffsetChange[]) {
    const doc=this.require(id);if(doc.text===text)return;this.updateDocument(doc,text,edits);this.emit();
  }
  applyChanges(changes:{id:string;text:string;edits?:OffsetChange[];location?:LocationSnapshot}[]) {
    for(const change of changes)this.updateDocument(this.require(change.id),change.text,change.edits,change.location);
    this.emit();
  }
  require(id: string) {
    const doc = this.documents.get(id);
    if (!doc) throw new Error("Document is not open");
    return doc;
  }
  async validate(doc: DocumentModel) {
    const current = await this.transport<FileSnapshot>("file.read", {
      hostId: doc.hostId,
      path: doc.path,
    });
    if (doc.saveState === "uncertain") this.reconcileSave(doc, current);
    if (current.revision !== doc.diskRevision) {
      doc.conflict = current;
      doc.saveState = "conflicted";
      this.emit();
      throw new Error(
        "File changed on disk; review the conflict before saving",
      );
    }
    return current;
  }
  async save(id: string) {
    const doc = this.require(id);
    if (doc.readonly) throw new Error("This document is read-only");
    const version = doc.version,
      text = doc.text;
    await this.validate(doc);
    doc.pendingSaveText = text;
    try {
      const result = await this.transport<FileSnapshot>("file.save", {
        hostId: doc.hostId,
        path: doc.path,
        text,
        expectedRevision: doc.diskRevision,
        newline: doc.newline,
        bom: doc.bom,
        encoding: doc.encoding,
      });
      doc.diskRevision = result.revision;
      doc.revision = result.revision;
      doc.savedText = text;
      doc.dirty = doc.text !== text;
      doc.saveState = doc.dirty ? "pending" : "saved";
      doc.conflict = undefined;
      doc.pendingSaveText = undefined;
      this.emit();
      return { id, version, state: doc.saveState };
    } catch (error) {
      doc.saveState = /CONFLICT/.test((error as any).code || "")
        ? "conflicted"
        : "uncertain";
      this.emit();
      throw error;
    }
  }
  async checkExternal(id: string) {
    const doc = this.require(id),
      fresh = await this.transport<FileSnapshot>("file.read", {
        hostId: doc.hostId,
        path: doc.path,
      });
    if (doc.saveState === "uncertain" && this.reconcileSave(doc, fresh)) {
      this.emit();
      return true;
    }
    if (fresh.revision === doc.diskRevision) return false;
    if (doc.dirty) {
      doc.conflict = fresh;
      doc.saveState = "conflicted";
    } else {
      this.updateDocument(doc,fresh.text);
      Object.assign(doc, fresh, {diskRevision:fresh.revision,savedText:fresh.text,dirty:false,saveState:'saved'});
    }
    this.emit();
    return true;
  }
  private reconcileSave(doc: DocumentModel, fresh: FileSnapshot) {
    if (
      doc.pendingSaveText !== undefined &&
      fresh.text === doc.pendingSaveText &&
      (fresh.bom ?? false) === (doc.bom ?? false) &&
      (fresh.newline || "LF") === (doc.newline || "LF")
    ) {
      doc.savedText = doc.pendingSaveText;
      doc.diskRevision = fresh.revision;
      doc.revision = fresh.revision;
      doc.dirty = doc.text !== doc.savedText;
      doc.saveState = doc.dirty ? "pending" : "saved";
      doc.pendingSaveText = undefined;
      doc.conflict = undefined;
      return true;
    }
    if (fresh.revision === doc.diskRevision) {
      doc.saveState = doc.dirty ? "pending" : "saved";
      doc.pendingSaveText = undefined;
      return true;
    }
    return false;
  }
  resolveConflict(id: string, choice: "reload" | "keep") {
    const doc = this.require(id),
      fresh = doc.conflict;
    if (!fresh) return;
    if (choice === "reload") {
      this.updateDocument(doc,fresh.text);
      doc.savedText = fresh.text;
      doc.dirty = false;
    } else {
      doc.savedText = fresh.text;
      doc.dirty = doc.text !== fresh.text;
    }
    doc.diskRevision = fresh.revision;
    doc.revision = fresh.revision;
    doc.conflict = undefined;
    doc.saveState = doc.dirty ? "pending" : "saved";
    this.emit();
  }
  snapshot() {
    return [...this.documents.values()].map(({lastChange,...document}) => ({ ...document }));
  }
  restore(documents: DocumentModel[]) {
    for (const doc of documents) {
      if (!doc.hostId || !doc.path) continue;
      this.documents.set(documentId(doc.hostId, doc.path), {
        ...doc,
        id: documentId(doc.hostId, doc.path),
      });
    }
    this.emit();
  }
  setLocation(id: string, location: LocationSnapshot) {
    this.require(id).location = location;
  }
}
