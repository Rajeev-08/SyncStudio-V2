import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { io, type Socket } from "socket.io-client";
import * as Y from "yjs";
import { SqliteStore } from "../apps/api/src/store";
import { createApp } from "../apps/api/src/app";
import type { Config } from "../apps/api/src/config";
import type {
  Project,
  Workspace,
  Version,
  User,
  Reply,
} from "../packages/shared/src/index";
import { events } from "../packages/shared/src/index";
const origin = "http://localhost:5173";
const cfg: Config = {
  NODE_ENV: "test",
  PORT: 3001,
  CLIENT_URL: origin,
  DATA_DRIVER: "sqlite",
  SQLITE_PATH: ":memory:",
  MONGO_URI: "",
  AI_API_KEY: "",
  AI_BASE_URL: "https://example.com/v1",
  AI_MODEL: "test",
  ENABLE_DEMO: "false",
};
const store = new SqliteStore(),
  app = createApp(store, cfg);
let base: string;
let owner: { user: User; cookie: string },
  editor: { user: User; cookie: string },
  viewer: { user: User; cookie: string },
  outsider: { user: User; cookie: string };
let project: Project;
const sockets: Socket[] = [];
async function request<T = Record<string, unknown>>(
  path: string,
  method = "GET",
  body?: unknown,
  cookie = owner?.cookie ?? "",
  sendOrigin = origin,
) {
  const response = await fetch(base + "/api" + path, {
    method,
    headers: {
      Origin: sendOrigin,
      Cookie: cookie,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    data: (await response.json()) as T,
    cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
  };
}
async function register(name: string) {
  const res = await request<User>(
    "/auth/register",
    "POST",
    {
      username: name,
      email: name + "@example.com",
      password: "CorrectHorse123!",
    },
    "",
  );
  expect(res.status).toBe(201);
  return { user: res.data, cookie: res.cookie };
}
async function connect(cookie: string) {
  const socket = io(base, {
    transports: ["websocket"],
    forceNew: true,
    extraHeaders: { Origin: origin, Cookie: cookie },
    reconnection: false,
  });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", reject);
  });
  return socket;
}
async function event<T>(socket: Socket, name: string, data: unknown) {
  return new Promise<Reply<T>>((resolve, reject) =>
    socket
      .timeout(5000)
      .emit(name, data, (err: Error | null, result: Reply<T>) =>
        err ? reject(err) : resolve(result),
      ),
  );
}
beforeAll(async () => {
  await new Promise<void>((resolve) =>
    app.http.listen(0, "127.0.0.1", resolve),
  );
  base = `http://127.0.0.1:${(app.http.address() as { port: number }).port}`;
  owner = await register("owner");
  editor = await register("editor");
  viewer = await register("viewer");
  outsider = await register("outsider");
  project = (
    await request<Project>("/projects", "POST", {
      name: "Integration workspace",
      template: "vanilla",
    })
  ).data;
});
afterAll(async () => {
  sockets.forEach((s) => s.disconnect());
  await new Promise<void>((resolve) => app.socket.io.close(() => resolve()));
  await store.close();
});
describe("authentication and REST authorization", () => {
  it("restores an authenticated session", async () => {
    const r = await request<User>("/auth/me");
    expect(r.data.id).toBe(owner.user.id);
    expect(r.data).not.toHaveProperty("passwordHash");
  });
  it("rejects anonymous requests and forged cookies", async () => {
    expect((await request("/projects", "GET", undefined, "")).status).toBe(401);
    expect(
      (await request("/projects", "GET", undefined, "syncstudio_session=fake"))
        .status,
    ).toBe(401);
  });
  it("rejects wrong password without account details", async () => {
    expect(
      (
        await request("/auth/login", "POST", {
          email: "owner@example.com",
          password: "WrongPassword123",
        })
      ).status,
    ).toBe(401);
  });
  it("rejects invalid registration and case-insensitive duplicate usernames", async () => {
    expect(
      (
        await request("/auth/register", "POST", {
          username: "bad",
          email: "invalid",
          password: "a",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/auth/register", "POST", {
          username: "OWNER",
          email: "another@example.com",
          password: "CorrectHorse123!",
        })
      ).status,
    ).toBe(409);
  });
  it("blocks cross-origin state changes", async () => {
    expect(
      (
        await request(
          "/projects",
          "POST",
          { name: "evil" },
          owner.cookie,
          "https://evil.test",
        )
      ).status,
    ).toBe(403);
  });
  it("denies nonmembers private project reads and writes", async () => {
    expect(
      (
        await request(
          `/projects/${project.id}`,
          "GET",
          undefined,
          outsider.cookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          `/projects/${project.id}/files`,
          "POST",
          { path: "stolen.js" },
          outsider.cookie,
        )
      ).status,
    ).toBe(403);
  });
  it("invites editors and viewers with server-enforced roles", async () => {
    expect(
      (
        await request(`/projects/${project.id}/members`, "POST", {
          email: editor.user.email,
          role: "EDITOR",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(`/projects/${project.id}/members`, "POST", {
          email: viewer.user.email,
          role: "VIEWER",
        })
      ).status,
    ).toBe(200);
    const p = await request<Workspace>(
      `/projects/${project.id}`,
      "GET",
      undefined,
      viewer.cookie,
    );
    expect(p.data.role).toBe("VIEWER");
    expect(p.data.people).toHaveLength(3);
  });
  it("rejects viewer edits and editor owner operations", async () => {
    expect(
      (
        await request(
          `/projects/${project.id}/files`,
          "POST",
          { path: "readonly.js" },
          viewer.cookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          `/projects/${project.id}`,
          "PATCH",
          { name: "hijack" },
          editor.cookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          `/projects/${project.id}/members`,
          "POST",
          { email: outsider.user.email, role: "EDITOR" },
          editor.cookie,
        )
      ).status,
    ).toBe(403);
  });
  it("protects owner role and validates identifiers", async () => {
    expect(
      (
        await request(
          `/projects/${project.id}/members/${owner.user.id}`,
          "DELETE",
        )
      ).status,
    ).toBe(422);
    expect((await request("/projects/not-an-id")).status).toBe(400);
  });
  it("reports missing AI configuration without fabricated responses", async () => {
    const r = await request(`/projects/${project.id}/ai`, "POST", {
      fileId: project.files[0].id,
      question: "Explain",
    });
    expect(r.status).toBe(503);
  });
});
describe("filesystem and history", () => {
  let folderId: string;
  let childId: string;
  let snapshotId: string;
  it("creates nested folders/files and rejects traversal, missing parent and duplicate paths", async () => {
    folderId = (
      await request<{ id: string }>(`/projects/${project.id}/files`, "POST", {
        path: "src",
        type: "folder",
      })
    ).data.id;
    childId = (
      await request<{ id: string }>(
        `/projects/${project.id}/files`,
        "POST",
        { path: "src/app.ts", content: "export const answer = 42;" },
        editor.cookie,
      )
    ).data.id;
    expect(childId).toBeTruthy();
    expect(
      (
        await request(`/projects/${project.id}/files`, "POST", {
          path: "../bad.js",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(`/projects/${project.id}/files`, "POST", {
          path: "missing/app.js",
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await request(`/projects/${project.id}/files`, "POST", {
          path: "src/app.ts",
        })
      ).status,
    ).toBe(409);
  });
  it("renames subtrees consistently and rejects self-nesting", async () => {
    expect(
      (
        await request(`/projects/${project.id}/files/${folderId}`, "PATCH", {
          path: "lib",
        })
      ).status,
    ).toBe(200);
    const p = (await request<Workspace>(`/projects/${project.id}`)).data;
    expect(p.files.find((f) => f.id === childId)?.path).toBe("lib/app.ts");
    expect(
      (
        await request(`/projects/${project.id}/files/${folderId}`, "PATCH", {
          path: "lib/inside",
        })
      ).status,
    ).toBe(422);
  });
  it("creates comments with reply and resolve and rejects viewer comments", async () => {
    const body = {
      fileId: childId,
      line: 1,
      endLine: 1,
      body: "Review this function",
    };
    expect(
      (
        await request(
          `/projects/${project.id}/comments`,
          "POST",
          body,
          viewer.cookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          `/projects/${project.id}/comments`,
          "POST",
          body,
          editor.cookie,
        )
      ).status,
    ).toBe(201);
    const p = (await request<Workspace>(`/projects/${project.id}`)).data;
    expect(
      (
        await request(
          `/projects/${project.id}/comments/${p.comments[0].id}`,
          "PATCH",
          { reply: "Looks good", resolved: true },
        )
      ).status,
    ).toBe(200);
  });
  it("snapshots preserve the full tree and produce a recovery copy on restore", async () => {
    snapshotId = (
      await request<Version>(
        `/projects/${project.id}/versions`,
        "POST",
        { message: "Before deletion" },
        editor.cookie,
      )
    ).data.id;
    await request(`/projects/${project.id}/files/${folderId}`, "DELETE");
    let p = (await request<Workspace>(`/projects/${project.id}`)).data;
    expect(p.files.some((f) => f.path.startsWith("lib"))).toBe(false);
    expect(
      (
        await request(
          `/projects/${project.id}/versions/${snapshotId}/restore`,
          "POST",
          {},
          editor.cookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          `/projects/${project.id}/versions/${snapshotId}/restore`,
          "POST",
        )
      ).status,
    ).toBe(200);
    p = (await request<Workspace>(`/projects/${project.id}`)).data;
    expect(p.files.some((f) => f.path === "lib/app.ts")).toBe(true);
    expect(p.files.some((f) => f.path === "lib" && f.type === "folder")).toBe(
      true,
    );
    expect(p.epoch).toBe(1);
    expect(p.versions[0].message).toMatch(/^Recovery/);
    expect(p.comments).toHaveLength(0);
    expect(p.activity.some((a) => a.action === "restored snapshot")).toBe(true);
    project = await app.service.get(project.id, owner.user.id);
  });
  it("rejects cross-project snapshot restore", async () => {
    const other = (
      await request<Project>("/projects", "POST", { name: "Other" })
    ).data;
    expect(
      (
        await request(
          `/projects/${other.id}/versions/${snapshotId}/restore`,
          "POST",
        )
      ).status,
    ).toBe(404);
  });
});
describe("authenticated sockets and convergence", () => {
  let a: Socket, b: Socket, v: Socket;
  let fileId: string;
  it("rejects anonymous socket handshakes", async () => {
    await expect(connect("")).rejects.toThrow();
  });
  it("rejects nonmember rooms and allows members", async () => {
    const c = await connect(outsider.cookie);
    expect((await event(c, events.join, { projectId: project.id })).ok).toBe(
      false,
    );
    a = await connect(owner.cookie);
    b = await connect(editor.cookie);
    v = await connect(viewer.cookie);
    for (const s of [a, b, v])
      expect((await event(s, events.join, { projectId: project.id })).ok).toBe(
        true,
      );
    fileId = project.files.find((f) => f.type === "file")!.id;
  });
  it("blocks viewer updates, malformed binary and stale restore epochs", async () => {
    const update = Y.encodeStateAsUpdate(new Y.Doc());
    expect(
      (
        await event(v, events.update, {
          projectId: project.id,
          fileId,
          epoch: project.epoch,
          update,
        })
      ).error?.code,
    ).toBe("ROLE_FORBIDDEN");
    expect(
      (
        await event(a, events.update, {
          projectId: project.id,
          fileId,
          epoch: 0,
          update,
        })
      ).error?.code,
    ).toBe("STALE_EPOCH");
    expect(
      (
        await event(a, events.update, {
          projectId: project.id,
          fileId,
          epoch: project.epoch,
          update: Buffer.from([255]),
        })
      ).ok,
    ).toBe(false);
  });
  it("converges 8 concurrent clients with offline edits and no missing insertions", async () => {
    const seed = new Y.Doc();
    Y.applyUpdate(
      seed,
      Buffer.from(project.files.find((f) => f.id === fileId)!.state, "base64"),
    );
    const docs = Array.from({ length: 8 }, () => {
      const d = new Y.Doc();
      Y.applyUpdate(d, Y.encodeStateAsUpdate(seed));
      return d;
    });
    const sv = Y.encodeStateVector(seed);
    docs.forEach((d, i) => d.getText("content").insert(0, `CLIENT_${i}\n`));
    const updates = docs.map((d) => Y.encodeStateAsUpdate(d, sv));
    const replies = await Promise.all(
      updates.map((update, i) =>
        event(i % 2 ? a : b, events.update, {
          projectId: project.id,
          fileId,
          epoch: project.epoch,
          update,
        }),
      ),
    );
    expect(replies.every((r) => r.ok)).toBe(true);
    for (const d of docs) {
      const sync = await event<{ update: Uint8Array; vector: Uint8Array }>(
        a,
        events.sync,
        {
          projectId: project.id,
          fileId,
          epoch: project.epoch,
          vector: Y.encodeStateVector(d),
        },
      );
      Y.applyUpdate(d, new Uint8Array(sync.data!.update));
    }
    const converged = docs[0].getText("content").toString();
    for (const d of docs)
      expect(d.getText("content").toString()).toBe(converged);
    for (let i = 0; i < 8; i++)
      expect(converged.split(`CLIENT_${i}`).length - 1).toBe(1);
    docs[0].getText("content").insert(0, "OFFLINE_EDIT\n");
    const disconnectedUpdate = Y.encodeStateAsUpdate(
      docs[0],
      Y.encodeStateVector(docs[1]),
    );
    await event(a, events.update, {
      projectId: project.id,
      fileId,
      epoch: project.epoch,
      update: disconnectedUpdate,
    });
    const persisted = await app.service.get(project.id, owner.user.id);
    expect(persisted.files.find((f) => f.id === fileId)!.content).toContain(
      "OFFLINE_EDIT",
    );
    docs.forEach((d) => d.destroy());
    seed.destroy();
  });
  it("broadcasts updates to a second connected user", async () => {
    const received = new Promise<{ fileId: string }>((resolve) =>
      b.once(events.update, resolve),
    );
    const p = await app.service.get(project.id, owner.user.id);
    const d = new Y.Doc();
    Y.applyUpdate(
      d,
      Buffer.from(p.files.find((f) => f.id === fileId)!.state, "base64"),
    );
    const sv = Y.encodeStateVector(d);
    d.getText("content").insert(0, "BROADCAST\n");
    await event(a, events.update, {
      projectId: project.id,
      fileId,
      epoch: project.epoch,
      update: Y.encodeStateAsUpdate(d, sv),
    });
    expect((await received).fileId).toBe(fileId);
    d.destroy();
  });
  it("derives presence identity from session and publishes leave events", async () => {
    const receive = new Promise<{ user: User }[]>((resolve) =>
      b.once(events.presence, resolve),
    );
    const r = await event(a, events.awareness, {
      projectId: project.id,
      fileId,
      epoch: project.epoch,
      clientId: 123,
      selection: null,
      user: { id: outsider.user.id, username: "spoof" },
    });
    expect(r.ok).toBe(true);
    expect((await receive)[0].user.id).toBe(owner.user.id);
    const left = new Promise<unknown[]>((resolve) =>
      b.once(events.presence, resolve),
    );
    a.disconnect();
    expect(await left).toHaveLength(0);
  });
  it("revokes a connected editor immediately and prevents subsequent writes", async () => {
    await request(
      `/projects/${project.id}/members/${editor.user.id}`,
      "DELETE",
    );
    expect((await event(b, events.join, { projectId: project.id })).ok).toBe(
      false,
    );
    expect(
      (
        await event(b, events.update, {
          projectId: project.id,
          fileId,
          epoch: project.epoch,
          update: Y.encodeStateAsUpdate(new Y.Doc()),
        })
      ).ok,
    ).toBe(false);
  });
  it("invalidates sessions on logout", async () => {
    const signed = await request<User>(
      "/auth/login",
      "POST",
      { email: viewer.user.email, password: "CorrectHorse123!" },
      "",
    );
    expect(signed.status).toBe(200);
    expect(
      (await request("/auth/logout", "POST", {}, signed.cookie)).status,
    ).toBe(200);
    expect(
      (await request("/auth/me", "GET", undefined, signed.cookie)).status,
    ).toBe(401);
  });
});
