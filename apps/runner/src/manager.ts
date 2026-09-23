import {
  mkdir,
  readFile,
  writeFile,
  rename,
  unlink,
  readdir,
} from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { docker, inspect } from "./docker";
import { assert } from "../../api/src/errors";
import {
  runtimeFilesSchema,
  runtimeTemplates,
  workspaceKey,
} from "../../../packages/shared/src/runtime";
export const startSchema = z
  .object({
    projectId: z.uuid(),
    userId: z.uuid(),
    template: z.enum(runtimeTemplates),
    baseHash: z.string().regex(/^[a-f0-9]{64}$/),
    files: runtimeFilesSchema,
  })
  .strict();
export type Start = z.infer<typeof startSchema>;
export type RecordData = Omit<Start, "files"> & {
  lastUsed: number;
  initialized: boolean;
  error?: string;
};
export class Manager {
  connected = new Set<string>();
  locks = new Map<string, Promise<unknown>>();
  constructor(
    public dir: string,
    public runnerName: string,
    public maxRunning = 6,
    public ideHost = "localhost",
  ) {}
  async serial<T>(key: string, fn: () => Promise<T>) {
    const promise = (this.locks.get(key) ?? Promise.resolve())
      .catch(() => undefined)
      .then(fn);
    this.locks.set(key, promise);
    try {
      return await promise;
    } finally {
      if (this.locks.get(key) === promise) this.locks.delete(key);
    }
  }
  async read(key: string): Promise<RecordData | null> {
    try {
      return JSON.parse(await readFile(`${this.dir}/${key}.json`, "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
  async save(key: string, data: RecordData) {
    await mkdir(this.dir, { recursive: true });
    const tmp = `${this.dir}/${key}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
    await rename(tmp, `${this.dir}/${key}.json`);
  }
  async status(key: string) {
    const meta = await this.read(key);
    if (!meta) return { state: "absent" };
    const container = await inspect(`ss-${key}`);
    return {
      state: container?.State.Running ? "running" : "stopped",
      template: meta.template,
      initialized: meta.initialized,
      lastUsed: meta.lastUsed,
      error: meta.error,
      limits: { cpus: 2, memoryGB: 2 },
    };
  }
  async start(key: string, input: Start) {
    assert(
      workspaceKey(input.projectId, input.userId) === key,
      400,
      "KEY_MISMATCH",
      "Invalid workspace key",
    );
    return this.serial("provision", () =>
      this.serial(key, async () => {
        let meta = await this.read(key);
        if (meta)
          assert(
            meta.template === input.template,
            409,
            "TEMPLATE_LOCKED",
            "Delete this workspace before changing its environment. Export important files first.",
          );
        const name = `ss-${key}`,
          network = `ss-net-${key}`;
        let info = await inspect(name);
        if (!info?.State.Running) {
          const running = (
            await docker([
              "ps",
              "-q",
              "--filter",
              "label=syncstudio.workspace=true",
            ])
          )
            .split("\n")
            .filter(Boolean);
          assert(
            running.length < this.maxRunning,
            429,
            "CAPACITY",
            "Workspace capacity reached. Stop another workspace and retry.",
          );
        }
        if (!meta) {
          meta = {
            ...input,
            files: undefined,
            lastUsed: Date.now(),
            initialized: false,
          } as RecordData;
          await this.save(key, meta);
        }
        try {
          if (!info) {
            try {
              await docker(["network", "inspect", network]);
            } catch {
              await docker([
                "network",
                "create",
                "--label",
                "syncstudio.workspace=true",
                network,
              ]);
            }
            await docker([
              "create",
              "--name",
              name,
              "--label",
              "syncstudio.workspace=true",
              "--network",
              network,
              "--user",
              "1000:1000",
              "--cap-drop",
              "ALL",
              "--security-opt",
              "no-new-privileges:true",
              "--pids-limit",
              "256",
              "--memory",
              "2g",
              "--memory-swap",
              "2g",
              "--cpus",
              "2",
              "--read-only",
              "--tmpfs",
              "/tmp:rw,nosuid,nodev,size=512m",
              "--mount",
              `type=volume,source=ss-home-${key},target=/home/coder`,
              "--env",
              "HOME=/home/coder",
              "--env",
              `SYNCSTUDIO_TEMPLATE=${input.template}`,
              "--env",
              "SHELL=/bin/bash",
              "--env",
              `SYNCSTUDIO_IDE_HOST=${key}.${this.ideHost}`,
              "syncstudio-workspace:3",
            ]);
          }
          await this.connect(key);
          if (!info?.State.Running) await docker(["start", name]);
          info = await inspect(name);
          assert(info, 503, "START_FAILED", "Workspace did not start");
          if (!meta.initialized) {
            await docker(
              ["exec", "-i", name, "node", "/opt/syncstudio/files.mjs", "seed"],
              JSON.stringify(input),
            );
            meta.initialized = true;
            meta.baseHash = input.baseHash;
          }
          meta.lastUsed = Date.now();
          delete meta.error;
          await this.save(key, meta);
          const target = await this.target(key);
          const deadline = Date.now() + 60000;
          let ready = false;
          while (Date.now() < deadline) {
            try {
              const r = await fetch(`http://${target.hostname}:8080/healthz`, {
                signal: AbortSignal.timeout(2000),
              });
              ready = r.ok;
              if (ready) break;
            } catch {
              /* process is still starting */
            }
            await new Promise((r) => setTimeout(r, 500));
          }
          assert(
            ready,
            503,
            "START_TIMEOUT",
            "IDE startup timed out. Check workspace logs and reopen it in a moment.",
          );
          return this.status(key);
        } catch (e) {
          meta.error = e instanceof Error ? e.message : "Workspace failed";
          await this.save(key, meta);
          throw e;
        }
      }),
    );
  }
  async connect(key: string) {
    if (this.connected.has(key)) return;
    const network = `ss-net-${key}`;
    const net = JSON.parse(await docker(["network", "inspect", network]))[0];
    if (
      !Object.values(net.Containers ?? {}).some(
        (v) => (v as { Name: string }).Name === this.runnerName,
      )
    )
      await docker(["network", "connect", network, this.runnerName]);
    this.connected.add(key);
  }
  async removeProject(projectId: string) {
    for (const name of await readdir(this.dir).catch(() => [])) {
      if (!/^[a-f0-9]{32}\.json$/.test(name)) continue;
      const key = name.slice(0, -5),
        meta = await this.read(key);
      if (meta?.projectId === projectId) await this.remove(key);
    }
    return { ok: true };
  }
  async target(key: string) {
    const info = await inspect(`ss-${key}`);
    assert(
      info?.State.Running,
      409,
      "STOPPED",
      "Workspace is stopped. Start it from SyncStudio.",
    );
    await this.connect(key);
    const address = info.NetworkSettings.Networks[`ss-net-${key}`]?.IPAddress;
    assert(address, 503, "NETWORK_ERROR", "Workspace network unavailable");
    return { hostname: address, port: 8080 };
  }
  async stop(key: string) {
    return this.serial(key, async () => {
      const info = await inspect(`ss-${key}`);
      if (info?.State.Running)
        await docker(["stop", "--time", "10", `ss-${key}`]);
      return this.status(key);
    });
  }
  async remove(key: string) {
    return this.serial(key, async () => {
      if (await inspect(`ss-${key}`)) await docker(["rm", "-f", `ss-${key}`]);
      this.connected.delete(key);
      // Volume/network may be absent after an interrupted provisioning attempt.
      for (const args of [
        ["volume", "rm", `ss-home-${key}`],
        ["network", "disconnect", "-f", `ss-net-${key}`, this.runnerName],
        ["network", "rm", `ss-net-${key}`],
      ]) {
        try {
          await docker(args);
        } catch (e) {
          if (!(
            e instanceof Error &&
            /not found|No such|is not connected/i.test(e.message)
          ))
            throw e;
        }
      }
      await unlink(`${this.dir}/${key}.json`).catch((e) => {
        if (e.code !== "ENOENT") throw e;
      });
      return { ok: true };
    });
  }
  async export(key: string) {
    return this.serial(key, async () => {
      const meta = await this.read(key);
      assert(meta, 404, "NOT_FOUND", "Workspace not found");
      const output = JSON.parse(
        await docker(
          [
            "exec",
            "-i",
            `ss-${key}`,
            "node",
            "/opt/syncstudio/files.mjs",
            "export",
          ],
          "{}",
        ),
      );
      return {
        ...output,
        files: runtimeFilesSchema.parse(output.files),
        baseHash: meta.baseHash,
      };
    });
  }
}
