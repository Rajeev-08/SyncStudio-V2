import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { io, type Socket } from "socket.io-client";
import { createApp } from "../apps/api/src/app";
import { SqliteStore } from "../apps/api/src/store";
import { hash } from "../apps/api/src/auth";
import {
  localEnabled,
  localLanguage,
  toolEnv,
  runPlan,
} from "../apps/api/src/local-tools";
import type { Config } from "../apps/api/src/config";
import type { Project, Template, Reply } from "../packages/shared/src/index";
const origin = "http://localhost:5173",
  token = "local-operator-test";
const cfg: Config = {
  NODE_ENV: "test",
  PORT: 3001,
  CLIENT_URL: origin,
  DATA_DRIVER: "sqlite",
  SQLITE_PATH: ":memory:",
  MONGO_URI: "",
  AI_API_KEY: "",
  AI_BASE_URL: "https://example.test",
  AI_MODEL: "test",
  ENABLE_DEMO: "false",
  LOCAL_EXECUTION: "true",
  LOCAL_OPERATOR_EMAIL: "operator@example.test",
};
const store = new SqliteStore(),
  owner = {
    id: randomUUID(),
    username: "operator",
    email: "operator@example.test",
  },
  other = { id: randomUUID(), username: "other", email: "other@example.test" };
let app: ReturnType<typeof createApp>,
  base: string,
  dir: string,
  project: Project;
const sockets: Socket[] = [];
async function connect(
  p = project,
  cookie = `syncstudio_session=${token}`,
  sendOrigin = origin,
) {
  const s = io(base + "/local-tools", {
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
    auth: { projectId: p.id },
    extraHeaders: { Origin: sendOrigin, Cookie: cookie },
  });
  sockets.push(s);
  await new Promise<void>((resolve, reject) => {
    s.once("connect", resolve);
    s.once("connect_error", reject);
  });
  return s;
}
function request<T = unknown>(
  s: Socket,
  event: string,
  data: unknown,
): Promise<Reply<T>> {
  return new Promise((resolve, reject) =>
    s
      .timeout(10000)
      .emit(event, data, (e: Error | null, r: Reply<T>) =>
        e ? reject(e) : resolve(r),
      ),
  );
}
async function run(p: Project, input?: string) {
  const s = await connect(p);
  let output = "";
  s.on("run:data", (d) => {
    output += d;
    if (input && output.includes("Your name:")) {
      s.emit("run:input", { data: input + "\n" });
      input = undefined;
    }
  });
  const done = new Promise<{
    running: boolean;
    exitCode: number;
    stopped: boolean;
  }>((resolve) =>
    s.on("run:state", (d) => {
      if (!d.running) resolve(d);
    }),
  );
  const reply = await request(s, "run:start", {
    fileId: p.files[0].id,
    epoch: p.epoch,
  });
  expect(reply.ok).toBe(true);
  const result = await done;
  s.disconnect();
  return { output, ...result };
}
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ss-local-"));
  cfg.LOCAL_WORKSPACE_ROOT = dir;
  for (const [u, t] of [
    [owner, token],
    [other, "other-token"],
  ] as const) {
    await store.createAccount({ ...u, passwordHash: "unused" });
    await store.saveSession({
      id: hash(t),
      userId: u.id,
      expiresAt: Date.now() + 3600000,
    });
  }
  app = createApp(store, cfg);
  await new Promise<void>((r) => app.http.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(app.http.address() as { port: number }).port}`;
  project = await app.service.create(owner, {
    name: "Local tests",
    description: "",
    template: "python",
  });
});
afterAll(async () => {
  sockets.forEach((s) => s.disconnect());
  app.local.close();
  await new Promise<void>((r) => app.socket.io.close(() => r()));
  await store.close();
  await rm(dir, { recursive: true, force: true });
});
describe("local execution authorization", () => {
  it("disables local tools for production and nonlocal origins", () => {
    expect(localEnabled({ ...cfg, NODE_ENV: "production" })).toBe(false);
    expect(localEnabled({ ...cfg, CLIENT_URL: "https://example.com" })).toBe(
      false,
    );
    expect(localEnabled({ ...cfg, LOCAL_EXECUTION: "false" })).toBe(false);
  });
  it("rejects anonymous, nonoperator, and cross-origin socket connections", async () => {
    await expect(connect(project, "")).rejects.toThrow();
    await expect(
      connect(project, "syncstudio_session=other-token"),
    ).rejects.toThrow();
    await expect(
      connect(project, `syncstudio_session=${token}`, "https://evil.test"),
    ).rejects.toThrow();
  });
  it("does not give the operator shell access to projects they only edit", async () => {
    const p = await app.service.create(other, {
      name: "Other owner",
      description: "",
      template: "python",
    });
    await app.service.invite(p.id, other, owner.email, "EDITOR");
    await expect(connect(p)).rejects.toThrow();
  });
  it("reports actual tool availability and never exposes server secrets to children", async () => {
    const r = await fetch(base + "/api/local/status", {
      headers: { Cookie: `syncstudio_session=${token}` },
    });
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.authorized).toBe(true);
    expect(data.tools.javascript.version).toBe(process.version);
    process.env.SYNCSTUDIO_TEST_SECRET = "do-not-forward";
    expect(toolEnv()).not.toHaveProperty("SYNCSTUDIO_TEST_SECRET");
    delete process.env.SYNCSTUDIO_TEST_SECRET;
  });
});
describe("real programs and PTY", () => {
  it("runs Python and sends interactive stdin", async () => {
    const r = await run(project, "Rajeev");
    expect(r.exitCode).toBe(0);
    expect(r.output).toContain("Hello, Rajeev!");
  });
  for (const [template, text] of [
    ["c", "Hello from C!"],
    ["cpp", "Hello from C++!"],
    ["java", "Hello from Java!"],
  ] as const)
    it(`compiles/runs ${template} source`, async () => {
      const p = await app.service.create(owner, {
        name: template,
        description: "",
        template: template as Template,
      });
      const r = await run(p);
      expect(r.exitCode).toBe(0);
      expect(r.output).toContain(text);
    });
  it("runs Node JavaScript and TypeScript source", async () => {
    for (const extension of ["js", "ts"]) {
      const p = await app.service.create(owner, {
        name: extension,
        description: "",
        template: "python",
      });
      const f = await app.service.createFile(p.id, owner, {
        path: "main." + extension,
        type: "file",
        content:
          extension === "ts"
            ? "const value: number = 42; console.log(value);"
            : "console.log(42);",
      });
      p.files = [f];
      const r = await run(p);
      expect(r.exitCode).toBe(0);
      expect(r.output).toContain("42");
    }
  });
  it("stops a running program and rejects stale restore epochs", async () => {
    const p = await app.service.create(owner, {
      name: "loop",
      description: "",
      template: "python",
    });
    const f = await app.service.createFile(p.id, owner, {
      path: "loop.js",
      type: "file",
      content: 'console.log("ready");setInterval(()=>{},1000);',
    });
    const s = await connect(p);
    expect(
      (await request(s, "run:start", { fileId: f.id, epoch: 99 })).ok,
    ).toBe(false);
    const ready = new Promise<void>((r) =>
      s.on("run:data", (d) => {
        if (d.includes("ready")) r();
      }),
    );
    const done = new Promise<{ stopped: boolean }>((r) =>
      s.on("run:state", (d) => {
        if (!d.running) r(d);
      }),
    );
    expect((await request(s, "run:start", { fileId: f.id, epoch: 0 })).ok).toBe(
      true,
    );
    await ready;
    expect((await request(s, "run:stop", {})).ok).toBe(true);
    expect((await done).stopped).toBe(true);
    s.disconnect();
  });
  it("opens a real PTY, resizes it, accepts shell input, and revokes it on logout", async () => {
    const s = await connect();
    let text = "";
    let resolveOutput: () => void;
    const received = new Promise<void>((r) => (resolveOutput = r));
    s.on("terminal:data", (d) => {
      text += d;
      if (text.includes("PTY_RESULT_42")) resolveOutput();
    });
    expect((await request(s, "terminal:open", { cols: 90, rows: 18 })).ok).toBe(
      true,
    );
    expect(
      (await request(s, "terminal:resize", { cols: 100, rows: 20 })).ok,
    ).toBe(true);
    expect(
      (
        await request(s, "terminal:input", {
          data: "printf 'PTY_RESULT_%s\\n' 42\r",
        })
      ).ok,
    ).toBe(true);
    await received;
    const gone = new Promise<void>((r) => s.once("disconnect", () => r()));
    await store.deleteSession(hash(token));
    await gone;
    await store.saveSession({
      id: hash(token),
      userId: owner.id,
      expiresAt: Date.now() + 3600000,
    });
  });
  it("identifies supported files and builds argument arrays without shell interpolation", () => {
    expect(localLanguage("Main.java")).toBe("java");
    expect(localLanguage("index.html")).toBeUndefined();
    const plan = runPlan(
      "cpp",
      { command: "g++", prefix: [], version: "test" },
      "a (1).cpp",
      dir,
    );
    expect(plan[0].args[0]).toBe(join(dir, "a (1).cpp"));
    expect(plan).toHaveLength(2);
  });
});
