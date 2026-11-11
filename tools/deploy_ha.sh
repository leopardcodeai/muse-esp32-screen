#!/bin/sh
# deploy_ha.sh: pull, test, build and sync Muse Web Screen to Home Assistant.
#
# Runs from the LaunchAgent com.leopardcode.muse-web-deploy (every 15 minutes and at
# login) or by hand. It deploys the working tree (the owner edits and wants the display
# to follow), but a failing test stops before the bundle is written.
set -eu

ROOT=$(unset CDPATH; cd -- "$(dirname "$0")/.." && pwd)
LOG="$HOME/Library/Logs/muse-web-deploy.log"
mkdir -p "$(dirname "$LOG")"
exec >>"$LOG" 2>&1

echo "=== $(date '+%Y-%m-%d %H:%M:%S') $ROOT"
cd "$ROOT"

git pull --ff-only || echo "pull skipped (offline or diverged); deploying the local state"

if command -v node >/dev/null 2>&1; then
    node --test web/test >/dev/null || { echo "web tests failed; nothing deployed"; exit 1; }
else
    echo "node not found; skipping the web tests"
fi
python3 -m pytest tools/tests/test_muse_scripts.py -q >/dev/null || {
    echo "script tests failed; nothing deployed"
    exit 1
}

tools/make_ha_bundle.sh >/dev/null
uv run --quiet --with smbprotocol python3 tools/sync_ha_web.py
