import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { IndexeddbPersistence } from "y-indexeddb";
import { io, type Socket } from "socket.io-client";
import {
  events,
  type Workspace,
  type Presence,
  type Reply,
} from "../../../../packages/shared/src/index";
import { ApiError } from "./api";
export interface DocumentState {
  doc: Y.Doc;
  awareness: Awareness;
  storage: IndexeddbPersistence;
  ready: boolean;
  pending: Uint8Array[];
  timer?: ReturnType<typeof setTimeout>;
  sending?: Promise<void>;
}
export class Collaboration {
  socket: Socket;
  docs = new Map<string, DocumentState>();
  status = "Connecting";
  people: Presence[] = [];
  closed = false;
  activeFile = "";
  private listeners = new Set<() => void>();
  private syncBusy = false;
  constructor(
    public project: Workspace,
    public onMeta: () => void,
    public onReset: () => void,
    public onError: (e: Error) => void,
  ) {
    this.socket = io({
      autoConnect: false,
      transports: ["websocket"],
      withCredentials: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 10000,
    });
    this.socket.on("connect", () => {
      void this.synchronize();
    });
    this.socket.on("disconnect", () => {
      this.status = "Offline · edits kept on this device";
      this.notify();
    });
    this.socket.on("connect_error", (error: Error) => {
      this.status = "Reconnecting… " + error.message;
      this.notify();
    });
    this.socket.on(
      events.update,
      ({
        fileId,
        epoch,
        update,
      }: {
        fileId: string;
        epoch: number;
        update: Uint8Array;
      }) => {
        if (epoch !== this.project.epoch) return;
        const d = this.docs.get(fileId);
        if (d) Y.applyUpdate(d.doc, new Uint8Array(update), "server");
      },
    );
    this.socket.on(events.presence, (people: Presence[]) => {
      this.people = people;
      for (const [fileId, d] of this.docs) {
        const old = [...d.awareness.getStates().keys()].filter(
          (k) => k !== d.doc.clientID,
        );
        for (const key of old) d.awareness.states.delete(key);
        for (const p of people)
          if (p.fileId === fileId && p.clientId !== d.doc.clientID)
            d.awareness.states.set(p.clientId, {
              user: p.user,
              selection: p.selection,
            });
        d.awareness.emit("change", [
          {
            added: people
              .filter((p) => p.fileId === fileId)
              .map((p) => p.clientId),
            updated: [],
            removed: old,
          },
          "server",
        ]);
      }
      this.notify();
    });
    this.socket.on(events.changed, onMeta);
    this.socket.on(events.reset, onReset);
    this.socket.on(events.revoked, () => {
      this.status = "Access changed · reopen workspace";
      this.socket.disconnect();
      onReset();
    });
    this.socket.connect();
  }
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  notify() {
    for (const fn of this.listeners) fn();
  }
  request<T>(event: string, data: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.socket.connected)
        return reject(
          new ApiError(
            "OFFLINE",
            "You are offline. Your edits are stored on this device.",
          ),
        );
      this.socket
        .timeout(15000)
        .emit(event, data, (error: Error | null, result: Reply<T>) => {
          if (error)
            return reject(
              new ApiError(
                "TIMEOUT",
                "The save was not acknowledged. Reconnect to retry.",
              ),
            );
          if (!result?.ok)
            return reject(
              new ApiError(
                result?.error?.code ?? "SOCKET_ERROR",
                result?.error?.message ?? "Collaboration request failed.",
              ),
            );
          resolve(result.data as T);
        });
    });
  }
  async open(fileId: string) {
    let d = this.docs.get(fileId);
    if (d) return d;
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const storage = new IndexeddbPersistence(
      `syncstudio:${this.project.id}:${this.project.epoch}:${fileId}`,
      doc,
    );
    d = { doc, awareness, storage, ready: false, pending: [] };
    this.docs.set(fileId, d);
    const entry = d;
    doc.on("update", (update: Uint8Array, origin: unknown) => {
      this.notify();
      if (
        origin === "server" ||
        origin === storage ||
        this.project.role === "VIEWER"
      )
        return;
      entry.pending.push(update);
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        void this.flush(fileId).catch((e) => this.fail(e));
      }, 180);
      this.status = "Saving…";
      this.notify();
    });
    awareness.on("update", (_change: unknown, origin: unknown) => {
      if (origin !== "server" && fileId === this.activeFile)
        void this.publishPresence(fileId);
    });
    await storage.whenSynced;
    return d;
  }
  async syncFile(fileId: string) {
    const d = await this.open(fileId);
    const remote = await this.request<{
      update: Uint8Array;
      vector: Uint8Array;
    }>(events.sync, {
      projectId: this.project.id,
      fileId,
      epoch: this.project.epoch,
      vector: Y.encodeStateVector(d.doc),
    });
    Y.applyUpdate(d.doc, new Uint8Array(remote.update), "server");
    if (this.project.role !== "VIEWER") {
      const delta = Y.encodeStateAsUpdate(d.doc, new Uint8Array(remote.vector));
      await this.request(events.update, {
        projectId: this.project.id,
        fileId,
        epoch: this.project.epoch,
        update: delta,
      });
    }
    d.ready = true;
    await this.flush(fileId);
    this.notify();
  }
  async synchronize() {
    if (this.closed || this.syncBusy) return;
    this.syncBusy = true;
    try {
      await this.request(events.join, { projectId: this.project.id });
      for (const file of this.project.files.filter((f) => f.type === "file"))
        await this.syncFile(file.id);
      this.status = "Saved";
      if (this.activeFile) await this.publishPresence(this.activeFile);
      this.notify();
    } catch (e) {
      this.fail(e);
    } finally {
      this.syncBusy = false;
    }
  }
  async flush(fileId: string) {
    const d = this.docs.get(fileId);
    if (!d || !d.pending.length || !d.ready || this.project.role === "VIEWER")
      return;
    if (d.sending) await d.sending;
    if (!d.pending.length) return;
    const updates = d.pending.splice(0);
    clearTimeout(d.timer);
    d.sending = this.request(events.update, {
      projectId: this.project.id,
      fileId,
      epoch: this.project.epoch,
      update: Y.mergeUpdates(updates),
    })
      .then(() => {
        this.status = [...this.docs.values()].some((d) => d.pending.length)
          ? "Saving…"
          : "Saved";
        this.notify();
      })
      .catch((e) => {
        d.pending.unshift(...updates);
        throw e;
      })
      .finally(() => {
        d.sending = undefined;
      });
    return d.sending;
  }
  async saveAll() {
    if (!this.socket.connected)
      throw new ApiError(
        "OFFLINE",
        "Reconnect before saving or creating a snapshot.",
      );
    for (const [id, d] of this.docs) {
      if (d.sending) await d.sending;
      await this.flush(id);
    }
  }
  async publishPresence(fileId: string) {
    if (!this.socket.connected) return;
    const d = this.docs.get(fileId);
    if (!d?.ready) return;
    try {
      await this.request(events.awareness, {
        projectId: this.project.id,
        fileId,
        epoch: this.project.epoch,
        clientId: d.doc.clientID,
        selection: d.awareness.getLocalState()?.selection ?? null,
      });
    } catch (e) {
      this.fail(e);
    }
  }
  fail(error: unknown) {
    const e =
      error instanceof Error ? error : new Error("Collaboration failed.");
    this.status = this.socket.connected
      ? "Save failed · retry"
      : "Offline · edits kept on this device";
    if (e instanceof ApiError && e.code === "STALE_EPOCH") this.onReset();
    this.onError(e);
    this.notify();
  }
  async addFiles(p: Workspace) {
    this.project = p;
    for (const f of p.files.filter((f) => f.type === "file"))
      if (!this.docs.has(f.id) && this.socket.connected)
        await this.syncFile(f.id);
    for (const [id, d] of this.docs)
      if (!p.files.some((f) => f.id === id)) {
        clearTimeout(d.timer);
        d.awareness.destroy();
        await d.storage.destroy();
        d.doc.destroy();
        this.docs.delete(id);
      }
    this.notify();
  }
  content(fileId: string) {
    return (
      this.docs.get(fileId)?.doc.getText("content").toString() ??
      this.project.files.find((f) => f.id === fileId)?.content ??
      ""
    );
  }
  async close() {
    this.closed = true;
    this.socket.disconnect();
    for (const d of this.docs.values()) {
      clearTimeout(d.timer);
      d.awareness.destroy();
      await d.storage.destroy();
      d.doc.destroy();
    }
    this.listeners.clear();
  }
}
