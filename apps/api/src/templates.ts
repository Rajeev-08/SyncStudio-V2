import * as Y from "yjs";
import { randomUUID } from "node:crypto";
import type { FileNode, Template } from "../../../packages/shared/src/index";
export function makeFile(
  path: string,
  content = "",
  type: "file" | "folder" = "file",
): FileNode {
  const doc = new Y.Doc();
  doc.getText("content").insert(0, content);
  const state = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
  doc.destroy();
  return { id: randomUUID(), path, content, type, state };
}
const css = `:root { font-family: system-ui, sans-serif; color: #e9e9f0; background: #12131b; }\nbody { margin: 0; min-height: 100vh; display: grid; place-items: center; }\nmain { max-width: 480px; padding: 40px; }\n.badge { color: #a99cff; font-size: 13px; letter-spacing: .12em; }\nh1 { font-size: 48px; letter-spacing: -.05em; line-height: 1.1; }\np { color: #a1a3b5; line-height: 1.7; }\nbutton { background: #8170f5; color: white; border: 0; padding: 12px 20px; border-radius: 6px; cursor: pointer; font: inherit; }\n`;
export function templateFiles(template: Template): FileNode[] {
  const programs: Partial<Record<Template, [string, string]>> = {
    python: [
      "main.py",
      'name = input("Your name: ")\nprint(f"Hello, {name}! Welcome to SyncStudio.")\n',
    ],
    c: [
      "main.c",
      '#include <stdio.h>\nint main(void) {\n    printf("Hello from C!\\n");\n    return 0;\n}\n',
    ],
    cpp: [
      "main.cpp",
      '#include <iostream>\nint main() {\n    std::cout << "Hello from C++!" << std::endl;\n    return 0;\n}\n',
    ],
    java: [
      "Main.java",
      'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello from Java!");\n    }\n}\n',
    ],
    go: [
      "main.go",
      'package main\nimport "fmt"\nfunc main() { fmt.Println("Hello from Go!") }\n',
    ],
    rust: ["main.rs", 'fn main() { println!("Hello from Rust!"); }\n'],
  };
  const program = programs[template];
  if (program)
    return [
      makeFile(program[0], program[1]),
      makeFile(
        "README.md",
        `# ${template} workspace\n\nSelect ${program[0]} and click Run file. Use the Languages panel to check installed tools.\n\nEnable local tools with npm run local:setup, then restart npm run dev. No Docker required.\n`,
      ),
    ];
  if (template === "react")
    return [
      makeFile("src", "", "folder"),
      makeFile(
        "index.html",
        '<!doctype html>\n<html><head><link rel="stylesheet" href="./src/styles.css"></head><body><div id="root"></div><script type="module" src="./src/App.jsx"></script></body></html>',
      ),
      makeFile("src/styles.css", css),
      makeFile(
        "src/App.jsx",
        `import React, { useState } from 'react';\nimport { createRoot } from 'react-dom/client';\n\nfunction App() {\n  const [count, setCount] = useState(0);\n  return <main><span className="badge">BUILT TOGETHER</span><h1>A little idea.\nA shared beginning.</h1><p>Your React workspace is ready. Invite a teammate and make something great.</p><button onClick={() => setCount(count + 1)}>Clicked {count} times</button></main>;\n}\n\ncreateRoot(document.getElementById('root')).render(<App />);\n`,
      ),
    ];
  const ext = template === "typescript" ? "ts" : "js";
  return [
    makeFile(
      "index.html",
      `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <title>Our next great idea</title>\n  <link rel="stylesheet" href="./styles.css">\n</head>\n<body>\n  <main>\n    <span class="badge">BUILT TOGETHER</span>\n    <h1>A little idea.<br>A shared beginning.</h1>\n    <p>This is your canvas. Edit the code, invite a teammate, and bring your next idea to life.</p>\n    <button id="counter">Make it happen · 0</button>\n  </main>\n  <script type="module" src="./script.${ext}"></script>\n</body>\n</html>\n`,
    ),
    makeFile("styles.css", css),
    makeFile(
      `script.${ext}`,
      `let count${ext === "ts" ? ": number" : ""} = 0;\nconst button = document.querySelector('#counter');\n\nbutton?.addEventListener('click', () => {\n  count += 1;\n  button.textContent = \`Make it happen · \${count}\`;\n  console.log('You made it happen', count);\n});\n\nconsole.log('Workspace ready. Let’s build together.');\n`,
    ),
    makeFile(
      "README.md",
      "# Our next great idea\n\nBuilt together in SyncStudio.\n\nOpen index.html to begin. Changes appear in the live preview.\n",
    ),
  ];
}
