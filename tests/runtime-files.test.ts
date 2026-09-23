import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
const dirs: string[] = [];
async function root() {
  const p = await mkdtemp(join(tmpdir(), "ss-files-"));
  dirs.push(p);
  return p;
}
function run(dir: string, mode: string, body: unknown = {}) {
  return new Promise<{ code: number | null; output: string; error: string }>(
    (resolveResult, reject) => {
      const child = spawn(
        process.execPath,
        [resolve("infrastructure/workspace/files.mjs"), mode],
        {
          env: { ...process.env, WORKSPACE_ROOT: dir },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      let output = "",
        error = "";
      child.stdout.on("data", (d) => (output += d));
      child.stderr.on("data", (d) => (error += d));
      child.on("error", reject);
      child.on("close", (code) => resolveResult({ code, output, error }));
      child.stdin.end(JSON.stringify(body));
    },
  );
}
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
describe("real workspace file helper", () => {
  it("seeds runnable files and debug tasks without overwriting existing content", async () => {
    const p = await root();
    expect(
      (
        await run(p, "seed", {
          template: "python",
          files: [{ path: "main.py", type: "file", content: "print('mine')" }],
        })
      ).code,
    ).toBe(0);
    expect(await readFile(join(p, "main.py"), "utf8")).toBe("print('mine')");
    expect(
      JSON.parse(await readFile(join(p, ".vscode/launch.json"), "utf8"))
        .configurations[0].type,
    ).toBe("debugpy");
    expect(
      JSON.parse((await run(p, "export")).output).files.some(
        (f: { path: string }) => f.path === "main.py",
      ),
    ).toBe(true);
  });
  it("excludes secrets, dependencies, symlinks, and binary data", async () => {
    const p = await root();
    await mkdir(join(p, "node_modules"));
    await writeFile(join(p, "node_modules/ignored.js"), "ignore");
    await writeFile(join(p, ".env"), "secret");
    await writeFile(join(p, "asset.bin"), Buffer.from([0, 1, 2]));
    await writeFile(join(p, "ok.txt"), "safe");
    await symlink("/etc/passwd", join(p, "link"));
    const result = await run(p, "export");
    expect(result.code).toBe(0);
    const data = JSON.parse(result.output);
    expect(data.files.map((f: { path: string }) => f.path)).toEqual(["ok.txt"]);
    expect(data.skipped).toHaveLength(4);
  });
  it("rejects traversal and a symlinked workspace root", async () => {
    const p = await root();
    expect(
      (
        await run(p, "seed", {
          template: "python",
          files: [{ path: "../escape", type: "file", content: "bad" }],
        })
      ).code,
    ).toBe(1);
    const external = await root();
    await symlink(external, join(p, "linked"));
    expect((await run(join(p, "linked"), "export")).code).toBe(1);
  });
});
