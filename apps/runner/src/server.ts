import express from "express";
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { Duplex } from "node:stream";
import { randomBytes } from "node:crypto";
import { parse, serialize } from "cookie";
import { z } from "zod";
import { readdir } from "node:fs/promises";
import { Manager, startSchema } from "./manager";
import { secretMatches } from "../../api/src/runtime";
import { AppError, assert } from "../../api/src/errors";
import { workspaceKey } from "../../../packages/shared/src/runtime";
export interface RunnerConfig {
  secret: string;
  publicURL: string;
  appURL: string;
  dataDir: string;
  runnerName: string;
  maxRunning: number;
  idleMinutes: number;
}
interface Grant {
  key: string;
  projectId: string;
  userId: string;
  sessionId: string;
  expires: number;
}
export function createRunner(
  cfg: RunnerConfig,
  manager = new Manager(
    cfg.dataDir,
    cfg.runnerName,
    cfg.maxRunning,
    new URL(cfg.publicURL).hostname,
  ),
) {
  assert(
    cfg.secret.length >= 32,
    500,
    "CONFIG",
    "RUNNER_SECRET must contain at least 32 characters",
  );
  const publicURL = new URL(cfg.publicURL);
  assert(
    publicURL.pathname === "/" && !publicURL.search && !publicURL.hash,
    500,
    "CONFIG",
    "IDE_PUBLIC_URL must be an origin",
  );
  const origin = (key: string) =>
    `${publicURL.protocol}//${key}.${publicURL.host}`;
  const tickets = new Map<string, Grant>(),
    sessions = new Map<string, Grant>();
  const peers = new Map<Duplex, { grant: Grant; upstream: Duplex }>();
  const activity = new Map<string, number>();
  const internal = express();
  internal.disable("x-powered-by");
  internal.use((req, _res, next) => {
    try {
      assert(
        secretMatches(req.headers.authorization, cfg.secret),
        401,
        "UNAUTHENTICATED",
        "Unauthorized",
      );
      next();
    } catch (e) {
      next(e);
    }
  });
  internal.use(express.json({ limit: "3mb" }));
  const keyOf = (key: unknown) =>
    z
      .string()
      .regex(/^[a-f0-9]{32}$/)
      .parse(key);
  const prune = () => {
    for (const map of [tickets, sessions])
      for (const [id, g] of map) if (g.expires < Date.now()) map.delete(id);
  };
  async function validate(g: Grant) {
    assert(
      g.expires > Date.now(),
      401,
      "EXPIRED",
      "Reopen the IDE from SyncStudio.",
    );
    const response = await fetch(
      `${cfg.appURL}/internal/workspaces/authorize`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId: g.sessionId,
          projectId: g.projectId,
          userId: g.userId,
        }),
        signal: AbortSignal.timeout(5000),
      },
    );
    assert(
      response.ok,
      401,
      "REVOKED",
      "Your workspace access expired or was revoked. Reopen it from SyncStudio.",
    );
  }
  internal.delete("/projects/:id", async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    for (const map of [tickets, sessions])
      for (const [token, g] of map) if (g.projectId === id) map.delete(token);
    for (const [client, p] of peers)
      if (p.grant.projectId === id) {
        client.destroy();
        p.upstream.destroy();
      }
    res.json(await manager.removeProject(id));
  });
  internal.get("/health", (_req, res) => res.json({ ok: true }));
  internal.get("/runtimes/:key", async (req, res) =>
    res.json(await manager.status(keyOf(req.params.key))),
  );
  internal.post("/runtimes/:key/start", async (req, res) =>
    res.json(
      await manager.start(keyOf(req.params.key), startSchema.parse(req.body)),
    ),
  );
  internal.post("/runtimes/:key/stop", async (req, res) => {
    const key = keyOf(req.params.key);
    for (const [peer, p] of peers)
      if (p.grant.key === key) {
        peer.destroy();
        p.upstream.destroy();
      }
    res.json(await manager.stop(key));
  });
  internal.delete("/runtimes/:key", async (req, res) => {
    const key = keyOf(req.params.key);
    for (const map of [tickets, sessions])
      for (const [id, g] of map) if (g.key === key) map.delete(id);
    for (const [peer, p] of peers)
      if (p.grant.key === key) {
        peer.destroy();
        p.upstream.destroy();
      }
    res.json(await manager.remove(key));
  });
  internal.post("/runtimes/:key/export", async (req, res) =>
    res.json(await manager.export(keyOf(req.params.key))),
  );
  internal.post("/runtimes/:key/baseline", async (req, res) => {
    const key = keyOf(req.params.key),
      { baseHash } = z
        .object({ baseHash: z.string().regex(/^[a-f0-9]{64}$/) })
        .strict()
        .parse(req.body);
    await manager.serial(key, async () => {
      const data = await manager.read(key);
      assert(data, 404, "NOT_FOUND", "Workspace missing");
      await manager.save(key, { ...data, baseHash });
    });
    res.json({ ok: true });
  });
  internal.post("/runtimes/:key/launch", async (req, res) => {
    const key = keyOf(req.params.key);
    const data = z
      .object({
        projectId: z.uuid(),
        userId: z.uuid(),
        sessionId: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .parse(req.body);
    assert(
      workspaceKey(data.projectId, data.userId) === key,
      403,
      "KEY_MISMATCH",
      "Invalid workspace",
    );
    await manager.target(key);
    prune();
    assert(tickets.size < 1000, 429, "CAPACITY", "Too many launch requests");
    const token = randomBytes(32).toString("base64url");
    tickets.set(token, { ...data, key, expires: Date.now() + 60000 });
    res.json({ url: `${origin(key)}/launch#ticket=${token}`, expiresIn: 60 });
  });
  internal.use(
    (
      e: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res
        .status(
          e instanceof AppError
            ? e.status
            : e instanceof z.ZodError
              ? 400
              : 500,
        )
        .json({
          error: {
            message: e instanceof Error ? e.message : "Workspace failed",
          },
        });
    },
  );
  function keyFor(req: IncomingMessage) {
    const host = req.headers.host ?? "";
    const key = host.split(".")[0];
    keyOf(key);
    assert(
      host === new URL(origin(key)).host,
      403,
      "HOST",
      "Invalid workspace host",
    );
    return key;
  }
  async function authorize(req: IncomingMessage) {
    const key = keyFor(req);
    assert(
      !req.headers.origin || req.headers.origin === origin(key),
      403,
      "ORIGIN",
      "Invalid origin",
    );
    const grant = sessions.get(parse(req.headers.cookie ?? "").ss_ide ?? "");
    assert(
      grant && grant.key === key,
      401,
      "UNAUTHENTICATED",
      "Open this workspace from SyncStudio to sign in.",
    );
    await validate(grant);
    activity.set(key, Date.now());
    return grant;
  }
  function headers(req: IncomingMessage) {
    const h = { ...req.headers };
    delete h.authorization;
    delete h["proxy-authorization"];
    delete h["x-forwarded-host"];
    delete h["x-forwarded-for"];
    delete h["x-forwarded-proto"];
    h.cookie = (req.headers.cookie ?? "")
      .split(";")
      .filter((v) => !/^(ss_ide|syncstudio_session)=/.test(v.trim()))
      .join(";");
    return h;
  }
  function fail(res: ServerResponse, error: unknown) {
    if (res.headersSent) return res.destroy();
    res.writeHead(error instanceof AppError ? error.status : 503, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(
      error instanceof AppError
        ? error.message
        : "The IDE is not ready. Wait a moment and reopen it from SyncStudio.",
    );
  }
  const gateway = createServer(async (req, res) => {
    try {
      const key = keyFor(req),
        path = new URL(req.url ?? "/", origin(key)).pathname;
      res.setHeader("Referrer-Policy", "no-referrer");
      if (path === "/launch" && req.method === "GET") {
        const nonce = randomBytes(16).toString("base64");
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'`,
        });
        res.end(
          `<!doctype html><title>Opening SyncStudio IDE</title><body style="background:#14151c;color:#ededf5;font:16px system-ui;padding:48px"><p id="status">Opening your development environment…</p><script nonce="${nonce}">const token=new URLSearchParams(location.hash.slice(1)).get('ticket');history.replaceState(null,'','/launch');fetch('/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket:token})}).then(async r=>{if(!r.ok)throw new Error(await r.text());location.replace('/?folder=/home/coder/project')}).catch(e=>document.getElementById('status').textContent=e.message)</script>`,
        );
        return;
      }
      if (path === "/session" && req.method === "POST") {
        assert(
          req.headers.origin === origin(key),
          403,
          "ORIGIN",
          "Invalid origin",
        );
        let body = "";
        for await (const part of req) {
          body += part;
          assert(body.length <= 1000, 413, "LIMIT", "Request too large");
        }
        const { ticket } = z
          .object({ ticket: z.string() })
          .parse(JSON.parse(body));
        const grant = tickets.get(ticket);
        tickets.delete(ticket);
        assert(
          grant && grant.key === key,
          401,
          "TICKET",
          "Launch link expired or already used. Open the IDE again from SyncStudio.",
        );
        await validate(grant);
        prune();
        assert(sessions.size < 2000, 429, "CAPACITY", "Too many IDE sessions");
        const token = randomBytes(32).toString("base64url");
        sessions.set(token, { ...grant, expires: Date.now() + 8 * 3600000 });
        res.writeHead(204, {
          "Set-Cookie": serialize("ss_ide", token, {
            httpOnly: true,
            secure: publicURL.protocol === "https:",
            sameSite: "strict",
            path: "/",
            maxAge: 8 * 3600,
          }),
          "Cache-Control": "no-store",
        });
        res.end();
        return;
      }
      const grant = await authorize(req),
        target = await manager.target(grant.key);
      const upstream = httpRequest(
        { ...target, method: req.method, path: req.url, headers: headers(req) },
        (response) => {
          const h = { ...response.headers };
          if (h["set-cookie"])
            h["set-cookie"] = h["set-cookie"].filter(
              (c) => !/^ss_ide=/i.test(c),
            );
          h["referrer-policy"] = "no-referrer";
          res.writeHead(response.statusCode ?? 502, h);
          response.pipe(res);
        },
      );
      upstream.setTimeout(120000, () =>
        upstream.destroy(new Error("Upstream timeout")),
      );
      upstream.on("error", (e) => fail(res, e));
      req.on("aborted", () => upstream.destroy());
      res.on("close", () => upstream.destroy());
      req.pipe(upstream);
    } catch (e) {
      fail(res, e);
    }
  });
  gateway.on("upgrade", async (req, client, head) => {
    try {
      const grant = await authorize(req);
      assert(
        req.headers.origin === origin(grant.key),
        403,
        "ORIGIN",
        "Invalid WebSocket origin",
      );
      const target = await manager.target(grant.key);
      const upstream = httpRequest({
        ...target,
        path: req.url,
        headers: headers(req),
      });
      upstream.on("upgrade", (response, remote, first) => {
        client.write(
          `HTTP/1.1 101 Switching Protocols\r\n${Object.entries(
            response.headers,
          )
            .map(([k, v]) => `${k}: ${v}`)
            .join("\r\n")}\r\n\r\n`,
        );
        if (head.length) remote.write(head);
        if (first.length) client.write(first);
        peers.set(client, { grant, upstream: remote });
        client.on("close", () => {
          peers.delete(client);
          remote.destroy();
        });
        remote.on("close", () => client.destroy());
        client.on("error", () => remote.destroy());
        remote.on("error", () => client.destroy());
        client.on("data", () => activity.set(grant.key, Date.now()));
        client.pipe(remote).pipe(client);
      });
      upstream.on("response", () => {
        upstream.destroy();
        client.destroy();
      });
      upstream.on("error", () => client.destroy());
      upstream.end();
    } catch {
      client.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    }
  });
  let checking = false;
  const accessTimer = setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      prune();
      await Promise.allSettled(
        [...peers].map(async ([client, p]) => {
          try {
            await validate(p.grant);
          } catch {
            client.destroy();
            p.upstream.destroy();
          }
        }),
      );
    } finally {
      checking = false;
    }
  }, 5000);
  accessTimer.unref();
  let sweeping = false;
  const idleTimer = setInterval(async () => {
    if (sweeping) return;
    sweeping = true;
    try {
      const entries = await readdir(cfg.dataDir).catch(() => []);
      for (const entry of entries.filter((v) =>
        /^[a-f0-9]{32}\.json$/.test(v),
      )) {
        const key = entry.slice(0, -5),
          meta = await manager.read(key);
        const last = activity.get(key) ?? meta?.lastUsed ?? Date.now();
        // An open IDE is active; disconnected environments stop after the idle timeout.
        if (
          ![...peers.values()].some((p) => p.grant.key === key) &&
          Date.now() - last > cfg.idleMinutes * 60000
        )
          await manager.stop(key);
      }
    } catch (e) {
      console.error(
        "Idle cleanup failed",
        e instanceof Error ? e.message : "unknown",
      );
    } finally {
      sweeping = false;
    }
  }, 60000);
  idleTimer.unref();
  const control = createServer(internal);
  return {
    control,
    gateway,
    manager,
    close: async () => {
      clearInterval(accessTimer);
      clearInterval(idleTimer);
      for (const [client, p] of peers) {
        client.destroy();
        p.upstream.destroy();
      }
      await Promise.all(
        [control, gateway].map(
          (s) =>
            new Promise<void>((r) => {
              s.close(() => r());
              s.closeAllConnections();
            }),
        ),
      );
    },
  };
}
