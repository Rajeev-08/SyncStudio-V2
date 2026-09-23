import { Router } from "express";
import { z } from "zod";
import { timingSafeEqual, randomUUID } from "node:crypto";
import type { Config } from "./config";
import type { ProjectService } from "./service";
import { makeFile } from "./templates";
import { AppError, assert } from "./errors";
import { idSchema, type User } from "../../../packages/shared/src/index";
import {
  runtimeFilesSchema,
  runtimeTemplates,
  treeHash,
  workspaceKey,
} from "../../../packages/shared/src/runtime";
export function secretMatches(
  value: string | undefined,
  secret: string | undefined,
) {
  if (!secret || !value) return false;
  const a = Buffer.from(value),
    b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function runtimeClient(cfg: Config) {
  return async function call(path: string, method = "GET", body?: unknown) {
    assert(
      cfg.RUNNER_URL && cfg.RUNNER_SECRET,
      503,
      "RUNTIME_DISABLED",
      "Full IDE is not configured. Start the complete Docker stack using the setup instructions.",
    );
    let response: globalThis.Response;
    try {
      response = await fetch(cfg.RUNNER_URL + path, {
        method,
        headers: {
          Authorization: `Bearer ${cfg.RUNNER_SECRET}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(120000),
      });
    } catch {
      throw new AppError(
        503,
        "RUNNER_UNAVAILABLE",
        "The workspace service is unavailable. Check its logs and retry.",
      );
    }
    const data = await response.json();
    if (!response.ok)
      throw new AppError(
        response.status,
        "RUNTIME_ERROR",
        data.error?.message ?? "Workspace operation failed.",
      );
    return data;
  };
}
export function runtimeRouter(
  service: ProjectService,
  cfg: Config,
  reset: (id: string) => void,
) {
  const router = Router(),
    call = runtimeClient(cfg);
  const reviews = new Map<
    string,
    {
      userId: string;
      projectId: string;
      baseHash: string;
      files: z.infer<typeof runtimeFilesSchema>;
      expires: number;
    }
  >();
  router.get("/runtime/options", (_req, res) =>
    res.json({
      enabled: !!(cfg.RUNNER_URL && cfg.RUNNER_SECRET),
      templates: runtimeTemplates,
    }),
  );
  router.use("/projects/:id/runtime", async (req, res, next) => {
    const user = res.locals.auth.user as User;
    const id = idSchema.parse(req.params.id);
    await service.get(id, user.id, "EDITOR");
    res.locals.runtime = { id, key: workspaceKey(id, user.id), user };
    next();
  });
  router.get("/projects/:id/runtime", async (_req, res) =>
    res.json(await call(`/runtimes/${res.locals.runtime.key}`)),
  );
  router.post("/projects/:id/runtime/start", async (req, res) => {
    const { template } = z
      .object({ template: z.enum(runtimeTemplates) })
      .strict()
      .parse(req.body);
    const { id, key, user } = res.locals.runtime;
    const p = await service.get(id, user.id, "EDITOR");
    res.json(
      await call(`/runtimes/${key}/start`, "POST", {
        template,
        projectId: id,
        userId: user.id,
        files: p.files.map(({ path, type, content }) => ({
          path,
          type,
          content,
        })),
        baseHash: treeHash(p.files),
      }),
    );
  });
  router.post("/projects/:id/runtime/launch", async (_req, res) => {
    const { id, key, user } = res.locals.runtime;
    res.json(
      await call(`/runtimes/${key}/launch`, "POST", {
        projectId: id,
        userId: user.id,
        sessionId: res.locals.auth.sessionId,
      }),
    );
  });
  router.post("/projects/:id/runtime/stop", async (_req, res) =>
    res.json(
      await call(`/runtimes/${res.locals.runtime.key}/stop`, "POST", {}),
    ),
  );
  router.delete("/projects/:id/runtime", async (req, res) => {
    z.object({ confirmation: z.literal("DELETE WORKSPACE") })
      .strict()
      .parse(req.body);
    res.json(await call(`/runtimes/${res.locals.runtime.key}`, "DELETE"));
  });
  router.post("/projects/:id/runtime/review", async (_req, res) => {
    const { id, key, user } = res.locals.runtime;
    const result = await call(`/runtimes/${key}/export`, "POST", {});
    const files = runtimeFilesSchema.parse(result.files);
    const p = await service.get(id, user.id, "OWNER");
    const baseHash = treeHash(p.files);
    assert(
      baseHash === result.baseHash,
      409,
      "IMPORT_CONFLICT",
      "The collaborative project changed after this workspace was created or last imported. Export your IDE files with Git or downloads, then recreate the workspace from the current project. No files were overwritten.",
    );
    for (const [k, v] of reviews) if (v.expires < Date.now()) reviews.delete(k);
    assert(
      reviews.size < 200,
      429,
      "REVIEW_LIMIT",
      "Too many pending reviews. Try again in a few minutes.",
    );
    const reviewId = randomUUID();
    reviews.set(reviewId, {
      userId: user.id,
      projectId: id,
      baseHash,
      files,
      expires: Date.now() + 10 * 60000,
    });
    const changes = [
      ...new Set([...p.files.map((f) => f.path), ...files.map((f) => f.path)]),
    ].flatMap((path) => {
      const before = p.files.find((f) => f.path === path),
        after = files.find((f) => f.path === path);
      if (before?.type === after?.type && before?.content === after?.content)
        return [];
      return [
        {
          path,
          kind: !before ? "added" : !after ? "deleted" : "modified",
          before: before?.content ?? "",
          after: after?.content ?? "",
        },
      ];
    });
    res.json({ reviewId, changes, skipped: result.skipped, expiresIn: 600 });
  });
  router.post("/projects/:id/runtime/import", async (req, res) => {
    const { reviewId } = z
      .object({ reviewId: z.uuid() })
      .strict()
      .parse(req.body);
    const { id, key, user } = res.locals.runtime;
    const review = reviews.get(reviewId);
    assert(
      review &&
        review.projectId === id &&
        review.userId === user.id &&
        review.expires > Date.now(),
      409,
      "REVIEW_EXPIRED",
      "Create a new review before importing.",
    );
    await service.mutate(id, user, "OWNER", (p) => {
      assert(
        treeHash(p.files) === review.baseHash,
        409,
        "IMPORT_CONFLICT",
        "The project changed during review. No files were overwritten.",
      );
      service.snapshot(p, user, "Recovery before full IDE import");
      p.files = review.files.map((f) => makeFile(f.path, f.content, f.type));
      p.epoch++;
      p.comments = [];
      service.activity(p, user, "imported IDE files", p.name);
    });
    reviews.delete(reviewId);
    reset(id);
    // Import is already committed. A failed baseline update must not be reported as a failed import.
    let baselineUpdated = true;
    try {
      await call(`/runtimes/${key}/baseline`, "POST", {
        baseHash: treeHash(review.files),
      });
    } catch {
      baselineUpdated = false;
    }
    res.json({ ok: true, baselineUpdated });
  });
  return router;
}
