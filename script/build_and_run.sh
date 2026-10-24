#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
case "$MODE" in
  run|--verify|--logs|--telemetry) ;;
  *) echo "usage: $0 [run|--verify|--logs|--telemetry]" >&2; exit 2 ;;
esac

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
APP_BUNDLE="$ROOT_DIR/apps/macos/build/Craft Hub Prototype.app"
# Leave existing app instances running, including the installed daily-use app.
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
  --telemetry)
    /usr/bin/log stream --debug --style compact --predicate 'process == "CraftHubMac" AND category == "Performance"'
    ;;
esac
