# Docker-free local tools

## Setup

Use Node.js 24 or newer. Run `npm ci`, `npm run local:setup`, then `npm run dev`. Open http://localhost:5173, using localhost consistently. Register/sign in with the email entered during setup, and create a project you own. The setup command preserves unrelated .env settings and enables local execution for that email only.

Open the Terminal tab and click Open terminal. The terminal supports interactive input, resizing and Ctrl+C. Run file saves the collaborative files first, streams program output, accepts standard input, and offers Stop. Runs have a 120-second limit and a 1 MB output budget.

## Toolchains

| Language | Install / command required | Run behavior |
| --- | --- | --- |
| JavaScript | Node.js 24+ (already required) | Node executes the selected file |
| TypeScript | Node.js 24+ | Native type stripping; not all TypeScript syntax or tsconfig transforms |
| Python | Python 3; python3 or python, or Windows py -3 | Unbuffered interpreter with stdin |
| C | GCC or Clang on PATH | Compile selected file, then execute |
| C++ | G++ or Clang++ on PATH | Compile selected file, then execute |
| Java | JDK 17+ recommended, java on PATH | Java source-file launch |
| Go | Go on PATH | go run selected file |
| Rust | Rust toolchain, rustc on PATH | Compile selected file, then execute |

On Windows, a GCC/G++ distribution such as MSYS2 UCRT64 can supply C/C++ compilers; add its compiler bin directory to PATH. Install a Windows Python distribution with its launcher and a JDK. Close and reopen PowerShell after installation, then restart SyncStudio. Check `py -3 --version`, `gcc --version`, `g++ --version`, and `java --version` there. The Languages tab checks the environment inherited by the API.

## Troubleshooting

- **Terminal missing native backend:** node-pty is optional so other features still install. Retry `npm rebuild node-pty` or `npm install --include=optional`. If compilation is required, Windows needs Python and Visual Studio Build Tools with Desktop development with C++; Linux needs Python, make and a C++ compiler; macOS needs Xcode command-line tools. Run File remains available without node-pty. Windows native installation was not exercised in this delivery.
- **Local tools disabled:** run local:setup, restart the app and sign in with the configured email. Use http://localhost:5173. This feature is deliberately disabled for production and remote client URLs.
- **Not installed:** install the indicated tool, update PATH, and restart the server.
- **Run fails in a web project:** Run File uses Node for JavaScript/TypeScript. Browser-only code that uses document/window belongs in Preview.
- **Terminal edits not shown in editor:** terminal and run sessions use separate saved project copies. The panel displays the actual working directory. Copy changes back explicitly; there is no silent two-way synchronization. Directories are retained under the configured local workspace root for recovery and may be removed manually when no session uses them.

## Scope and safety

This is a real local shell, not a sandbox. Run only trusted code. Local execution uses your OS user's filesystem/network permissions, but does not pass application secrets into child environments. Only the configured operator and project owner can open these sockets. Origin/session/ownership checks apply, and logout or disconnect stops processes. The API and Vite bind to loopback in local mode.

The regular editor provides syntax highlighting, templates and execution for the listed languages. It does not include native-language LSP IntelliSense, breakpoint debugging, or a VS Code extension host. Multi-file builds, packages and custom commands can be run through the terminal. The optional Docker/code-server path provides the broader workbench separately.

## Validation

`npm run check` includes actual local execution tests and requires Python, GCC, G++, Java and node-pty in addition to Node. The delivery environment passed all 59 tests. Go/Rust execution and Windows PowerShell/ConPTY require validation on machines with those tools.
