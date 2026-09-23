# SyncStudio 3.2 delivery

Full terminal path: README.md and docs/FULL_TERMINAL.md. Docker toolchains and the code-server workbench are included as buildable source. Startup now checks Docker before issuing build/start commands. The Terminal toolbar uses the full workspace when the runner is configured. tmux and persistent-terminal settings are included. The existing Docker-free local terminal remains available.

The image must be built on a Docker host. See docs/VERIFICATION.md for completed checks and unverified acceptance gates.
