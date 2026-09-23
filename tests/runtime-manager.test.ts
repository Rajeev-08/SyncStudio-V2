import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Manager } from "../apps/runner/src/manager";
import { workspaceKey, treeHash } from "../packages/shared/src/runtime";
const fake = vi.hoisted(() => ({
  running: false,
  exists: false,
  calls: [] as string[][],
  failCreate: false,
}));
vi.mock("../apps/runner/src/docker", () => ({
  inspect: async () =>
    fake.exists
      ? {
          State: { Running: fake.running },
          NetworkSettings: {
            Networks: new Proxy(
              {},
              { get: () => ({ IPAddress: "127.0.0.1" }) },
            ),
          },
        }
      : null,
  docker: async (args: string[]) => {
    fake.calls.push(args);
    if (args[0] === "create") {
      if (fake.failCreate) throw new Error("Build workspace image first");
      fake.exists = true;
    }
    if (args[0] === "start") fake.running = true;
    if (args[0] === "stop") fake.running = false;
    if (args[0] === "rm") {
      fake.exists = false;
      fake.running = false;
    }
    if (args[0] === "network" && args[1] === "inspect")
      return JSON.stringify([{ Containers: {} }]);
    if (args[0] === "ps") return "";
    return "{}";
  },
}));
let dir: string, manager: Manager;
const input = {
  projectId: randomUUID(),
  userId: randomUUID(),
  template: "python" as const,
  files: [{ path: "main.py", type: "file" as const, content: "print(42)" }],
  baseHash: "",
};
input.baseHash = treeHash(input.files);
const key = workspaceKey(input.projectId, input.userId);
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ss-manager-"));
  manager = new Manager(dir, "runner");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 200 })),
  );
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true, force: true });
});
describe("workspace provisioning contract", () => {
  it("creates an unprivileged bounded container without host ports or socket mounts", async () => {
    expect((await manager.start(key, input)).state).toBe("running");
    const args = fake.calls.find((a) => a[0] === "create")!;
    expect(args).toContain("--read-only");
    expect(args).toContain("no-new-privileges:true");
    expect(args).toContain("1000:1000");
    expect(args).toContain("--pids-limit");
    expect(args).toContain("--memory");
    expect(args.join(" ")).not.toContain("docker.sock");
    expect(args).not.toContain("--privileged");
    expect(args).not.toContain("-p");
    expect((await manager.read(key))?.baseHash).toBe(input.baseHash);
  });
  it("reconnects a recreated runner to existing workspace networks without reseeding files", async () => {
    const m = new Manager(dir, "replacement-runner");
    const before = fake.calls.filter((a) => a[0] === "exec").length;
    await m.start(key, input);
    expect(
      fake.calls.some(
        (a) =>
          a[0] === "network" &&
          a[1] === "connect" &&
          a[3] === "replacement-runner",
      ),
    ).toBe(true);
    expect(fake.calls.filter((a) => a[0] === "exec")).toHaveLength(before);
  });
  it("refuses changing a persisted template and validates the workspace owner key", async () => {
    await expect(
      manager.start(key, { ...input, template: "java" }),
    ).rejects.toThrow("Delete this workspace");
    await expect(manager.start("a".repeat(32), input)).rejects.toThrow(
      "Invalid workspace key",
    );
  });
  it("stops without deleting the home volume, then removes project runtime data explicitly", async () => {
    expect((await manager.stop(key)).state).toBe("stopped");
    expect(await manager.read(key)).not.toBeNull();
    await manager.removeProject(input.projectId);
    expect(await manager.read(key)).toBeNull();
    expect(fake.calls.some((a) => a[0] === "volume" && a[1] === "rm")).toBe(
      true,
    );
  });
});
