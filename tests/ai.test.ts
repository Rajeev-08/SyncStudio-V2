import { beforeAll, afterAll, it, expect } from "vitest";
import { createServer, type Server } from "node:http";
import { askAI } from "../apps/api/src/ai";
import type { Config } from "../apps/api/src/config";
import { SqliteStore } from "../apps/api/src/store";
import { ProjectService } from "../apps/api/src/service";
import type { Project } from "../packages/shared/src/index";
let server: Server, cfg: Config, project: Project;
let payload: Record<string, unknown>;
let mode = "valid";
beforeAll(async () => {
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    payload = JSON.parse(Buffer.concat(chunks).toString());
    res.setHeader("Content-Type", "application/json");
    if (mode === "error") {
      res.writeHead(429);
      return res.end("{}");
    }
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content:
                mode === "invalid"
                  ? "not json"
                  : JSON.stringify({
                      explanation: "A test provider explanation",
                      code: null,
                    }),
            },
          },
        ],
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  cfg = {
    NODE_ENV: "test",
    PORT: 3001,
    CLIENT_URL: "http://localhost:5173",
    DATA_DRIVER: "sqlite",
    SQLITE_PATH: ":memory:",
    MONGO_URI: "",
    AI_API_KEY: "test-only-key",
    AI_BASE_URL: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    AI_MODEL: "test",
    ENABLE_DEMO: "false",
  };
  const store = new SqliteStore();
  project = await new ProjectService(store).create(
    { id: crypto.randomUUID(), username: "test", email: "test@example.com" },
    { name: "AI test", description: "", template: "vanilla" },
  );
  await store.close();
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});
it("sends bounded project context to the configured provider and returns a proposal", async () => {
  const result = await askAI(cfg, project, {
    fileId: project.files[0].id,
    question: "Explain this",
    selection: "",
  });
  expect(result.explanation).toContain("test provider");
  expect(result.code).toBeNull();
  expect(payload.model).toBe("test");
  expect(result.baseContent).toBe(project.files[0].content);
});
it("rejects malformed provider responses without modifying source", async () => {
  mode = "invalid";
  await expect(
    askAI(cfg, project, {
      fileId: project.files[0].id,
      question: "Fix",
      selection: "",
    }),
  ).rejects.toThrow("invalid suggestion");
});
it("handles provider failures with safe user-facing errors", async () => {
  mode = "error";
  await expect(
    askAI(cfg, project, {
      fileId: project.files[0].id,
      question: "Fix",
      selection: "",
    }),
  ).rejects.toThrow("provider rejected");
});
