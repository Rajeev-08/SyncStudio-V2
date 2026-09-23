#!/bin/sh
set -eu
mkdir -p /home/coder/.local/share/code-server/extensions /home/coder/project
# User-installed extensions live in the persistent home volume.
if [ ! -f /home/coder/.local/share/code-server/.extensions-seeded ]; then
  cp -R /opt/syncstudio/extensions/. /home/coder/.local/share/code-server/extensions/
  touch /home/coder/.local/share/code-server/.extensions-seeded
fi
exec code-server --bind-addr 0.0.0.0:8080 --auth none --disable-telemetry --disable-update-check --disable-workspace-trust /home/coder/project
