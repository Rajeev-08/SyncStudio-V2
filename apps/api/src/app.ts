import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import bcrypt from "bcryptjs";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import pino from "pino";
import { z } from "zod";
import type { Store } from "./store";
import type { Config } from "./config";
import { authenticate, newSession, clearCookie } from "./auth";
import { AppError, assert } from "./errors";
import { ProjectService } from "./service";
import { attachSockets } from "./sockets";
import { runtimeRouter, runtimeClient, secretMatches } from "./runtime";
import { attachLocalTools } from "./local-tools";
import { aiInput, askAI } from "./ai";
import {
  commentSchema,
  fileSchema,
  idSchema,
  loginSchema,
  pathSchema,
  projectSchema,
  registerSchema,
  type User,
} from "../../../packages/shared/src/index";
export function createApp(store: Store, cfg: Config) {
  const app = express(),
    http = createServer(app),
    service = new ProjectService(store),
    socket = attachSockets(http, service, cfg.CLIENT_URL),
    logger = pino({ level: cfg.NODE_ENV === "test" ? "silent" : "info" });
  const local = attachLocalTools(socket.io, service, cfg);
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "blob:"],
          connectSrc: ["'self'", "ws:", "wss:"],
          workerSrc: ["'self'", "blob:"],
          frameSrc: ["'self'", "blob:"],
          upgradeInsecureRequests: cfg.NODE_ENV === "production" ? [] : null,
        },
      },
    }),
  );
  app.use((req, res, next) => {
    const id = randomUUID();
    res.setHeader("X-Request-ID", id);
    const start = Date.now();
    res.on("finish", () =>
      logger.info(
        {
          requestId: id,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Date.now() - start,
        },
        "request",
      ),
    );
    next();
  });
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 300,
      message: {
        error: {
          code: "RATE_LIMIT",
          message: "Too many requests. Please try again later.",
        },
      },
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin !== cfg.CLIENT_URL
    )
      return next(
        new AppError(403, "ORIGIN_FORBIDDEN", "Request origin is not allowed."),
      );
    next();
  });
  app.use(express.json({ limit: "300kb" }));
  app.post("/internal/workspaces/authorize", async (req, res) => {
    assert(
      secretMatches(req.headers.authorization, cfg.RUNNER_SECRET),
      401,
      "UNAUTHENTICATED",
      "Unauthorized.",
    );
    const data = z
      .object({ sessionId: z.string(), projectId: idSchema, userId: idSchema })
      .strict()
      .parse(req.body);
    const session = await store.session(data.sessionId);
    assert(
      session &&
        session.userId === data.userId &&
        session.expiresAt > Date.now(),
      401,
      "SESSION_EXPIRED",
      "Session expired.",
    );
    await service.get(data.projectId, data.userId, "EDITOR");
    res.json({ ok: true });
  });
  const authLimit = rateLimit({
    windowMs: 15 * 60000,
    limit: cfg.NODE_ENV === "test" ? 1000 : 30,
    message: {
      error: {
        code: "RATE_LIMIT",
        message: "Too many requests. Please try again later.",
      },
    },
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.get("/api/auth/options", (_req, res) =>
    res.json({ demo: cfg.ENABLE_DEMO === "true" }),
  );
  app.post("/api/auth/demo", authLimit, async (_req, res) => {
    assert(
      cfg.ENABLE_DEMO === "true",
      404,
      "NOT_FOUND",
      "Demo access is disabled.",
    );
    const key = randomUUID().slice(0, 8);
    const account = {
      id: randomUUID(),
      username: "demo_" + key,
      email: key + "@demo.invalid",
      passwordHash: await bcrypt.hash(randomUUID(), 12),
    };
    await store.createAccount(account);
    const p = await service.create(account, {
      name: "A shared beginning",
      description: "A working canvas for your next great idea.",
      template: "vanilla",
    });
    res.setHeader(
      "Set-Cookie",
      await newSession(store, account.id, cfg.NODE_ENV === "production"),
    );
    res.status(201).json({
      user: {
        id: account.id,
        username: account.username,
        email: account.email,
      },
      projectId: p.id,
    });
  });
  app.post("/api/auth/register", authLimit, async (req, res) => {
    const data = registerSchema.parse(req.body);
    const account = {
      id: randomUUID(),
      username: data.username,
      email: data.email,
      passwordHash: await bcrypt.hash(data.password, 12),
    };
    try {
      await store.createAccount(account);
    } catch (error) {
      if (!(
        error instanceof Error &&
        /UNIQUE constraint|duplicate key/i.test(error.message)
      ))
        throw error;
      throw new AppError(
        409,
        "ACCOUNT_EXISTS",
        "Username or email is already registered.",
      );
    }
    res.setHeader(
      "Set-Cookie",
      await newSession(store, account.id, cfg.NODE_ENV === "production"),
    );
    res.status(201).json({
      id: account.id,
      username: account.username,
      email: account.email,
    });
  });
  app.post("/api/auth/login", authLimit, async (req, res) => {
    const input = loginSchema.parse(req.body);
    const account = await store.findAccount(input.email);
    const fallback =
      "$2b$12$JyjIqmnGN5N7VdhnL9NjM.wFGCrQ9mTLdoDy.ZEUZioDU5R21I0HS";
    const valid = await bcrypt.compare(
      input.password,
      account?.passwordHash ?? fallback,
    );
    assert(
      account && valid,
      401,
      "INVALID_CREDENTIALS",
      "Invalid email or password.",
    );
    try {
      const prior = await authenticate(store, req.headers.cookie);
      await store.deleteSession(prior.sessionId);
      await socket.logout(prior.sessionId);
    } catch (error) {
      if (!(error instanceof AppError && error.status === 401)) throw error;
    }
    res.setHeader(
      "Set-Cookie",
      await newSession(store, account.id, cfg.NODE_ENV === "production"),
    );
    res.json({
      id: account.id,
      username: account.username,
      email: account.email,
    });
  });
  app.use("/api", async (req, res, next) => {
    const auth = await authenticate(store, req.headers.cookie);
    res.locals.auth = auth;
    next();
  });
  const user = (res: Response) => res.locals.auth.user as User;
  const id = (req: Request, key = "id") => idSchema.parse(req.params[key]);
  const changed = (req: Request) => socket.changed(id(req));
  app.use(
    "/api",
    runtimeRouter(service, cfg, (id) => socket.reset(id)),
  );
  app.use("/api", local.router);
  app.get("/api/auth/me", (_req, res) => res.json(user(res)));
  app.post("/api/auth/logout", async (_req, res) => {
    await store.deleteSession(res.locals.auth.sessionId);
    await socket.logout(res.locals.auth.sessionId);
    res.setHeader("Set-Cookie", clearCookie(cfg.NODE_ENV === "production"));
    res.json({ ok: true });
  });
  app.get("/api/projects", async (_req, res) =>
    res.json(
      (await store.projects(user(res).id))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          template: p.template,
          owner: p.owner,
          role: p.members[user(res).id],
          memberCount: Object.keys(p.members).length,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
        })),
    ),
  );
  app.post("/api/projects", async (req, res) =>
    res
      .status(201)
      .json(await service.create(user(res), projectSchema.parse(req.body))),
  );
  app.get("/api/projects/:id", async (req, res) =>
    res.json(await service.workspace(id(req), user(res).id)),
  );
  app.patch("/api/projects/:id", async (req, res) => {
    const data = projectSchema
      .pick({ name: true, description: true })
      .parse(req.body);
    await service.mutate(id(req), user(res), "OWNER", (p) => {
      Object.assign(p, data);
      service.activity(p, user(res), "updated project", p.name);
    });
    changed(req);
    res.json({ ok: true });
  });
  app.delete("/api/projects/:id", async (req, res) => {
    await service.serial(id(req), async () => {
      await service.get(id(req), user(res).id, "OWNER");
      if (cfg.RUNNER_URL)
        await runtimeClient(cfg)(`/projects/${id(req)}`, "DELETE");
      await store.deleteProject(id(req));
    });
    socket.reset(id(req));
    res.json({ ok: true });
  });
  app.post("/api/projects/:id/duplicate", async (req, res) => {
    const source = await service.get(id(req), user(res).id);
    const p = await service.create(user(res), {
      name: source.name.slice(0, 73) + " (copy)",
      description: source.description,
      template: source.template,
    });
    await service.mutate(p.id, user(res), "OWNER", (copy) => {
      copy.files = structuredClone(source.files).map((f) => ({
        ...f,
        id: randomUUID(),
      }));
    });
    res.status(201).json({ id: p.id });
  });
  app.post("/api/projects/:id/files", async (req, res) => {
    const f = await service.createFile(
      id(req),
      user(res),
      fileSchema.parse(req.body),
    );
    changed(req);
    res.status(201).json(f);
  });
  app.patch("/api/projects/:id/files/:fileId", async (req, res) => {
    const { path } = z.object({ path: pathSchema }).strict().parse(req.body);
    const f = await service.renameFile(
      id(req),
      user(res),
      id(req, "fileId"),
      path,
    );
    changed(req);
    res.json(f);
  });
  app.delete("/api/projects/:id/files/:fileId", async (req, res) => {
    await service.deleteFile(id(req), user(res), id(req, "fileId"));
    changed(req);
    res.json({ ok: true });
  });
  app.post("/api/projects/:id/members", async (req, res) => {
    const { email, role } = z
      .object({
        email: z.email().transform((v) => v.toLowerCase()),
        role: z.enum(["EDITOR", "VIEWER"]),
      })
      .strict()
      .parse(req.body);
    const uid = await service.invite(id(req), user(res), email, role);
    await socket.revoke(id(req), uid);
    changed(req);
    res.json({ ok: true });
  });
  app.patch("/api/projects/:id/members/:userId", async (req, res) => {
    const { role } = z
      .object({ role: z.enum(["EDITOR", "VIEWER"]) })
      .strict()
      .parse(req.body);
    await service.member(id(req), user(res), id(req, "userId"), role);
    await socket.revoke(id(req), id(req, "userId"));
    changed(req);
    res.json({ ok: true });
  });
  app.delete("/api/projects/:id/members/:userId", async (req, res) => {
    await service.member(id(req), user(res), id(req, "userId"), null);
    await socket.revoke(id(req), id(req, "userId"));
    changed(req);
    res.json({ ok: true });
  });
  app.post("/api/projects/:id/versions", async (req, res) => {
    const { message } = z
      .object({ message: z.string().trim().min(1).max(150) })
      .strict()
      .parse(req.body);
    const v = await service.createVersion(id(req), user(res), message);
    changed(req);
    res.status(201).json(v);
  });
  app.get("/api/projects/:id/versions/:versionId", async (req, res) => {
    const p = await service.get(id(req), user(res).id);
    const v = p.versions.find((v) => v.id === id(req, "versionId"));
    assert(v, 404, "NOT_FOUND", "Snapshot not found.");
    res.json(v);
  });
  app.delete("/api/projects/:id/versions/:versionId", async (req, res) => {
    await service.mutate(id(req), user(res), "OWNER", (p) => {
      p.versions = p.versions.filter((v) => v.id !== id(req, "versionId"));
    });
    changed(req);
    res.json({ ok: true });
  });
  app.post(
    "/api/projects/:id/versions/:versionId/restore",
    async (req, res) => {
      const epoch = await service.restore(
        id(req),
        user(res),
        id(req, "versionId"),
      );
      socket.reset(id(req));
      res.json({ epoch });
    },
  );
  app.post("/api/projects/:id/comments", async (req, res) => {
    const data = commentSchema.parse(req.body);
    await service.mutate(id(req), user(res), "EDITOR", (p) => {
      assert(
        p.comments.length < 200,
        422,
        "COMMENT_LIMIT",
        "Workspace comment limit reached.",
      );
      assert(
        p.files.some((f) => f.id === data.fileId && f.type === "file"),
        404,
        "NOT_FOUND",
        "File not found.",
      );
      p.comments.unshift({
        ...data,
        id: randomUUID(),
        author: user(res).username,
        createdAt: new Date().toISOString(),
        resolved: false,
        replies: [],
      });
      service.activity(
        p,
        user(res),
        "commented on",
        p.files.find((f) => f.id === data.fileId)!.path,
      );
    });
    changed(req);
    res.status(201).json({ ok: true });
  });
  app.patch("/api/projects/:id/comments/:commentId", async (req, res) => {
    const data = z
      .object({
        resolved: z.boolean().optional(),
        reply: z.string().trim().min(1).max(4000).optional(),
      })
      .strict()
      .parse(req.body);
    await service.mutate(id(req), user(res), "EDITOR", (p) => {
      const c = p.comments.find((c) => c.id === id(req, "commentId"));
      assert(c, 404, "NOT_FOUND", "Comment not found.");
      if (data.resolved !== undefined) c.resolved = data.resolved;
      if (data.reply) {
        assert(
          c.replies.length < 100,
          422,
          "REPLY_LIMIT",
          "Thread reply limit reached.",
        );
        c.replies.push({
          body: data.reply,
          author: user(res).username,
          createdAt: new Date().toISOString(),
        });
      }
    });
    changed(req);
    res.json({ ok: true });
  });
  app.get("/api/ai/status", (_req, res) =>
    res.json({ enabled: !!cfg.AI_API_KEY }),
  );
  app.post(
    "/api/projects/:id/ai",
    rateLimit({ windowMs: 60000, limit: 10 }),
    async (req, res) => {
      const p = await service.get(id(req), user(res).id);
      res.json(await askAI(cfg, p, aiInput.parse(req.body)));
    },
  );
  app.use("/api", (_req, _res, next) =>
    next(new AppError(404, "NOT_FOUND", "API endpoint not found.")),
  );
  app.use(express.static(resolve("dist/web")));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(resolve("dist/web/index.html")),
  );
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (error instanceof z.ZodError)
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; "),
          },
        });
      if (error instanceof AppError)
        return res
          .status(error.status)
          .json({ error: { code: error.code, message: error.message } });
      logger.error(
        { error: error instanceof Error ? error.message : "unknown" },
        "request failed",
      );
      res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: "The request could not be completed.",
        },
      });
    },
  );
  return { app, http, service, socket, local };
}
