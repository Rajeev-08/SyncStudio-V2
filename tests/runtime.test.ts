import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, request as nodeRequest, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { SqliteStore } from "../apps/api/src/store";
import { hash } from "../apps/api/src/auth";
import type { Config } from "../apps/api/src/config";
import { createRunner } from "../apps/runner/src/server";
import {
  Manager,
  type RecordData,
  type Start,
} from "../apps/runner/src/manager";
import {
  treeHash,
  workspaceKey,
  runtimeFilesSchema,
  type RuntimeFile,
} from "../packages/shared/src/runtime";
import { AppError } from "../apps/api/src/errors";
import type { Project, User } from "../packages/shared/src/index";
const secret = "runtime-test-".repeat(6),
  origin = "http://localhost:5173";
const port = (s: Server) => (s.address() as { port: number }).port;
const listen = (s: Server) =>
  new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
const store = new SqliteStore();
const cfg: Config = {
  NODE_ENV: "test",
  PORT: 3001,
  CLIENT_URL: origin,
  DATA_DRIVER: "sqlite",
  SQLITE_PATH: ":memory:",
  MONGO_URI: "",
  AI_API_KEY: "",
  AI_BASE_URL: "https://example.com",
  AI_MODEL: "test",
  ENABLE_DEMO: "false",
  RUNNER_SECRET: secret,
  RUNNER_URL: "http://127.0.0.1:1",
};
const app = createApp(store, cfg);
const upstream = createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify({
      path: req.url,
      cookie: req.headers.cookie,
      authorization: req.headers.authorization,
    }),
  );
});
const upstreamSockets = new Set<import("node:net").Socket>();
upstream.on("connection", (socket) => {
  upstreamSockets.add(socket);
  socket.on("close", () => upstreamSockets.delete(socket));
});
upstream.on("upgrade", (_req, socket) => {
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
  );
  socket.on("data", (data) => socket.write(data));
  socket.on("error", () => undefined);
});
class TestManager extends Manager {
  records = new Map<string, RecordData>();
  files = new Map<string, RuntimeFile[]>();
  running = new Set<string>();
  constructor() {
    super("/tmp/nonexistent-syncstudio-test", "test");
  }
  override async read(k: string) {
    return this.records.get(k) ?? null;
  }
  override async save(k: string, d: RecordData) {
    this.records.set(k, d);
  }
  override async status(k: string) {
    const m = this.records.get(k);
    if (!m) return { state: "absent" };
    return {
      state: this.running.has(k) ? "running" : "stopped",
      template: m.template,
      initialized: m.initialized,
      lastUsed: m.lastUsed,
      error: m.error,
      limits: { cpus: 2, memoryGB: 2 },
    };
  }
  override async start(k: string, d: Start) {
    if (!this.records.has(k)) {
      await this.save(k, { ...d, lastUsed: Date.now(), initialized: true });
      this.files.set(k, d.files);
    }
    this.running.add(k);
    return this.status(k);
  }
  override async target(k: string) {
    if (!this.running.has(k)) throw new AppError(409, "STOPPED", "Stopped");
    return { hostname: "127.0.0.1", port: port(upstream) };
  }
  override async stop(k: string) {
    this.running.delete(k);
    return this.status(k);
  }
  override async remove(k: string) {
    this.records.delete(k);
    this.files.delete(k);
    this.running.delete(k);
    return { ok: true };
  }
  override async export(k: string) {
    return {
      files: this.files.get(k),
      baseHash: this.records.get(k)!.baseHash,
      skipped: [],
    };
  }
}
const manager = new TestManager();
let runner: ReturnType<typeof createRunner>,
  base: string,
  owner: User,
  viewer: User,
  project: Project,
  key: string;
const ownerToken = "owner-runtime-session",
  viewerToken = "viewer-runtime-session";
const cookie = (token = ownerToken) => `syncstudio_session=${token}`;
async function api(
  path: string,
  method = "GET",
  body?: unknown,
  token = ownerToken,
  requestOrigin = origin,
) {
  const r = await fetch(base + "/api" + path, {
    method,
    headers: {
      Cookie: cookie(token),
      Origin: requestOrigin,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, data: await r.json() };
}
async function gateway(
  path: string,
  method = "GET",
  body?: unknown,
  session = "",
  hostKey = key,
  requestOrigin?: string,
) {
  return new Promise<{ status: number; body: string; cookie: string }>(
    (resolve, reject) => {
      const req = nodeRequest(
        {
          host: "127.0.0.1",
          port: port(runner.gateway),
          path,
          method,
          headers: {
            Host: `${hostKey}.localhost:3002`,
            Cookie: session,
            "Content-Type": "application/json",
            ...(requestOrigin ? { Origin: requestOrigin } : {}),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (b) => (data += b));
          res.on("end", () =>
            resolve({
              status: res.statusCode!,
              body: data,
              cookie: res.headers["set-cookie"]?.[0].split(";")[0] ?? "",
            }),
          );
        },
      );
      req.on("error", reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    },
  );
}
async function launch() {
  const r = await api(`/projects/${project.id}/runtime/launch`, "POST", {});
  expect(r.status).toBe(200);
  return new URL(r.data.url).hash.slice(8);
}
beforeAll(async () => {
  await listen(app.http);
  base = `http://127.0.0.1:${port(app.http)}`;
  await listen(upstream);
  runner = createRunner(
    {
      secret,
      publicURL: "http://localhost:3002",
      appURL: base,
      dataDir: "/tmp/nonexistent-syncstudio-test",
      runnerName: "test",
      maxRunning: 6,
      idleMinutes: 30,
    },
    manager,
  );
  await listen(runner.control);
  await listen(runner.gateway);
  cfg.RUNNER_URL = `http://127.0.0.1:${port(runner.control)}`;
  owner = {
    id: randomUUID(),
    username: "runtimeOwner",
    email: "owner@runtime.test",
  };
  viewer = {
    id: randomUUID(),
    username: "runtimeViewer",
    email: "viewer@runtime.test",
  };
  for (const [u, t] of [
    [owner, ownerToken],
    [viewer, viewerToken],
  ] as const) {
    await store.createAccount({ ...u, passwordHash: "unused" });
    await store.saveSession({
      id: hash(t),
      userId: u.id,
      expiresAt: Date.now() + 3600000,
    });
  }
  project = await app.service.create(owner, {
    name: "Runtime tests",
    description: "",
    template: "vanilla",
  });
  await app.service.invite(project.id, owner, viewer.email, "VIEWER");
  key = workspaceKey(project.id, owner.id);
});
afterAll(async () => {
  await runner.close();
  for (const socket of upstreamSockets) socket.destroy();
  await new Promise<void>((r) => upstream.close(() => r()));
  await new Promise<void>((r) => app.socket.io.close(() => r()));
  await store.close();
});
describe("full IDE lifecycle and access", () => {
  it("requires authentication and rejects viewer launch and cross-origin provisioning", async () => {
    expect(
      (await api(`/projects/${project.id}/runtime`, "GET", undefined, ""))
        .status,
    ).toBe(401);
    expect(
      (
        await api(
          `/projects/${project.id}/runtime/start`,
          "POST",
          { template: "web" },
          viewerToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await api(
          `/projects/${project.id}/runtime/start`,
          "POST",
          { template: "web" },
          ownerToken,
          "https://evil.test",
        )
      ).status,
    ).toBe(403);
    expect((await fetch(cfg.RUNNER_URL + "/health")).status).toBe(401);
    expect(
      (
        await fetch(base + "/internal/workspaces/authorize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
    ).toBe(401);
  });
  it("starts a personal environment and resumes persistent files", async () => {
    const path = `/projects/${project.id}/runtime`;
    expect(
      (await api(path + "/start", "POST", { template: "python" })).data.state,
    ).toBe("running");
    manager.files
      .get(key)!
      .push({ path: "main.py", type: "file", content: "print(42)" });
    expect((await api(path + "/stop", "POST", {})).data.state).toBe("stopped");
    expect((await api(path + "/launch", "POST", {})).status).toBe(409);
    await api(path + "/start", "POST", { template: "python" });
    expect(manager.files.get(key)!.some((f) => f.path === "main.py")).toBe(
      true,
    );
  });
  it("uses one-use tickets, scoped sessions, and strips platform credentials", async () => {
    expect((await gateway("/")).status).toBe(401);
    const ticket = await launch();
    const signed = await gateway(
      "/session",
      "POST",
      { ticket },
      "",
      key,
      `http://${key}.localhost:3002`,
    );
    expect(signed.status).toBe(204);
    expect(signed.cookie).toMatch(/^ss_ide=/);
    expect(
      (
        await gateway(
          "/session",
          "POST",
          { ticket },
          "",
          key,
          `http://${key}.localhost:3002`,
        )
      ).status,
    ).toBe(401);
    const result = await gateway(
      "/test?value=42",
      "GET",
      undefined,
      signed.cookie + "; " + cookie(),
    );
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body)).toMatchObject({
      path: "/test?value=42",
      cookie: "",
    });
    expect(
      (await gateway("/", "GET", undefined, signed.cookie, "a".repeat(32)))
        .status,
    ).toBe(401);
    expect(
      (
        await gateway(
          "/",
          "GET",
          undefined,
          signed.cookie,
          key,
          "https://evil.test",
        )
      ).status,
    ).toBe(403);
  });
  it("requires ownership to review and import, and creates a recovery snapshot", async () => {
    await app.service.member(project.id, owner, viewer.id, "EDITOR");
    await api(
      `/projects/${project.id}/runtime/start`,
      "POST",
      { template: "python" },
      viewerToken,
    );
    expect(
      (
        await api(
          `/projects/${project.id}/runtime/review`,
          "POST",
          {},
          viewerToken,
        )
      ).status,
    ).toBe(403);
    const review = await api(
      `/projects/${project.id}/runtime/review`,
      "POST",
      {},
    );
    expect(review.status).toBe(200);
    expect(
      review.data.changes.some((f: { path: string }) => f.path === "main.py"),
    ).toBe(true);
    const result = await api(`/projects/${project.id}/runtime/import`, "POST", {
      reviewId: review.data.reviewId,
    });
    expect(result.status).toBe(200);
    const p = await app.service.get(project.id, owner.id);
    expect(p.files.find((f) => f.path === "main.py")?.content).toBe(
      "print(42)",
    );
    expect(p.epoch).toBe(1);
    expect(p.versions[0].message).toContain("Recovery");
    expect(
      (
        await api(`/projects/${project.id}/runtime/import`, "POST", {
          reviewId: review.data.reviewId,
        })
      ).status,
    ).toBe(409);
  });
  it("rejects project edits during review and does not overwrite them", async () => {
    const review = await api(
      `/projects/${project.id}/runtime/review`,
      "POST",
      {},
    );
    expect(review.status).toBe(200);
    await app.service.createFile(project.id, owner, {
      path: "new.txt",
      type: "file",
      content: "Keep me",
    });
    expect(
      (
        await api(`/projects/${project.id}/runtime/import`, "POST", {
          reviewId: review.data.reviewId,
        })
      ).status,
    ).toBe(409);
    expect(
      (await api(`/projects/${project.id}/runtime/review`, "POST", {})).status,
    ).toBe(409);
    expect(
      (await app.service.get(project.id, owner.id)).files.find(
        (f) => f.path === "new.txt",
      )?.content,
    ).toBe("Keep me");
  });
  it("revokes gateway requests after logout", async () => {
    const ticket = await launch();
    const signed = await gateway(
      "/session",
      "POST",
      { ticket },
      "",
      key,
      `http://${key}.localhost:3002`,
    );
    await store.deleteSession(hash(ownerToken));
    expect((await gateway("/", "GET", undefined, signed.cookie)).status).toBe(
      401,
    );
    await store.saveSession({
      id: hash(ownerToken),
      userId: owner.id,
      expiresAt: Date.now() + 3600000,
    });
  });
  it("proxies terminal WebSocket bytes and closes access after session revocation", async () => {
    const ticket = await launch();
    const signed = await gateway(
      "/session",
      "POST",
      { ticket },
      "",
      key,
      `http://${key}.localhost:3002`,
    );
    const client = await new Promise<import("node:stream").Duplex>(
      (resolve, reject) => {
        const req = nodeRequest({
          host: "127.0.0.1",
          port: port(runner.gateway),
          path: "/socket",
          headers: {
            Host: `${key}.localhost:3002`,
            Cookie: signed.cookie,
            Origin: `http://${key}.localhost:3002`,
            Connection: "Upgrade",
            Upgrade: "websocket",
          },
        });
        req.on("upgrade", (_response, socket) => resolve(socket));
        req.on("error", reject);
        req.on("response", () => reject(new Error("Upgrade rejected")));
        req.end();
      },
    );
    const echoed = new Promise<string>((resolve) =>
      client.once("data", (b) => resolve(b.toString())),
    );
    client.write("terminal-stream");
    expect(await echoed).toBe("terminal-stream");
    const closed = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Revoked socket remained open")),
        7000,
      );
      client.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    await store.deleteSession(hash(ownerToken));
    await closed;
    await store.saveSession({
      id: hash(ownerToken),
      userId: owner.id,
      expiresAt: Date.now() + 3600000,
    });
  });
  it("requires typed confirmation before deleting a workspace", async () => {
    expect(
      (await api(`/projects/${project.id}/runtime`, "DELETE", {})).status,
    ).toBe(400);
    expect(
      (
        await api(`/projects/${project.id}/runtime`, "DELETE", {
          confirmation: "DELETE WORKSPACE",
        })
      ).status,
    ).toBe(200);
    expect((await api(`/projects/${project.id}/runtime`)).data.state).toBe(
      "absent",
    );
  });
});
describe("import tree validation", () => {
  it("rejects traversal, duplicate paths, absent parents, and oversize trees", () => {
    const f = { path: "a.txt", type: "file" as const, content: "hello" };
    for (const files of [
      [{ ...f, path: "../escape" }],
      [f, f],
      [{ ...f, path: "missing/file" }],
      Array.from({ length: 151 }, (_, i) => ({ ...f, path: `${i}.txt` })),
    ])
      expect(runtimeFilesSchema.safeParse(files).success).toBe(false);
  });
  it("hashes semantic file contents independent of order and database IDs", () => {
    const a = { path: "a", type: "file" as const, content: "a" },
      b = { ...a, path: "b" };
    expect(treeHash([a, b])).toBe(treeHash([b, a]));
    expect(treeHash([a])).not.toBe(treeHash([{ ...a, content: "changed" }]));
  });
});
