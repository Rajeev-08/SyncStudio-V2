import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
const arg = process.argv.find((v) => v.startsWith("--email="));
const rl = createInterface({ input: process.stdin, output: process.stdout });
let email = arg?.slice(8);
try {
  if (!email)
    email = await rl.question(
      "Email for your local SyncStudio account (you can register it afterward): ",
    );
} finally {
  rl.close();
}
email = email.trim().toLowerCase();
if (!/^[^\s@=]+@[^\s@=]+\.[^\s@=]+$/.test(email) || /[\r\n#"']/.test(email))
  throw new Error("Enter a valid email address.");
let env = "";
try {
  env = await readFile(".env", "utf8");
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
for (const key of [
  "LOCAL_EXECUTION",
  "LOCAL_OPERATOR_EMAIL",
  "CLIENT_URL",
  "NODE_ENV",
])
  env = env.replace(new RegExp("^" + key + "=.*\\r?\\n?", "gm"), "");
env +=
  "\nLOCAL_EXECUTION=true\nLOCAL_OPERATOR_EMAIL=" +
  email +
  "\nCLIENT_URL=http://localhost:5173\nNODE_ENV=development\n";
await writeFile(".env", env, { mode: 0o600 });
console.log(
  "Local tools enabled for " +
    email +
    ".\nRun npm run dev, open http://localhost:5173, and sign in or register with this email.\nTerminal commands run as your OS user. Keep this local setup private.",
);
