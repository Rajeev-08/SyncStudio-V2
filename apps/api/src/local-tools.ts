import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname, join, extname } from "node:path";
import { Router } from "express";
import type { Server, Socket } from "socket.io";
interface IPty {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(fn: (data: string) => void): unknown;
  onExit(fn: (event: { exitCode: number }) => void): unknown;
}
interface PtyModule {
  spawn(
    file: string,
    args: string[],
    options: {
      name: string;
      cols: number;
      rows: number;
      cwd: string;
      env: Record<string, string>;
    },
  ): IPty;
}
import { z } from "zod";
import type { Config } from "./config";
import type { ProjectService } from "./service";
import { authenticate } from "./auth";
import { AppError, assert } from "./errors";
import {
  idSchema,
  pathSchema,
  type Project,
} from "../../../packages/shared/src/index";
const exec = promisify(execFile);
export const localLanguages = [
  "javascript",
  "typescript",
  "python",
  "c",
  "cpp",
  "java",
  "go",
  "rust",
] as const;
export type LocalLanguage = (typeof localLanguages)[number];
export const localLanguage = (path: string): LocalLanguage | undefined =>
  (
    ({
      ".js": "javascript",
      ".mjs": "javascript",
      ".cjs": "javascript",
      ".ts": "typescript",
      ".py": "python",
      ".c": "c",
      ".cpp": "cpp",
      ".cc": "cpp",
      ".java": "java",
      ".go": "go",
      ".rs": "rust",
    }) as Record<string, LocalLanguage>
  )[extname(path).toLowerCase()];
export function localEnabled(cfg: Config) {
  return (
    cfg.LOCAL_EXECUTION === "true" &&
    !!cfg.LOCAL_OPERATOR_EMAIL &&
    cfg.NODE_ENV !== "production" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(cfg.CLIENT_URL).hostname,
    )
  );
}
export function toolEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env))
    if (
      /^(path|home|userprofile|systemroot|windir|comspec|pathext|temp|tmp|tmpdir|username|user|shell|lang|lc_all|appdata|localappdata|programfiles|programfiles\(x86\)|java_home|goroot|gopath|cargo_home|rustup_home)$/i.test(
        k,
      )
    )
      out[k] = v;
  return { ...out, TERM: "xterm-256color", COLORTERM: "truecolor" };
}
export interface Tool {
  command: string;
  prefix: string[];
  version: string;
}
export async function detectTools(): Promise<
  Record<LocalLanguage, Tool | null>
> {
  async function first(candidates: string[][]): Promise<Tool | null> {
    for (const [command, ...args] of candidates)
      try {
        const r = await exec(command, args, {
          timeout: 4000,
          maxBuffer: 16000,
          windowsHide: true,
          env: toolEnv(),
        });
        return {
          command,
          prefix: command === "py" ? ["-3"] : [],
          version: (r.stdout || r.stderr).trim().split("\n")[0].slice(0, 150),
        };
      } catch {
        /* Try the next executable, without pretending a runtime exists. */
      }
    return null;
  }
  const [python, c, cpp, java, go, rust] = await Promise.all([
    first(
      process.platform === "win32"
        ? [
            ["py", "-3", "--version"],
            ["python", "--version"],
          ]
        : [
            ["python3", "--version"],
            ["python", "--version"],
          ],
    ),
    first([
      ["gcc", "--version"],
      ["clang", "--version"],
    ]),
    first([
      ["g++", "--version"],
      ["clang++", "--version"],
    ]),
    first([["java", "--version"]]),
    first([["go", "version"]]),
    first([["rustc", "--version"]]),
  ]);
  const node = {
    command: process.execPath,
    prefix: [],
    version: process.version,
  };
  return { javascript: node, typescript: node, python, c, cpp, java, go, rust };
}
export async function materializeLocal(project: Project, root: string) {
  await mkdir(resolve(root), { recursive: true });
  const dir = await mkdtemp(join(resolve(root), "workspace-"));
  for (const f of project.files) {
    const path = pathSchema.parse(f.path),
      full = join(dir, path);
    await mkdir(f.type === "folder" ? full : dirname(full), {
      recursive: true,
    });
    if (f.type === "file") await writeFile(full, f.content, { flag: "wx" });
  }
  return dir;
}
export function runPlan(
  language: LocalLanguage,
  tool: Tool,
  file: string,
  dir: string,
): { command: string; args: string[] }[] {
  const source = resolve(dir, file),
    output = join(
      dir,
      process.platform === "win32"
        ? "syncstudio-program.exe"
        : "syncstudio-program",
    );
  if (language === "c" || language === "cpp")
    return [
      { command: tool.command, args: [source, "-g", "-o", output] },
      { command: output, args: [] },
    ];
  if (language === "rust")
    return [
      { command: tool.command, args: [source, "-g", "-o", output] },
      { command: output, args: [] },
    ];
  if (language === "go")
    return [{ command: tool.command, args: ["run", source] }];
  if (language === "python")
    return [{ command: tool.command, args: [...tool.prefix, "-u", source] }];
  // Java 11+ source-file launch handles a class matching the selected source file.
  return [{ command: tool.command, args: [...tool.prefix, source] }];
}
function killTree(child: ChildProcessWithoutNullStreams) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    execFile(
      "taskkill",
      ["/PID", String(child.pid), "/T", "/F"],
      () => undefined,
    );
  } else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}
export function attachLocalTools(
  io: Server,
  service: ProjectService,
  cfg: Config,
) {
  const ns = io.of("/local-tools");
  let cached: Awaited<ReturnType<typeof detectTools>> | null = null,
    cacheTime = 0;
  const tools = async () => {
    if (!cached || Date.now() - cacheTime > 30000) {
      cached = await detectTools();
      cacheTime = Date.now();
    }
    return cached;
  };
  const getPty = () => {
    const name = "node-pty";
    return import(name) as Promise<PtyModule>;
  };
  const enabledFor = (email: string) =>
    localEnabled(cfg) &&
    email.toLowerCase() === cfg.LOCAL_OPERATOR_EMAIL?.toLowerCase();
  async function allowed(socket: Socket) {
    assert(
      localEnabled(cfg),
      403,
      "LOCAL_DISABLED",
      "Run npm run local:setup, then restart npm run dev to enable local tools.",
    );
    assert(
      socket.handshake.headers.origin === cfg.CLIENT_URL,
      403,
      "ORIGIN_FORBIDDEN",
      "Invalid origin.",
    );
    const auth = await authenticate(
      service.store,
      socket.handshake.headers.cookie,
    );
    assert(
      enabledFor(auth.user.email),
      403,
      "LOCAL_OPERATOR",
      "Only the configured local operator can execute code on this computer.",
    );
    const projectId = idSchema.parse(socket.handshake.auth.projectId);
    const p = await service.get(projectId, auth.user.id, "OWNER");
    return { auth, p };
  }
  const router = Router();
  router.get("/local/status", async (_req, res) => {
    const enabled = localEnabled(cfg),
      authorized = enabledFor(res.locals.auth.user.email);
    let pty = false;
    if (authorized)
      try {
        await getPty();
        pty = true;
      } catch {
        /* optional native dependency */
      }
    res.json({
      enabled,
      authorized,
      pty,
      platform: process.platform,
      languages: localLanguages,
      tools: authorized ? await tools() : {},
      reason: !enabled
        ? "Run npm run local:setup in your project folder, then restart npm run dev."
        : !authorized
          ? "Sign in using the email configured during local setup."
          : "",
      shell: process.platform === "win32" ? "PowerShell" : "Bash",
    });
  });
  ns.use((socket, next) => {
    allowed(socket)
      .then(() => next())
      .catch((e) => next(new Error(e.message)));
  });
  const active = new Set<() => void>();
  const projectConnections = new Map<string, number>();
  ns.on("connection", (socket) => {
    const projectId = String(socket.handshake.auth.projectId);
    if ((projectConnections.get(projectId) ?? 0) >= 4) {
      socket.emit(
        "local:error",
        "Too many local tool connections. Close another project tab.",
      );
      socket.disconnect();
      return;
    }
    projectConnections.set(
      projectId,
      (projectConnections.get(projectId) ?? 0) + 1,
    );
    let terminal: IPty | null = null,
      child: ChildProcessWithoutNullStreams | null = null;
    let busy = false,
      stopped = false,
      disposed = false,
      runTimer: ReturnType<typeof setTimeout> | undefined;
    let outputBytes = 0;
    let events = 0,
      windowStart = Date.now();
    const clean = () => {
      stopped = true;
      disposed = true;
      clearTimeout(runTimer);
      if (child) killTree(child);
      child = null;
      try {
        terminal?.kill();
      } catch {
        /* exited */
      }
      terminal = null;
    };
    active.add(clean);
    const timer = setInterval(() => {
      allowed(socket).catch(() => {
        clean();
        socket.disconnect();
      });
    }, 3000);
    timer.unref();
    socket.on("disconnect", () => {
      clearInterval(timer);
      clean();
      active.delete(clean);
      projectConnections.set(
        projectId,
        Math.max(0, (projectConnections.get(projectId) ?? 1) - 1),
      );
    });
    function handle<T>(
      event: string,
      schema: z.ZodType<T>,
      fn: (v: T) => Promise<unknown> | unknown,
    ) {
      socket.on(event, async (raw: unknown, ack?: (r: unknown) => void) => {
        try {
          if (Date.now() - windowStart > 1000) {
            events = 0;
            windowStart = Date.now();
          }
          assert(
            ++events <= 100,
            429,
            "RATE_LIMIT",
            "Too many terminal requests.",
          );
          await allowed(socket);
          assert(!disposed, 409, "CLOSED", "Connection closed.");
          const data = await fn(schema.parse(raw));
          if (typeof ack === "function") ack({ ok: true, data });
        } catch (e) {
          const message =
            e instanceof Error ? e.message : "Local operation failed";
          if (typeof ack === "function") ack({ ok: false, error: { message } });
          else socket.emit("local:error", message);
        }
      });
    }
    handle(
      "terminal:open",
      z
        .object({
          cols: z.number().int().min(20).max(300),
          rows: z.number().int().min(5).max(100),
        })
        .strict(),
      async ({ cols, rows }) => {
        assert(
          !terminal && !busy,
          409,
          "BUSY",
          "A terminal or startup is already active.",
        );
        busy = true;
        try {
          const pty = await getPty().catch(() => {
            throw new AppError(
              503,
              "PTY_MISSING",
              "Native terminal support is missing. Run npm install node-pty and restart the API. Run File still works without it.",
            );
          });
          const { p } = await allowed(socket);
          const cwd = await materializeLocal(
            p,
            cfg.LOCAL_WORKSPACE_ROOT ?? ".data/local",
          );
          assert(!disposed, 409, "CLOSED", "Connection closed.");
          terminal = pty.spawn(
            process.platform === "win32" ? "powershell.exe" : "/bin/bash",
            process.platform === "win32"
              ? ["-NoLogo", "-NoProfile"]
              : ["--noprofile", "--norc"],
            {
              name: "xterm-256color",
              cols,
              rows,
              cwd,
              env: toolEnv() as Record<string, string>,
            },
          );
          let chunkBytes = 0;
          const budget = setInterval(() => {
            chunkBytes = 0;
          }, 1000);
          budget.unref();
          terminal.onData((data) => {
            chunkBytes += Buffer.byteLength(data);
            if (chunkBytes > 256000) {
              try {
                terminal?.kill();
              } catch {
                /* exited */
              }
              socket.emit(
                "local:error",
                "Terminal stopped: output exceeded 256 KB/sec.",
              );
              return;
            }
            socket.emit("terminal:data", data);
          });
          terminal.onExit(({ exitCode }) => {
            clearInterval(budget);
            terminal = null;
            socket.emit("terminal:exit", { exitCode });
          });
          return { cwd };
        } finally {
          busy = false;
        }
      },
    );
    handle(
      "terminal:input",
      z.object({ data: z.string().max(16000) }).strict(),
      ({ data }) => {
        assert(terminal, 409, "NO_TERMINAL", "Open a terminal first.");
        terminal.write(data);
      },
    );
    handle(
      "terminal:resize",
      z
        .object({
          cols: z.number().int().min(20).max(300),
          rows: z.number().int().min(5).max(100),
        })
        .strict(),
      ({ cols, rows }) => terminal?.resize(cols, rows),
    );
    handle("terminal:close", z.object({}).strict(), () => {
      terminal?.kill();
    });
    function output(data: string) {
      outputBytes += Buffer.byteLength(data);
      if (outputBytes > 1_000_000) {
        stopped = true;
        if (child) killTree(child);
        socket.emit(
          "local:error",
          "Run stopped after exceeding 1 MB of output.",
        );
        return;
      }
      socket.emit("run:data", data);
    }
    handle(
      "run:start",
      z.object({ fileId: z.uuid(), epoch: z.number().int().min(0) }).strict(),
      async ({ fileId, epoch }) => {
        assert(!busy, 409, "BUSY", "A run or startup is already active.");
        busy = true;
        stopped = false;
        outputBytes = 0;
        try {
          const { p } = await allowed(socket);
          assert(
            p.epoch === epoch,
            409,
            "STALE_EPOCH",
            "Project changed. Reopen it before running.",
          );
          const f = p.files.find((f) => f.id === fileId && f.type === "file");
          assert(f, 404, "NOT_FOUND", "File not found.");
          const lang = localLanguage(f.path);
          assert(
            lang,
            422,
            "UNSUPPORTED",
            "Choose a .py, .c, .cpp, .java, .js, .ts, .go, or .rs source file.",
          );
          const tool = (await tools())[lang];
          assert(
            tool,
            422,
            "RUNTIME_MISSING",
            `Install the ${lang} toolchain, add it to PATH, and restart SyncStudio.`,
          );
          const cwd = await materializeLocal(
            p,
            cfg.LOCAL_WORKSPACE_ROOT ?? ".data/local",
          );
          assert(!disposed && !stopped, 409, "STOPPED", "Run cancelled.");
          socket.emit("run:state", { running: true, cwd, path: f.path });
          // Return promptly; subsequent output and exit use events. argv is passed without a shell.
          void (async () => {
            let code: number | null = 0;
            runTimer = setTimeout(() => {
              stopped = true;
              if (child) killTree(child);
              output("\n[Stopped: 120 second time limit]\n");
            }, 120000);
            try {
              for (const step of runPlan(lang, tool, f.path, cwd)) {
                if (stopped || disposed) break;
                output(`$ ${[step.command, ...step.args].join(" ")}\n`);
                code = await new Promise<number | null>((done) => {
                  child = spawn(step.command, step.args, {
                    cwd,
                    env: toolEnv(),
                    shell: false,
                    detached: process.platform !== "win32",
                    windowsHide: true,
                    stdio: "pipe",
                  });
                  child.stdout.on("data", (b) => output(b.toString()));
                  child.stderr.on("data", (b) => output(b.toString()));
                  child.stdin.on("error", () => undefined);
                  child.on("error", (e) => {
                    output(e.message + "\n");
                    done(1);
                  });
                  child.on("close", done);
                });
                child = null;
                if (code !== 0) break;
              }
            } catch (e) {
              output((e instanceof Error ? e.message : "Run failed") + "\n");
              code = 1;
            } finally {
              clearTimeout(runTimer);
              child = null;
              busy = false;
              socket.emit("run:state", {
                running: false,
                exitCode: code,
                stopped,
              });
            }
          })();
          return { cwd };
        } catch (e) {
          busy = false;
          throw e;
        }
      },
    );
    handle(
      "run:input",
      z.object({ data: z.string().max(16000) }).strict(),
      ({ data }) => {
        assert(child, 409, "NO_RUN", "No program is running.");
        child.stdin.write(data);
      },
    );
    handle("run:stop", z.object({}).strict(), () => {
      stopped = true;
      if (child) killTree(child);
    });
  });
  return {
    router,
    close: () => {
      for (const clean of active) clean();
      ns.disconnectSockets(true);
    },
  };
}
