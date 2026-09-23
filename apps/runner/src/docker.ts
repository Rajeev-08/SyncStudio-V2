import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { AppError } from "../../api/src/errors";
const exec = promisify(execFile);
export async function docker(args: string[], input?: string): Promise<string> {
  if (input === undefined) {
    try {
      return (
        await exec("docker", args, { timeout: 120000, maxBuffer: 5_000_000 })
      ).stdout.trim();
    } catch (e) {
      throw new AppError(
        503,
        "DOCKER_ERROR",
        `Docker operation failed: ${e instanceof Error ? e.message.slice(0, 700) : "unknown error"}`,
      );
    }
  }
  return new Promise((resolve, reject) => {
    const p = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "",
      err = "";
    const timer = setTimeout(() => {
      p.kill("SIGKILL");
      reject(new Error("Workspace file operation timed out"));
    }, 30000);
    p.stdout.on("data", (b) => {
      out += b;
      if (out.length > 5_000_000) p.kill("SIGKILL");
    });
    p.stderr.on("data", (b) => {
      err = (err + b).slice(-2000);
    });
    p.on("error", reject);
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else
        reject(
          new AppError(
            422,
            "FILES_ERROR",
            err || "Workspace file operation failed",
          ),
        );
    });
    p.stdin.on("error", () => undefined);
    p.stdin.end(input);
  });
}
export async function inspect(name: string) {
  try {
    return JSON.parse(await docker(["inspect", name]))[0] as {
      State: { Running: boolean };
      NetworkSettings: { Networks: Record<string, { IPAddress: string }> };
    };
  } catch (e) {
    if (e instanceof Error && /No such (object|container)/i.test(e.message))
      return null;
    throw e;
  }
}
