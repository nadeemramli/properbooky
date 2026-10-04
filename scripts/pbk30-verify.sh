#!/usr/bin/env bash
# PBK-30 runtime verification against the disposable fixture stack
# (scripts/pbk30-stack.sh), never the ordinary development stack.
#
#   scripts/pbk30-verify.sh [all|build|before|restart|after|devmode]
#
# all     = build, before, restart, after, devmode (default)
# build   = `next build` in production mode against the fixture stack
# before  = criteria 2-4 (and the state criterion 5 re-checks) through the UI
# restart = stop the Next server and the fixture containers WITHOUT deleting
#           volumes, then start both again
# after   = criterion 5: re-check metadata, annotations, recommendations,
#           uploaded files and CSV rows after the restart
# devmode = `next dev` with the dev-mode sign-in: identity + provisioning;
#           recreates the fixture's dev account, so needs PBK30_DISPOSABLE=1
#           (runs last: next dev rewrites .next)
#
# Prerequisite: scripts/pbk30-stack.sh create. Every step first runs the
# fixture guard; the app listens on 127.0.0.1:3130. The build writes .next, so
# do not run this next to a dev server from the same checkout.
# Artifacts (screens, JSON results, server logs) go to $PBK30_ARTIFACTS.
set -euo pipefail
cd "$(dirname "$0")/.."

export PBK30_ARTIFACTS=${PBK30_ARTIFACTS:-"$PWD/.pbk30"}
export PBK30_RUN_ID=${PBK30_RUN_ID:-"run$(date +%s)"}
mkdir -p "$PBK30_ARTIFACTS"

load_env() {
  # Refuses (exit 3) unless the marked fixture stack is the one running.
  eval "$(scripts/pbk30-stack.sh env)"
  node scripts/pbk30-fixture-guard.mjs --target "$NEXT_PUBLIC_SUPABASE_URL"
  # Production mode with real auth: never the dev-mode bypass.
  unset NEXT_PUBLIC_DEVELOPMENT
  export NODE_ENV=production
}

app_up() { curl -s -o /dev/null "http://127.0.0.1:${PBK30_APP_PORT:-3130}/auth"; }

stop_server() {
  if [ -f "$PBK30_ARTIFACTS/next.pid" ]; then
    # The server runs in its own process group (setsid): stop npx and next.
    kill -- -"$(cat "$PBK30_ARTIFACTS/next.pid")" 2>/dev/null || true
    rm -f "$PBK30_ARTIFACTS/next.pid"
  fi
  for _ in $(seq 1 50); do
    app_up || return 0
    sleep 0.2
  done
  echo "something still answers on :${PBK30_APP_PORT:-3130}" >&2
  exit 1
}

start_server() {
  local mode=$1 log="$PBK30_ARTIFACTS/next-$2.log"
  setsid npx next "$mode" -H 127.0.0.1 -p "$PBK30_APP_PORT" > "$log" 2>&1 &
  echo $! > "$PBK30_ARTIFACTS/next.pid"
  for _ in $(seq 1 240); do
    app_up && return 0
    sleep 0.5
  done
  echo "Next server did not start; see $log" >&2
  exit 1
}

run_phase() {
  PBK30_PHASE=$1 npx playwright test -c playwright.local-supabase.config.ts
}

containers() {
  docker ps --filter label=com.supabase.cli.project=pbk30-fixture --format '{{.Names}} {{.ID}} {{.Status}}' | sort
}

step_build() { load_env; npx next build > "$PBK30_ARTIFACTS/next-build.log" 2>&1; }
step_before() { load_env; stop_server; start_server start before; run_phase before-restart; }
step_restart() {
  local out="$PBK30_ARTIFACTS/restart.txt"
  { echo "== before restart $(date -u +%FT%TZ)"; containers; } > "$out"
  stop_server
  scripts/pbk30-stack.sh stop          # keeps the fixture's volumes
  { echo "== after stop"; containers; } >> "$out"
  scripts/pbk30-stack.sh start         # re-checks guard + migration versions
  { echo "== after start $(date -u +%FT%TZ)"; containers; } >> "$out"
  load_env
  start_server start after
}
step_after() { load_env; run_phase after-restart; stop_server; }
step_devmode() {
  load_env
  node scripts/pbk30-fixture-guard.mjs --destructive --target "$NEXT_PUBLIC_SUPABASE_URL"
  stop_server
  export NODE_ENV=development NEXT_PUBLIC_DEVELOPMENT=true
  start_server dev devmode
  run_phase dev-mode
  stop_server
}

case "${1:-all}" in
  build) step_build ;;
  before) step_before ;;
  restart) step_restart ;;
  after) step_after ;;
  devmode) step_devmode ;;
  all)
    trap stop_server EXIT
    step_build
    step_before
    step_restart
    step_after
    step_devmode ;;
  *) sed -n '2,22p' "$0"; exit 64 ;;
esac
