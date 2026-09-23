import { mkdir, lstat, readdir, readFile, open } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, dirname } from "node:path";
const root = resolve(process.env.WORKSPACE_ROOT ?? "/home/coder/project");
const excludes = new Set([
  "node_modules",
  ".git",
  ".venv",
  "venv",
  "__pycache__",
  ".next",
  "dist",
  "build",
  "target",
  ".cache",
  ".gradle",
]);
const valid = (p) =>
  p.length <= 240 &&
  p
    .split("/")
    .every(
      (n) => n && n !== "." && n !== ".." && /^[a-zA-Z0-9_.@() -]+$/.test(n),
    );
const securePath = async (p) => {
  if (!valid(p)) throw new Error("Unsupported path: " + p);
  const parts = p.split("/");
  for (let i = 1; i < parts.length; i++) {
    const info = await lstat(resolve(root, ...parts.slice(0, i)));
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error("Unsafe parent: " + p);
  }
  return resolve(root, p);
};
async function put(path, content) {
  const full = await securePath(path);
  let file;
  try {
    file = await open(
      full,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o644,
    );
  } catch (e) {
    if (e.code === "EEXIST") return;
    throw e;
  }
  try {
    await file.writeFile(content);
  } finally {
    await file.close();
  }
}
async function seed(input) {
  await mkdir(root, { recursive: true });
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("Unsafe workspace root");
  for (const f of [...input.files].sort(
    (a, b) => a.path.split("/").length - b.path.split("/").length,
  )) {
    if (f.type === "folder") {
      const p = await securePath(f.path);
      await mkdir(p, { recursive: true });
      const st = await lstat(p);
      if (st.isSymbolicLink() || !st.isDirectory())
        throw new Error("Unsafe folder");
    } else await put(f.path, f.content);
  }
  await mkdir(resolve(root, ".vscode"), { recursive: true });
  const configs = {
    web: {
      file: "package.json",
      content: JSON.stringify(
        {
          name: "syncstudio-project",
          private: true,
          type: "module",
          scripts: { dev: "vite --host 0.0.0.0", build: "vite build" },
          dependencies: { react: "^19.2.0", "react-dom": "^19.2.0" },
          devDependencies: { vite: "^7.1.0", typescript: "^5.9.2" },
        },
        null,
        2,
      ),
      command: "npm install && npm run dev",
      debug: {
        type: "node",
        request: "launch",
        name: "Debug current JS file",
        program: "${file}",
        skipFiles: ["<node_internals>/**"],
      },
    },
    python: {
      file: "main.py",
      content:
        'def greet(name: str) -> str:\n    return f"Hello, {name}!"\n\nif __name__ == "__main__":\n    print(greet("SyncStudio"))\n',
      command: "python3 main.py",
      debug: {
        type: "debugpy",
        request: "launch",
        name: "Debug Python",
        program: "${file}",
        console: "integratedTerminal",
      },
    },
    cpp: {
      file: "main.cpp",
      content:
        '#include <iostream>\nint main() { std::cout << "Hello, SyncStudio!\\n"; return 0; }\n',
      command:
        "g++ -g main.cpp -o /tmp/syncstudio-main && /tmp/syncstudio-main",
      debug: {
        type: "lldb",
        request: "launch",
        name: "Debug C++",
        program: "/tmp/syncstudio-main",
        preLaunchTask: "Run project",
        cwd: "${workspaceFolder}",
      },
    },
    java: {
      file: "Main.java",
      content:
        'public class Main {\n  public static void main(String[] args) { System.out.println("Hello, SyncStudio!"); }\n}\n',
      command: "java Main.java",
      debug: {
        type: "java",
        request: "launch",
        name: "Debug Java",
        mainClass: "Main",
      },
    },
    go: {
      file: "main.go",
      content:
        'package main\nimport "fmt"\nfunc main() { fmt.Println("Hello, SyncStudio!") }\n',
      command: "go run main.go",
      debug: {
        type: "go",
        request: "launch",
        name: "Debug Go",
        mode: "auto",
        program: "${workspaceFolder}/main.go",
      },
    },
    rust: {
      file: "main.rs",
      content: 'fn main() { println!("Hello, SyncStudio!"); }\n',
      command:
        "rustc -g main.rs -o /tmp/syncstudio-main && /tmp/syncstudio-main",
      debug: {
        type: "lldb",
        request: "launch",
        name: "Debug Rust",
        program: "/tmp/syncstudio-main",
        preLaunchTask: "Run project",
        cwd: "${workspaceFolder}",
      },
    },
  };
  if (input.template === "web")
    await put(
      "vite.config.js",
      "import { defineConfig } from 'vite';\nexport default defineConfig({base: '/absproxy/5173/', server: {host: '0.0.0.0', port: 5173, strictPort: true, allowedHosts: ['.localhost', ...(process.env.SYNCSTUDIO_IDE_HOST ? [process.env.SYNCSTUDIO_IDE_HOST] : [])]}});\n",
    );
  if (input.template === "rust")
    await put(
      "Cargo.toml",
      '[package]\nname = "syncstudio-project"\nversion = "0.1.0"\nedition = "2021"\n\n[[bin]]\nname = "syncstudio-project"\npath = "main.rs"\n',
    );
  if (input.template === "cpp")
    await put("compile_flags.txt", "-std=c++17\n-g\n");
  const chosen = configs[input.template];
  await put(chosen.file, chosen.content + "\n");
  await put(
    ".vscode/tasks.json",
    JSON.stringify(
      {
        version: "2.0.0",
        tasks: [
          {
            label: "Run project",
            type: "shell",
            command: chosen.command,
            problemMatcher: [],
            group: { kind: "build", isDefault: true },
          },
        ],
      },
      null,
      2,
    ),
  );
  await put(
    ".vscode/launch.json",
    JSON.stringify(
      { version: "0.2.0", configurations: [chosen.debug] },
      null,
      2,
    ),
  );
  await put(
    ".vscode/settings.json",
    JSON.stringify(
      {
        "editor.formatOnSave": true,
        "files.exclude": { "**/__pycache__": true },
        "python.defaultInterpreterPath": "/usr/bin/python3",
        "java.jdt.ls.java.home": "/opt/java/openjdk",
        "terminal.integrated.defaultProfile.linux": "bash",
        "terminal.integrated.enablePersistentSessions": true,
        "terminal.integrated.scrollback": 10000,
      },
      null,
      2,
    ),
  );
  await put(
    ".gitignore",
    "node_modules/\n.venv/\n__pycache__/\ndist/\nbuild/\ntarget/\n.env\n",
  );
  return { ok: true };
}
async function exportFiles() {
  const files = [],
    skipped = [];
  let bytes = 0,
    visited = 0;
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
    throw new Error("Unsafe workspace root");
  async function walk(dir, prefix = "") {
    for (const name of (await readdir(dir)).sort()) {
      if (++visited > 3000)
        throw new Error(
          "Too many files to review. Use Git to export this workspace.",
        );
      const path = prefix + name;
      if (excludes.has(name) || name === ".env" || name.startsWith(".env.")) {
        skipped.push({
          path,
          reason: "dependencies, build output, Git metadata, or secrets",
        });
        continue;
      }
      if (!valid(path)) {
        skipped.push({ path, reason: "unsupported collaborative filename" });
        continue;
      }
      const full = resolve(dir, name),
        info = await lstat(full);
      if (info.isSymbolicLink()) {
        skipped.push({ path, reason: "symbolic link" });
        continue;
      }
      if (info.isDirectory()) {
        files.push({ path, type: "folder", content: "" });
        await walk(full, path + "/");
      } else if (info.isFile()) {
        if (info.size > 800000) {
          skipped.push({ path, reason: "file too large" });
          continue;
        }
        const handle = await open(
          full,
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        let buffer;
        try {
          buffer = await handle.readFile();
        } finally {
          await handle.close();
        }
        let content;
        try {
          content = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
        } catch {
          skipped.push({ path, reason: "binary file" });
          continue;
        }
        if (content.includes("\0") || content.length > 200000) {
          skipped.push({ path, reason: "binary or oversized file" });
          continue;
        }
        bytes += buffer.length;
        if (bytes > 2_000_000)
          throw new Error(
            "Import exceeds 2 MB. Use Git or individual file downloads.",
          );
        files.push({ path, type: "file", content });
      } else skipped.push({ path, reason: "special file" });
      if (files.length > 150)
        throw new Error(
          "Import exceeds 150 files and folders. Use Git or reduce the source tree.",
        );
    }
  }
  await walk(root);
  return { files, skipped };
}
try {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 3_000_000) throw new Error("Seed too large");
  }
  const mode = process.argv[2];
  const output =
    mode === "seed"
      ? await seed(JSON.parse(input))
      : mode === "export"
        ? await exportFiles()
        : null;
  if (!output) throw new Error("Unknown file operation");
  process.stdout.write(JSON.stringify(output));
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
