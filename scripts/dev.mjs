import { spawn } from "node:child_process";
const children = [];
for (const [script, args] of [
  ["node_modules/tsx/dist/cli.mjs", ["watch", "apps/api/src/index.ts"]],
  ["node_modules/vite/bin/vite.js", process.argv.slice(2)],
]) {
  const child = spawn(process.execPath, [script, ...args], {
    stdio: "inherit",
  });
  children.push(child);
  child.on("exit", (code) => {
    if (code) {
      children.forEach((c) => c.kill());
      process.exit(code);
    }
  });
}
function close() {
  children.forEach((c) => c.kill());
  process.exit(0);
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
