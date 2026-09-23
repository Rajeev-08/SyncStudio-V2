import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const action = process.argv[2] ?? "doctor";
const compose = ["compose", "-f", "compose.ide.yaml"];
function inspect(args, message) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    timeout: 20000,
  });
  if (result.error || result.status !== 0) throw new Error(message);
  return result.stdout.trim();
}
function doctor() {
  inspect(
    ["--version"],
    "Docker was not found. Install and open Docker Desktop, enable Linux containers, then reopen PowerShell. Guide: https://docs.docker.com/desktop/setup/install/windows-install/",
  );
  inspect(
    ["compose", "version"],
    "Docker Compose v2 is missing. Update Docker Desktop.",
  );
  const os = inspect(
    ["info", "--format", "{{.OSType}}"],
    "Docker is installed but its engine is not reachable. Start Docker Desktop and wait until the engine is running.",
  );
  if (os !== "linux")
    throw new Error(
      "Switch Docker Desktop to Linux containers; this workspace image cannot use Windows containers.",
    );
  console.log("Docker engine and Compose are ready (Linux containers).");
}
async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: false });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `${command} exited with code ${code}. See the output above.`,
            ),
          ),
    );
  });
}
try {
  if (!["doctor", "build", "start", "up", "logs"].includes(action))
    throw new Error("Use doctor, build, start, up, or logs.");
  doctor();
  if (action === "up") await run(process.execPath, ["scripts/setup-ide.mjs"]);
  if (action === "up" || action === "build")
    await run("docker", [...compose, "--profile", "images", "build"]);
  if (action === "up" || action === "start") {
    await run("docker", [
      ...compose,
      "up",
      "-d",
      "--wait",
      "--wait-timeout",
      "120",
    ]);
    console.log(
      "Open http://localhost:3001 → project → Terminal → Create workspace → Open full IDE. Inside the IDE: Terminal → New Terminal.",
    );
  }
  if (action === "logs")
    await run("docker", [...compose, "logs", "--tail", "100"]);
} catch (error) {
  console.error("\n" + error.message);
  process.exitCode = 1;
}
