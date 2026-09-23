FROM node:24-bookworm-slim AS node
FROM golang:1-bookworm AS go
FROM rust:1-bookworm AS rust
FROM eclipse-temurin:21-jdk-jammy AS java
FROM ghcr.io/coder/code-server:4.136.2
USER root
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
COPY --from=go /usr/local/go /usr/local/go
COPY --from=rust /usr/local/cargo /usr/local/cargo
COPY --from=rust /usr/local/rustup /usr/local/rustup
COPY --from=java /opt/java/openjdk /opt/java/openjdk
ENV PATH="/opt/java/openjdk/bin:/usr/local/go/bin:/usr/local/cargo/bin:/home/coder/go/bin:${PATH}" JAVA_HOME=/opt/java/openjdk RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/home/coder/.cargo
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv python3-pip build-essential clang clangd gdb lldb cmake make git openssh-client curl ca-certificates maven zip unzip tmux less procps && rm -rf /var/lib/apt/lists/* && chmod -R a+rX /usr/local/rustup /usr/local/cargo
COPY infrastructure/workspace/files.mjs /opt/syncstudio/files.mjs
RUN mkdir -p /home/coder/project /home/coder/.cargo /opt/syncstudio/extensions && chown -R 1000:1000 /home/coder /opt/syncstudio/extensions
# Build fails explicitly if an extension cannot be installed; no fake success.
USER 1000:1000
RUN code-server --extensions-dir /opt/syncstudio/extensions --install-extension ms-pyright.pyright --install-extension ms-python.python --install-extension ms-python.debugpy --install-extension llvm-vs-code-extensions.vscode-clangd --install-extension redhat.java --install-extension vscjava.vscode-java-debug --install-extension golang.go --install-extension rust-lang.rust-analyzer --install-extension vadimcn.vscode-lldb --install-extension dbaeumer.vscode-eslint --install-extension esbenp.prettier-vscode
RUN go install golang.org/x/tools/gopls@latest && go install github.com/go-delve/delve/cmd/dlv@latest
COPY infrastructure/workspace/start.sh /opt/syncstudio/start.sh
WORKDIR /home/coder/project
ENTRYPOINT ["/bin/sh", "/opt/syncstudio/start.sh"]
