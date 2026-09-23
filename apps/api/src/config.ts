import "dotenv/config";
import { z } from "zod";
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  CLIENT_URL: z.url().default("http://localhost:5173"),
  DATA_DRIVER: z.enum(["sqlite", "mongo"]).default("sqlite"),
  SQLITE_PATH: z.string().default(".data/syncstudio.db"),
  MONGO_URI: z.string().default("mongodb://localhost:27017/syncstudio"),
  AI_BASE_URL: z.url().default("https://api.openai.com/v1"),
  AI_API_KEY: z.string().default(""),
  AI_MODEL: z.string().default("gpt-4.1-mini"),
  LOCAL_EXECUTION: z.enum(["true", "false"]).optional(),
  LOCAL_OPERATOR_EMAIL: z.email().optional(),
  LOCAL_WORKSPACE_ROOT: z.string().optional(),
  RUNNER_URL: z.url().optional(),
  RUNNER_SECRET: z.string().min(32).optional(),
  ENABLE_DEMO: z.enum(["true", "false"]).default("false"),
});
export type Config = z.infer<typeof envSchema>;
export function readConfig() {
  const cfg = envSchema.parse(process.env);
  if (cfg.NODE_ENV === "production" && !cfg.CLIENT_URL.startsWith("https://"))
    throw new Error("Production CLIENT_URL must use HTTPS.");
  if (
    cfg.LOCAL_EXECUTION === "true" &&
    (cfg.NODE_ENV === "production" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(
        new URL(cfg.CLIENT_URL).hostname,
      ))
  )
    throw new Error("Local execution requires a localhost development origin.");
  return cfg;
}
