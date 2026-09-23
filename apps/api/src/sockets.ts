import pino from "pino";
import { Server } from "socket.io";
import type { Server as HttpServer } from "node:http";
import { z } from "zod";
import * as Y from "yjs";
import { authenticate } from "./auth";
import { AppError, assert } from "./errors";
import type { ProjectService } from "./service";
import {
  events,
  type Presence,
  type Reply,
} from "../../../packages/shared/src/index";
const scope = z.object({
  projectId: z.uuid(),
  fileId: z.uuid(),
  epoch: z.number().int().min(0),
});
const binary = z.custom<Uint8Array>(
  (x) => x instanceof Uint8Array && x.byteLength <= 256000,
  "Invalid or oversized document update",
);
const syncSchema = scope.extend({ vector: binary });
const updateSchema = scope.extend({ update: binary });
const relativeId = z.object({
  client: z.number().int().nonnegative().max(4294967295),
  clock: z.number().int().nonnegative(),
});
const relativePosition = z
  .object({
    type: relativeId.nullable().optional(),
    tname: z.string().max(100).nullable().optional(),
    item: relativeId.nullable().optional(),
    assoc: z.number().int().optional(),
  })
  .strict();
const presenceSchema = scope.extend({
  clientId: z.number().int().nonnegative().max(4294967295),
  selection: z
    .object({ anchor: relativePosition, head: relativePosition })
    .strict()
    .nullable()
    .optional(),
});
const colors = ["#a99cff", "#5cc8ed", "#eea968", "#e585b9", "#78c7a1"];
export function attachSockets(
  http: HttpServer,
  service: ProjectService,
  origin: string,
) {
  const logger = pino({
    level: process.env.NODE_ENV === "test" ? "silent" : "info",
  });
  const io = new Server(http, {
    maxHttpBufferSize: 300000,
    cors: { origin, credentials: true },
    allowRequest: (req, cb) =>
      cb(
        null,
        req.headers.origin === origin ||
          (!req.headers.origin &&
            req.headers["sec-fetch-site"] === "same-origin" &&
            req.headers.host === new URL(origin).host),
      ),
  });
  const presence = new Map<string, { projectId: string; presence: Presence }>();
  const emitPresence = (projectId: string) =>
    io.to(projectId).emit(
      events.presence,
      [...presence.values()]
        .filter((v) => v.projectId === projectId)
        .map((v) => v.presence),
    );
  io.use(async (socket, next) => {
    try {
      socket.data.auth = await authenticate(
        service.store,
        socket.handshake.headers.cookie,
      );
      next();
    } catch {
      next(new Error("Authentication required."));
    }
  });
  io.on("connection", (socket) => {
    logger.info(
      { socketId: socket.id, userId: socket.data.auth.user.id },
      "socket connected",
    );
    const expiry = setTimeout(
      () => socket.disconnect(true),
      Math.max(0, socket.data.auth.expiresAt - Date.now()),
    );
    let count = 0;
    let start = Date.now();
    function handle<T>(
      event: string,
      schema: z.ZodType<T>,
      action: (data: T) => Promise<unknown>,
    ) {
      socket.on(event, async (raw: unknown, ack: (r: Reply) => void) => {
        if (typeof ack !== "function") return;
        try {
          if (Date.now() - start > 10000) {
            count = 0;
            start = Date.now();
          }
          assert(
            ++count <= 600,
            429,
            "RATE_LIMIT",
            "Too many collaboration requests.",
          );
          socket.data.auth = await authenticate(
            service.store,
            socket.handshake.headers.cookie,
          );
          const data = schema.parse(raw);
          const result = await action(data);
          ack({ ok: true, data: result });
        } catch (error) {
          const e =
            error instanceof AppError
              ? error
              : new AppError(
                  400,
                  "INVALID_EVENT",
                  "Invalid collaboration event.",
                );
          ack({ ok: false, error: { code: e.code, message: e.message } });
        }
      });
    }
    handle(
      events.join,
      z.object({ projectId: z.uuid() }),
      async ({ projectId }) => {
        await service.get(projectId, socket.data.auth.user.id);
        for (const room of socket.rooms)
          if (room !== socket.id) await socket.leave(room);
        const old = presence.get(socket.id);
        presence.delete(socket.id);
        if (old) emitPresence(old.projectId);
        await socket.join(projectId);
        return { joined: true };
      },
    );
    handle(
      events.sync,
      syncSchema,
      async ({ projectId, fileId, epoch, vector }) => {
        const p = await service.get(projectId, socket.data.auth.user.id);
        assert(
          p.epoch === epoch,
          409,
          "STALE_EPOCH",
          "Project restored. Reopen the project.",
        );
        const f = p.files.find((f) => f.id === fileId && f.type === "file");
        assert(f, 404, "NOT_FOUND", "File not found.");
        const doc = new Y.Doc();
        try {
          Y.applyUpdate(doc, Buffer.from(f.state, "base64"));
          return {
            update: Y.encodeStateAsUpdate(doc, vector),
            vector: Y.encodeStateVector(doc),
          };
        } finally {
          doc.destroy();
        }
      },
    );
    handle(
      events.update,
      updateSchema,
      async ({ projectId, fileId, epoch, update }) => {
        assert(
          socket.rooms.has(projectId),
          403,
          "ROOM_FORBIDDEN",
          "Join the project first.",
        );
        const result = await service.update(
          projectId,
          socket.data.auth.user,
          fileId,
          epoch,
          update,
        );
        io.to(projectId).emit(events.update, { fileId, epoch, update });
        return result;
      },
    );
    handle(
      events.awareness,
      presenceSchema,
      async ({ projectId, fileId, epoch, clientId, selection }) => {
        assert(
          socket.rooms.has(projectId),
          403,
          "ROOM_FORBIDDEN",
          "Join the project first.",
        );
        const p = await service.get(projectId, socket.data.auth.user.id);
        assert(
          p.epoch === epoch && p.files.some((f) => f.id === fileId),
          409,
          "STALE_FILE",
          "File is no longer available.",
        );
        assert(
          JSON.stringify(selection ?? null).length <= 4096,
          422,
          "PRESENCE_LIMIT",
          "Selection too large.",
        );
        assert(
          ![...presence.entries()].some(
            ([sid, x]) =>
              sid !== socket.id &&
              x.projectId === projectId &&
              x.presence.clientId === clientId,
          ),
          409,
          "CLIENT_CONFLICT",
          "A duplicate client identity is connected.",
        );
        const user = socket.data.auth.user;
        const color = colors[parseInt(user.id.slice(0, 4), 16) % colors.length];
        presence.set(socket.id, {
          projectId,
          presence: {
            fileId,
            clientId,
            selection,
            user: { ...user, color, colorLight: color + "33" },
          },
        });
        emitPresence(projectId);
        return { online: true };
      },
    );
    socket.on("disconnect", () => {
      clearTimeout(expiry);
      logger.info({ socketId: socket.id }, "socket disconnected");
      const old = presence.get(socket.id);
      presence.delete(socket.id);
      if (old) emitPresence(old.projectId);
    });
  });
  return {
    io,
    changed: (id: string) => io.to(id).emit(events.changed),
    reset: (id: string) => {
      io.to(id).emit(events.reset);
      for (const [sid, p] of presence)
        if (p.projectId === id) presence.delete(sid);
      emitPresence(id);
    },
    revoke: async (id: string, uid: string) => {
      for (const socket of await io.in(id).fetchSockets())
        if (socket.data.auth?.user.id === uid) {
          socket.emit(events.revoked);
          await socket.leave(id);
          presence.delete(socket.id);
        }
      emitPresence(id);
    },
    logout: async (sessionId: string) => {
      for (const socket of await io.fetchSockets())
        if (socket.data.auth?.sessionId === sessionId) socket.disconnect(true);
    },
  };
}
