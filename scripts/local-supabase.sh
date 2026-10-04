#!/usr/bin/env bash
# Reproducible local Supabase stack for development and the PBK-30 runtime suite.
#
# The repository's applied migrations 20240324/20240325/20240329 create indexes
# and a trigger on storage.objects. Supabase restricted that for the `postgres`
# role on 21 April 2025 (supabase/postgres 15.8.1.084 and later), so a fresh
# `supabase start` on current images aborts with "must be owner of table
# objects". The remote project applied these migrations before the restriction.
# Rather than editing applied migrations, pin the local database image to the
# last pre-restriction release, the workaround documented by Supabase in
# https://github.com/orgs/supabase/discussions/34270. The CLI reads the pin from
# supabase/.temp/postgres-version (gitignored; normally written by
# `supabase link`).
#
# Usage: scripts/local-supabase.sh <start|reset|stop|status|env>
#   start   pin the image, start the stack, verify every migration applied
#   reset   destroy local volumes (local stack only) and start from scratch
#   stop    stop containers, keeping data
#   status  show the stack status (no secrets printed)
#   env     write .env.development.local (gitignored) for the local stack
#
# Environment:
#   SUPABASE_CLI     CLI command (default: npx --yes supabase@2.33.9)
#   SUPABASE_EXCLUDE containers to skip (default: services the web app does not use)
set -euo pipefail

cd "$(dirname "$0")/.."

PINNED_POSTGRES="15.8.1.069"
CLI=${SUPABASE_CLI:-"npx --yes supabase@2.33.9"}
EXCLUDE=${SUPABASE_EXCLUDE:-"studio,imgproxy,vector,logflare,edge-runtime,supavisor"}

pin() {
  mkdir -p supabase/.temp
  printf '%s' "$PINNED_POSTGRES" > supabase/.temp/postgres-version
}

local_only() {
  # Refuse to run against anything but the local stack.
  if [ -f supabase/.temp/project-ref ]; then
    echo "supabase/.temp/project-ref exists (a remote project is linked)." >&2
    echo "This script only manages the local stack; unlink first (supabase unlink)." >&2
    exit 2
  fi
}

verify() {
  local expected applied image
  expected=$(find supabase/migrations -maxdepth 1 -name '*.sql' | wc -l)
  applied=$(docker exec supabase_db_properbooky psql -U postgres -d postgres -Atc \
    "select count(*) from supabase_migrations.schema_migrations")
  image=$(docker inspect supabase_db_properbooky --format '{{.Config.Image}}')
  echo "database image: $image"
  echo "migrations applied: $applied / $expected"
  case "$image" in
    *":$PINNED_POSTGRES") ;;
    *) echo "unexpected database image (want $PINNED_POSTGRES); run: $0 reset" >&2; exit 1 ;;
  esac
  [ "$applied" = "$expected" ] || { echo "not every migration applied" >&2; exit 1; }
}

write_env() {
  local vars
  vars=$($CLI status -o env)
  get() { printf '%s\n' "$vars" | sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}$/\1/p"; }
  local url anon service
  url=$(get API_URL); anon=$(get ANON_KEY); service=$(get SERVICE_ROLE_KEY)
  case "$url" in
    http://127.0.0.1:*|http://localhost:*) ;;
    *) echo "refusing to write env for non-local API URL" >&2; exit 1 ;;
  esac
  umask 077
  {
    echo "# Local Supabase stack (scripts/local-supabase.sh env). Standard local demo keys."
    echo "NEXT_PUBLIC_SUPABASE_URL=$url"
    echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=$anon"
    echo "SUPABASE_SERVICE_ROLE_KEY=$service"
  } > .env.development.local
  echo "wrote .env.development.local (gitignored)"
}

case "${1:-}" in
  start)
    local_only; pin
    $CLI start -x "$EXCLUDE"
    verify ;;
  reset)
    local_only
    $CLI stop --no-backup || true
    pin
    $CLI start -x "$EXCLUDE"
    verify ;;
  stop) $CLI stop ;;
  status) verify ;;
  env) write_env ;;
  *) sed -n '2,24p' "$0"; exit 64 ;;
esac
