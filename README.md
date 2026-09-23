# SyncStudio 3.2 — full terminal and development workspace

SyncStudio now includes a visible **Terminal / Output / Languages** panel in the regular Monaco editor, real local shell sessions, and Run/Stop controls. Python, C, C++, Java, Go and Rust project templates join the existing web templates.

## Recommended: full terminal and toolchains

Install Node.js 24+ and [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/). Start Docker Desktop with Linux containers. Open PowerShell in the extracted folder containing package.json:

```powershell
npm ci
npm run ide:up
```

This checks Docker, generates configuration, builds the images and starts the services. Open **http://localhost:3001**, register, create a project, then click **Terminal → Create workspace → Open full IDE**. In the new IDE tab, choose **Terminal → New Terminal**. Use + for additional terminals and Split Terminal for side-by-side shells. The full IDE edits the same files its terminal executes; it supports package installation, Git, language extensions and debugger integrations.

Python, C/C++, Java, Go, Rust and Node toolchains are included in the workspace image. You do not need to install them individually on Windows. The shell inside this workspace is Linux Bash. Run `tmux new -As work` to keep a shell session across browser reconnections; processes still stop when the workspace container stops. Files remain in a persistent volume.

`npm run ide:doctor` diagnoses Docker prerequisites. `npm run ide:logs` shows service logs. `npm run ide:stop` stops workspaces and services; `npm run ide:start` starts services again. Stop an existing local `npm run dev` session first because both modes use port 3001. Docker mode uses its own database volume, so existing local-mode projects are not automatically migrated.

The full IDE is a personal workspace. Its terminal edits appear immediately in that IDE's explorer; use **Review changes → Import reviewed files** to bring them back to the shared collaborative editor. See [full terminal guide](docs/FULL_TERMINAL.md).

## Start without Docker (Windows, macOS, Linux)

Install **Node.js 24+**, extract this ZIP, open a terminal in the folder containing `package.json`, then run:

```powershell
npm ci
npm run local:setup
npm run dev
```

Enter the email you will use for your local account during setup. Open **http://localhost:5173** and register or sign in with that same email. Create a Python, C, C++, or Java project, open its source file, and click **Run file**. Click **Terminal** in the toolbar and **Open terminal** for a real PowerShell session on Windows or Bash on Linux/macOS. The Languages tab reports installed and missing tools.

Install the runtimes you need on your computer: Python 3, GCC/Clang for C/C++, and JDK 17+ for Java. Reopen PowerShell and restart the app after changing PATH. Compilers are not bundled with the source ZIP. See [the local setup and troubleshooting guide](docs/LOCAL_TOOLS.md).

Local commands execute with your OS account permissions. This mode is limited to your configured account, projects you own, loopback access, and development mode. Each run and terminal uses a saved project copy; terminal edits do not automatically sync into the collaborative editor.

**Verified:** 59 tests, lint, strict TypeScript, and production build passed on Linux, including actual terminal input and Python/C/C++/Java/JS/TS execution. Windows execution and the optional Docker stack were not tested here. See [verification details](docs/VERIFICATION.md).

## Optional VS Code workbench with Docker

The separate code-server workspaces retain the VS Code-style extension manager, Git UI, tasks, and debugger integrations. Those optional workspaces still use Docker; the local editor and terminal above do not.

Install Node.js **24+** and Docker Desktop (Linux containers / WSL 2 on Windows), or Docker Engine with Compose v2 on Linux. Allocate enough disk for several language toolchains and ideally 8 GB or more RAM to Docker. The initial image build downloads several GB and installs extensions from Open VSX.

From this extracted directory:

```bash
npm ci
npm run ide:setup
npm run ide:build
npm run ide:start
```

Open **http://localhost:3001**, register, create a project, and click **Full IDE** in the editor toolbar. Choose an environment, create the workspace, and click **Open full IDE**. The launch link expires after 60 seconds and works once. It opens a separate tab at a workspace-specific `*.localhost:3002` address; use a current browser that resolves localhost subdomains to loopback.

The setup command generates a private runner secret in `.env` without printing it. Do not commit `.env`. The default full stack uses a persistent SQLite volume; no external database or paid API is required.

```bash
npm run ide:stop     # Stops the app, runner, and dynamic workspace containers; retains files
npm run ide:start    # Starts services again; use Resume workspace in the UI
```

Do not use `docker compose down --volumes` unless you intentionally want to erase application data. Personal IDE volumes are removed through the explicit workspace deletion control. Deleting a project also removes all its personal IDE workspaces.

## What is included

| Area | Full IDE | Collaborative editor |
|---|---|---|
| Editing | VS Code workbench, split editors, settings, command palette, search/replace | Monaco tabs, quick open, formatting, themes, minimap |
| Languages | JS/TS, Python, C/C++, Java, Go, Rust toolchains and language extensions | Syntax highlighting for these and additional languages |
| Terminal | Real Bash sessions inside a persistent Linux container | Open Full IDE to use the shell |
| Packages | npm, pip/venv, Maven, Cargo, Go tools | Browser preview has a bounded built-in runtime |
| Git | CLI and Source Control; configure your own identity/credentials | Recovery snapshots and source diffs |
| Debugging | Language extensions plus starter tasks and launch configurations | Browser preview console |
| Preview | Authenticated port proxy for running servers | Sandboxed HTML/React/TS preview |
| Collaboration | Personal environment; explicit review/import into the shared project | Yjs concurrent edits, cursors, presence, offline recovery |
| Team tools | Workspace access follows project roles | Members, comments, history, activity, AI proposal review |

This is not the Microsoft distribution of VS Code: extensions come from Open VSX, and compatibility varies. Microsoft Marketplace and Live Share are not provided. Existing Yjs collaboration and AI proposal review remain in the SyncStudio editor; they are not silently represented as live collaboration inside code-server.

## Run and debug

Open **Terminal → New Terminal** in the full IDE. The environment seed adds a runnable example, `.vscode/tasks.json`, `.vscode/launch.json`, and editor settings without replacing files already in the project.

| Environment | Run command |
|---|---|
| Web / React / TypeScript | `npm install && npm run dev` |
| Python | `python3 main.py` |
| C / C++ | `g++ -g main.cpp -o /tmp/app && /tmp/app` |
| Java | `java Main.java` |
| Go | `go run main.go` |
| Rust | `cargo run` |

Use **Tasks: Run Task → Run project** or **Run and Debug**. For Python dependencies, create `.venv` with `python3 -m venv .venv`, activate it, install packages, and select its interpreter. Configure larger project builds and debug targets as normal in VS Code.

The web starter runs on port 5173 and sets its base path to `/absproxy/5173/`. Open that path on your IDE hostname to preview it. For another framework or port, configure its base path and use `/absproxy/PORT/`, or `/proxy/PORT/` for a server designed for relative URLs. No preview port is published directly on the host.

## Bring full IDE work back into collaboration

1. Save the files in the full IDE.
2. Return to SyncStudio → Full IDE → **Review changes** (project owner only).
3. Inspect added, modified, deleted, and excluded paths.
4. **Import reviewed files** commits the exact reviewed contents and saves a recovery snapshot first.

Each user/project pair has its own persistent working copy. There is no background filesystem-to-Yjs overwrite. Import is rejected if the shared file tree changed since creation/last import or during review. Imports reset document generations and clear old file comments, as disclosed before confirmation.

The shared editor remains bounded to 150 file/folder nodes and 200,000 characters per file; imports also have a 2 MB text limit. Dependencies, `.git`, `.env` files, build outputs, binary files, and symlinks are excluded and listed. The IDE itself can contain larger repositories; use Git or IDE downloads to export those. Review the deletions carefully: excluded paths do not become shared source files.

## Verify

```bash
npm run check       # lint + automated tests + typecheck + build
npm run test:ide    # requires the complete Docker stack already running
npm run test:mongo  # optional Mongo-specific gate
npm run test:e2e    # separate collaborative-editor Playwright suite
```

The ordinary CI job runs source checks, Mongo tests, and the existing browser suite. The **Full IDE runtime acceptance** workflow is manually triggered and builds the real workspace image before running `test:ide`. The smoke test registers an isolated test account, creates a project, checks actual installed language tools and Python execution, opens the authenticated code-server workbench, imports an on-disk change, verifies persistence across restart, then deletes its test project. It is not a UI terminal/debugger acceptance test.

## Architecture and operations

- `apps/web`: dashboard, collaborative editor, workspace lifecycle/review UI.
- `apps/api`: accounts, project permissions, Yjs persistence, snapshots, AI, runtime API and authorization callback.
- `apps/runner`: private control API, Docker lifecycle, launch tickets, per-host IDE sessions, HTTP/WebSocket gateway, idle cleanup.
- `infrastructure/workspace`: code-server image, language tools, extension installation, safe seed/export helper.
- `compose.ide.yaml`: complete local stack; `compose.yaml`: retained collaborative-editor/Mongo stack.

Use **one API and one runner**. Each workspace gets a separate network and persistent home volume. The runner holds Docker socket access; the main API and workspace containers do not. The runtime is intended for local development and a trusted small team. Ordinary containers are not a sufficient boundary for hostile public multi-tenant code execution. See [RUNTIME.md](docs/RUNTIME.md) before hosting it.

AI remains optional: set `AI_API_KEY`, `AI_BASE_URL`, and `AI_MODEL` for your provider. Git credentials and third-party service accounts are supplied by each user inside their workspace. There is no automated GitHub OAuth setup, outbound email/password reset service, or deployment-from-editor system.

References: [runtime setup and security](docs/RUNTIME.md), [verification](docs/VERIFICATION.md), [collaborative editor details](docs/COLLABORATIVE_EDITOR.md), [architecture](docs/ARCHITECTURE.md), [system design](docs/SYSTEM_DESIGN.md), [API](docs/API.md).
