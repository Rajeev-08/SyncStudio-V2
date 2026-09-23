import { createRunner } from "./server";
const runner = createRunner({
  secret: process.env.RUNNER_SECRET ?? "",
  publicURL: process.env.IDE_PUBLIC_URL ?? "http://localhost:3002",
  appURL: process.env.APP_INTERNAL_URL ?? "http://app:3001",
  dataDir: process.env.RUNNER_DATA ?? "/data",
  runnerName: process.env.RUNNER_CONTAINER ?? "syncstudio-runner",
  maxRunning: Number(process.env.MAX_RUNNING_WORKSPACES ?? 6),
  idleMinutes: Number(process.env.WORKSPACE_IDLE_MINUTES ?? 30),
});
runner.control.listen(7000, "0.0.0.0", () =>
  console.log("Workspace control ready"),
);
runner.gateway.listen(3002, "0.0.0.0", () => console.log("IDE gateway ready"));
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    await runner.close();
    process.exit(0);
  });
