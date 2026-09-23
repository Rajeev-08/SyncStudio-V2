/** Run against the complete local Docker stack: npm run test:ide */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { request } from "node:http";
import { workspaceKey } from "../packages/shared/src/runtime";
const base = process.env.IDE_TEST_APP_URL ?? "http://localhost:3001";
let cookie = "",
  projectId = "",
  userId = "";
async function api(path: string, method = "GET", body?: unknown) {
  const res = await fetch(base + "/api" + path, {
    method,
    headers: {
      Origin: base,
      Cookie: cookie,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(150000),
  });
  if (res.headers.get("set-cookie"))
    cookie = res.headers.get("set-cookie")!.split(";")[0];
  const data = await res.json();
  assert(res.ok, JSON.stringify(data));
  return data;
}
async function gateway(
  url: URL,
  path: string,
  method = "GET",
  body?: unknown,
  session = "",
) {
  return new Promise<{ status: number; body: string; cookie: string }>(
    (resolve, reject) => {
      const req = request(
        {
          hostname: "127.0.0.1",
          port: Number(url.port || 3002),
          path,
          method,
          headers: {
            Host: url.host,
            Origin: url.origin,
            Cookie: session,
            "Content-Type": "application/json",
          },
        },
        (res) => {
          let out = "";
          res.on("data", (d) => (out += d));
          res.on("end", () =>
            resolve({
              status: res.statusCode!,
              body: out,
              cookie: res.headers["set-cookie"]?.[0].split(";")[0] ?? "",
            }),
          );
        },
      );
      req.on("error", reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    },
  );
}
try {
  const suffix = randomBytes(6).toString("hex");
  userId = (
    await api("/auth/register", "POST", {
      username: "ide_" + suffix,
      email: `ide_${suffix}@example.test`,
      password: randomBytes(24).toString("hex"),
    })
  ).id;
  projectId = (
    await api("/projects", "POST", {
      name: "IDE smoke " + suffix,
      template: "vanilla",
    })
  ).id;
  const runtime = `/projects/${projectId}/runtime`;
  assert.equal(
    (await api(runtime + "/start", "POST", { template: "python" })).state,
    "running",
  );
  const container = "ss-" + workspaceKey(projectId, userId);
  function run(...args: string[]) {
    return execFileSync("docker", ["exec", container, ...args], {
      encoding: "utf8",
      timeout: 60000,
    }).trim();
  }
  for (const command of [
    ["node", "--version"],
    ["python3", "--version"],
    ["g++", "--version"],
    ["java", "--version"],
    ["go", "version"],
    ["rustc", "--version"],
    ["git", "--version"],
    ["tmux", "-V"],
    ["gopls", "version"],
    ["dlv", "version"],
  ])
    assert(run(...command).length > 0, command[0] + " unavailable");
  assert.equal(
    run("python3", "/home/coder/project/main.py"),
    "Hello, SyncStudio!",
  );
  run(
    "node",
    "-e",
    "require('fs').writeFileSync('/home/coder/project/from-terminal.txt','persistent IDE file')",
  );
  // This validates the container PTY, not the workbench's browser terminal UI.
  assert.match(
    run(
      "python3",
      "-c",
      String.raw`
import os, pty, signal
signal.alarm(10)
pid, fd = pty.fork()
if pid == 0:
    os.execlp("bash", "bash", "-c", 'test -t 0 && read value && printf "PTY:%s\n" "$value"')
os.write(fd, b"terminal-ok\n")
out = b""
while True:
    try:
        chunk = os.read(fd, 4096)
        if not chunk: break
        out += chunk
    except OSError:
        break
os.waitpid(pid, 0)
print(out.decode())
`,
    ),
    /PTY:terminal-ok/,
  );
  run("tmux", "new-session", "-d", "-s", "acceptance", "bash");
  assert.equal(
    run("tmux", "display-message", "-p", "-t", "acceptance", "#{session_name}"),
    "acceptance",
  );
  run("tmux", "kill-session", "-t", "acceptance");
  const launch = new URL((await api(runtime + "/launch", "POST", {})).url);
  const signed = await gateway(launch, "/session", "POST", {
    ticket: new URLSearchParams(launch.hash.slice(1)).get("ticket"),
  });
  assert.equal(signed.status, 204);
  const workbench = await gateway(
    launch,
    "/?folder=/home/coder/project",
    "GET",
    undefined,
    signed.cookie,
  );
  assert.equal(workbench.status, 200);
  assert.match(workbench.body, /workbench|code-server/i);
  const review = await api(runtime + "/review", "POST", {});
  assert(
    review.changes.some(
      (c: { path: string }) => c.path === "from-terminal.txt",
    ),
  );
  await api(runtime + "/import", "POST", { reviewId: review.reviewId });
  assert(
    (await api("/projects/" + projectId)).files.some(
      (f: { path: string; content: string }) =>
        f.path === "from-terminal.txt" && f.content === "persistent IDE file",
    ),
  );
  await api(runtime + "/stop", "POST", {});
  await api(runtime + "/start", "POST", { template: "python" });
  assert.equal(
    run("cat", "/home/coder/project/from-terminal.txt"),
    "persistent IDE file",
  );
  console.log(
    "PASS: real toolchains, code-server gateway, persistent files, review/import, and restart.",
  );
} finally {
  if (projectId) await api("/projects/" + projectId, "DELETE");
}
