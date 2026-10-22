#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
case "$MODE" in
  run|--verify|--logs) ;;
  *) echo "usage: $0 [run|--verify|--logs]" >&2; exit 2 ;;
esac

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
APP_BUNDLE="$ROOT_DIR/apps/macos/build/Craft Hub Prototype.app"
# Only the native prototype; Electron and other development servers are independent.
pkill -x CraftHubMac >/dev/null 2>&1 || true
pnpm build:macos
/usr/bin/open -n "$APP_BUNDLE"
case "$MODE" in
  --verify)
    sleep 2
    pgrep -x CraftHubMac >/dev/null
    ;;
  --logs)
    /usr/bin/log stream --info --style compact --predicate 'process == "CraftHubMac"'
    ;;
esac
