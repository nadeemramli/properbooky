#!/usr/bin/env bash
# PBK-30 runtime verification against the isolated local Supabase stack.
#
#   scripts/pbk30-verify.sh [all|build|before|restart|after]
#
# all     = build, before, restart, after, devmode (default)
# build   = `next build` in production mode against the local stack
# before  = criteria 2-4 (and the state criterion 5 re-checks) through the UI
# restart = stop the Next server and the Supabase containers WITHOUT resetting
#           data, then start both again
# after   = criterion 5: re-check metadata, annotations, recommendations,
#           uploaded files and CSV rows after the restart
# devmode  = `next dev` with the dev-mode sign-in: identity + provisioning
#           (runs last: next dev rewrites .next)
#
# Prerequisite: scripts/local-supabase.sh start (or reset for a clean stack).
# Artifacts (screens, JSON results, server logs) go to $PBK30_ARTIFACTS.
set -euo pipefail
cd "$(dirname "$0")/.."

export PBK30_ARTIFACTS=${PBK30_ARTIFACTS:-"$PWD/test-results/pbk30"}
export PBK30_RUN_ID=${PBK30_RUN_ID:-"run$(date +%s)"}
CLI=${SUPABASE_CLI:-"npx --yes supabase@2.33.9"}
mkdir -p "$PBK30_ARTIFACTS"

load_env() {
  local vars
  vars=$($CLI status -o env)
  get() { printf '%s\n' "$vars" | sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}$/\1/p"; }
  export NEXT_PUBLIC_SUPABASE_URL; NEXT_PUBLIC_SUPABASE_URL=$(get API_URL)
  export NEXT_PUBLIC_SUPABASE_ANON_KEY; NEXT_PUBLIC_SUPABASE_ANON_KEY=$(get ANON_KEY)
  export SUPABASE_SERVICE_ROLE_KEY; SUPABASE_SERVICE_ROLE_KEY=$(get SERVICE_ROLE_KEY)
  case "$NEXT_PUBLIC_SUPABASE_URL" in
    http://127.0.0.1:*|http://localhost:*) ;;
    *) echo "refusing: Supabase API is not local ($NEXT_PUBLIC_SUPABASE_URL)" >&2; exit 2 ;;
  esac
  # Production mode with real auth: never the dev-mode bypass.
  unset NEXT_PUBLIC_DEVELOPMENT
  export NODE_ENV=production
}

stop_server() {
  if [ -f "$PBK30_ARTIFACTS/next.pid" ]; then
    # The server runs in its own process group (setsid): stop npx and next.
    kill -- -"$(cat "$PBK30_ARTIFACTS/next.pid")" 2>/dev/null || true
    rm -f "$PBK30_ARTIFACTS/next.pid"
  fi
  for _ in $(seq 1 50); do
    curl -s -o /dev/null http://127.0.0.1:3000/auth || return 0
    sleep 0.2
  done
  echo "Next server still answering on :3000" >&2
  exit 1
}

start_server() {
  local log="$PBK30_ARTIFACTS/next-$1.log"
  setsid npx next start -H 127.0.0.1 -p 3000 > "$log" 2>&1 &
  echo $! > "$PBK30_ARTIFACTS/next.pid"
  for _ in $(seq 1 120); do
    curl -s -o /dev/null http://127.0.0.1:3000/auth && return 0
    sleep 0.5
  done
  echo "Next server did not start; see $log" >&2
  exit 1
}

run_phase() {
  PBK30_PHASE=$1 npx playwright test -c playwright.local-supabase.config.ts
}

step_build() { load_env; npx next build > "$PBK30_ARTIFACTS/next-build.log" 2>&1; }
step_before() { load_env; stop_server; start_server before; run_phase before-restart; }
containers() {
  docker ps --filter name=_properbooky --format '{{.Names}} {{.ID}} {{.Status}}' | sort
}

step_restart() {
  local out="$PBK30_ARTIFACTS/restart.txt"
  { echo "== before restart $(date -u +%FT%TZ)"; containers; } > "$out"
  stop_server
  $CLI stop            # removes containers, keeps the database and storage volumes
  { echo "== after stop"; containers; } >> "$out"
  scripts/local-supabase.sh start
  { echo "== after start $(date -u +%FT%TZ)"; containers; } >> "$out"
  load_env
  start_server after
}
step_after() { load_env; run_phase after-restart; stop_server; }
step_devmode() {
  load_env
  stop_server
  export NODE_ENV=development NEXT_PUBLIC_DEVELOPMENT=true
  setsid npx next dev -H 127.0.0.1 -p 3000 > "$PBK30_ARTIFACTS/next-devmode.log" 2>&1 &
  echo $! > "$PBK30_ARTIFACTS/next.pid"
  for _ in $(seq 1 240); do
    curl -s -o /dev/null http://127.0.0.1:3000/auth && break
    sleep 0.5
  done
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
  *) sed -n '2,19p' "$0"; exit 64 ;;
esac
