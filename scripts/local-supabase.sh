#!/usr/bin/env bash
# Local Supabase stack for everyday development (project "properbooky").
# Non-destructive: nothing here deletes containers' data volumes. The
# disposable stack for the PBK-30 runtime suite is scripts/pbk30-stack.sh.
#
# Applied migrations 20240324/20240325/20240329 create indexes and a trigger on
# storage.objects. Supabase stopped allowing that for the `postgres` role on
# 21 April 2025 (supabase/postgres 15.8.1.084 and later), so a NEW stack on
# current images aborts with "must be owner of table objects". For a new stack
# this script pins the last pre-restriction image (15.8.1.069) through
# supabase/.temp/postgres-version, which Supabase CLI 2.33.9 reads to choose
# the database image (pkg/config/config.go; workaround described in
# https://github.com/orgs/supabase/discussions/34270). An EXISTING stack keeps
# whatever image and data it already has.
#
# Usage: scripts/local-supabase.sh <start|stop|status|env>
#   start   start the stack (pins the image only when creating it)
#   stop    stop containers, keeping data
#   status  read-only: database image and applied migration versions
#   env     write .env.development.local (gitignored) for the local stack
#
# Environment:
#   SUPABASE_CLI     CLI command (default: npx --yes supabase@2.33.9)
#   SUPABASE_EXCLUDE containers to skip (default: services the web app does not use)
set -euo pipefail

cd "$(dirname "$0")/.."

ID="properbooky"
PINNED_POSTGRES="15.8.1.069"
CLI=${SUPABASE_CLI:-"npx --yes supabase@2.33.9"}
EXCLUDE=${SUPABASE_EXCLUDE:-"studio,imgproxy,vector,logflare,edge-runtime,supavisor"}

local_only() {
  # Refuse to run against anything but the local stack.
  if [ -f supabase/.temp/project-ref ]; then
    echo "supabase/.temp/project-ref exists (a remote project is linked)." >&2
    echo "This script only manages the local stack; unlink first (supabase unlink)." >&2
    exit 2
  fi
}

pin_if_new() {
  if docker volume ls -q --filter "label=com.supabase.cli.project=$ID" | grep -q .; then
    echo "existing $ID stack found: keeping its database image and data (no pin change)"
  else
    mkdir -p supabase/.temp
    printf '%s' "$PINNED_POSTGRES" > supabase/.temp/postgres-version
    echo "new $ID stack: pinned supabase/postgres:$PINNED_POSTGRES"
  fi
}

status() {
  # Read-only report; differences are warnings, never repairs.
  local image expected applied
  image=$(docker inspect "supabase_db_$ID" --format '{{.Config.Image}}')
  echo "database image: $image ($(docker image inspect "$image" --format '{{.Id}}'))"
  expected=$(for f in supabase/migrations/*.sql; do basename "$f" .sql | sed -E 's/^([0-9]+)_(.*)$/\1|\2/'; done)
  applied=$(docker exec "supabase_db_$ID" psql -U postgres -d postgres -Atc \
    "select version || '|' || name from supabase_migrations.schema_migrations order by version")
  if [ "$expected" = "$applied" ]; then
    echo "migrations: all $(echo "$applied" | wc -l) repository versions applied, in order"
  else
    echo "WARNING: applied migration versions differ from supabase/migrations:" >&2
    diff <(echo "$expected") <(echo "$applied") >&2 || true
  fi
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
    local_only
    pin_if_new
    $CLI start -x "$EXCLUDE"
    status ;;
  stop) $CLI stop --project-id "$ID" ;;
  status) status ;;
  env) write_env ;;
  *) sed -n '2,25p' "$0"; exit 64 ;;
esac
