# Full terminal support

Use the Docker/code-server workspace for the complete terminal experience. Run `npm run ide:up` after installing and opening Docker Desktop. This is a real Linux development environment with Bash, multiple terminal tabs, split terminals, interactive stdin, Ctrl+C, shell history, job control, terminal resizing, package managers, Git, Python virtual environments and native compilers. Terminal commands and code-server's file explorer work on the same persistent project directory.

## Open it

1. Open http://localhost:3001 and sign in.
2. Create/open a collaborative project. Click Terminal or Full IDE.
3. Choose the environment and Create workspace. Then Open full IDE.
4. In the new tab choose Terminal → New Terminal. Create additional terminals with + or Split Terminal. Use the trash icon to kill a terminal.
5. Run your project or use the generated Run project task. Tasks and debugger configurations live in .vscode.

The separate local panel remains available for installations without Docker. It is not the same session as the full workspace.

## Commands

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install requests
python main.py

gcc -g main.c -o app && ./app
g++ -g main.cpp -o app && ./app
java Main.java
go run main.go
cargo new example
npm install
npm run dev -- --host 0.0.0.0
```

Use commands appropriate to your project. Packages need network access. The workspace runs as a non-root user; system packages belong in the image Dockerfile and require rebuilding. Open application servers through the IDE's /absproxy/PORT/ route as described in RUNTIME.md.

## Reconnection and persistence

Run `tmux new -As work` for an explicitly reconnectable terminal session. Detach with Ctrl+B then D; run the same command to reattach. Browser disconnection does not stop tmux while the container remains running. Container stop/restart, host reboot and the configured idle timeout stop running programs. Persistent files and installed user packages survive stop/start. No claim of process survival across a container restart is made.

The default idle timeout is 30 minutes disconnected. Workspaces have CPU/memory limits. Killing a terminal or stopping a workspace can interrupt unsaved work. Do not expose this trusted-team development stack as a public untrusted-code service.

## Validation

Run `npm run test:ide` against the running Docker stack. It creates and deletes its own test project, checks toolchain commands, exercises Python and a real container PTY, creates a tmux session, checks authenticated workbench HTTP and tests file review/import and restart persistence. It does not drive the browser terminal UI. The manual GitHub Actions workflow also runs this test. Docker is unavailable in the delivery environment, so this acceptance gate must still be run on a Docker host.
