#!/usr/bin/env bash
# Disposable Supabase stack for the PBK-30 runtime suite, separate from the
# ordinary development stack (project "properbooky", ports 543xx).
#
#   scripts/pbk30-stack.sh create    new fixture stack + marker (refuses if one exists)
#   scripts/pbk30-stack.sh start     start an existing, marked fixture stack
#   scripts/pbk30-stack.sh stop      stop it, keeping its volumes
#   scripts/pbk30-stack.sh status    guard + exact migration versions + image identity
#   scripts/pbk30-stack.sh env       print the fixture's connection exports
#   PBK30_DISPOSABLE=1 scripts/pbk30-stack.sh destroy
#                                    drop the fixture's volumes and workdir
#
# Isolation: project id "pbk30-fixture" (containers/volumes
# supabase_*_pbk30-fixture), its own workdir (.pbk30-stack/, gitignored),
# ports 554xx and app port 3130. At creation a random nonce is stored in the
# fixture database and in .pbk30-stack/marker.json; every destructive step
# runs scripts/pbk30-fixture-guard.mjs, which refuses any target that is not
# that exact marked stack. Nothing here touches the "properbooky" project.
set -euo pipefail
cd "$(dirname "$0")/.."

ID="pbk30-fixture"
DIR="${PBK30_STACK_DIR:-$PWD/.pbk30-stack}"
CLI=${SUPABASE_CLI:-"npx --yes supabase@2.33.9"}
PINNED_POSTGRES="15.8.1.069"
EXCLUDE=${SUPABASE_EXCLUDE:-"studio,imgproxy,vector,logflare,edge-runtime,supavisor"}
APP_PORT=3130
API_URL="http://127.0.0.1:55421"
MAILPIT_URL="http://127.0.0.1:55424"
# Always check against this fixture's own API, never an inherited
# NEXT_PUBLIC_SUPABASE_URL (CI sets a placeholder workflow-wide).
GUARD="node scripts/pbk30-fixture-guard.mjs --target $API_URL"
export PBK30_STACK_DIR="$DIR"

die() { echo "pbk30-stack: $*" >&2; exit 3; }

leftovers() {
  { docker ps -a --filter "label=com.supabase.cli.project=$ID" --format '{{.Names}}'
    docker volume ls --filter "label=com.supabase.cli.project=$ID" --format '{{.Name}}'; } | sort -u
}

generate_workdir() {
  mkdir -p "$DIR/supabase/.temp"
  # Same settings as the development config, but its own project id, ports
  # 543xx -> 554xx and the app on :3130.
  sed -E \
    -e "s/^project_id = .*/project_id = \"$ID\"/" \
    -e 's/^(\s*(shadow_)?port = )543([0-9]{2})$/\1554\3/' \
    -e "s#127\\.0\\.0\\.1:3000#127.0.0.1:$APP_PORT#g; s#localhost:3000#localhost:$APP_PORT#g" \
    supabase/config.toml > "$DIR/supabase/config.toml"
  cp -R supabase/migrations "$DIR/supabase/migrations"
  cp supabase/seed.sql "$DIR/supabase/seed.sql"
  printf '%s' "$PINNED_POSTGRES" > "$DIR/supabase/.temp/postgres-version"
  grep -q "^project_id = \"$ID\"" "$DIR/supabase/config.toml" || die "generated config lacks project_id $ID"
  if grep -Eq '^[^#]*(port = 543|:3000)' "$DIR/supabase/config.toml"; then die "generated config still uses development ports"; fi
}

psql_fixture() { docker exec -i "supabase_db_$ID" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -Atq "$@"; }

expected_migrations() {
  for f in supabase/migrations/*.sql; do basename "$f" .sql | sed -E 's/^([0-9]+)_(.*)$/\1|\2/'; done
}

verify() {
  local expected applied image digest
  expected=$(expected_migrations)
  applied=$(psql_fixture -c "select version || '|' || name from supabase_migrations.schema_migrations order by version")
  if [ "$expected" != "$applied" ]; then
    diff <(echo "$expected") <(echo "$applied") >&2 || true
    die "applied migration versions differ from supabase/migrations"
  fi
  image=$(docker inspect "supabase_db_$ID" --format '{{.Config.Image}}')
  digest=$(docker image inspect "$image" --format '{{.Id}} {{join .RepoDigests ","}}')
  case "$image" in *":$PINNED_POSTGRES") ;; *) die "database image $image is not the pinned $PINNED_POSTGRES" ;; esac
  {
    echo "project_id=$ID"
    echo "database_image=$image"
    echo "image_id_and_digests=$digest"
    echo "migrations_applied=$(echo "$applied" | wc -l)"
    echo "$applied" | sed 's/^/migration=/'
  } | tee "$DIR/identity.txt"
}

case "${1:-}" in
  create)
    [ -e "$DIR/marker.json" ] && die "fixture already exists at $DIR (use start, or destroy it first)"
    [ -n "$(leftovers)" ] && die "found unmarked containers/volumes for $ID; refusing to adopt them:
$(leftovers)
Inspect and remove them yourself (docker rm/volume rm) if they are yours."
    if [ -d "$DIR" ] && [ -n "$(ls -A "$DIR")" ]; then
      die "$DIR exists without a marker; refusing to reuse or delete it (remove it yourself)"
    fi
    generate_workdir
    $CLI --workdir "$DIR" start -x "$EXCLUDE"
    nonce=$(od -An -tx1 -N24 /dev/urandom | tr -d ' \n')
    psql_fixture <<SQL
create schema pbk30_fixture;
revoke all on schema pbk30_fixture from public;
create table pbk30_fixture.marker (nonce text primary key, created_at timestamptz not null default now());
insert into pbk30_fixture.marker (nonce) values ('$nonce');
SQL
    cat > "$DIR/marker.json" <<JSON
{
  "project_id": "$ID",
  "nonce": "$nonce",
  "api_url": "$API_URL",
  "mailpit_url": "$MAILPIT_URL",
  "app_url": "http://127.0.0.1:$APP_PORT",
  "created_at": "$(date -u +%FT%TZ)",
  "source_commit": "$(git rev-parse HEAD)"
}
JSON
    $GUARD
    verify ;;
  start)
    [ -f "$DIR/marker.json" ] || die "no fixture marker at $DIR; run create"
    grep -q "^project_id = \"$ID\"" "$DIR/supabase/config.toml" || die "fixture workdir config is not $ID"
    $CLI --workdir "$DIR" start -x "$EXCLUDE"
    $GUARD
    verify ;;
  stop)
    [ -f "$DIR/marker.json" ] || die "no fixture marker at $DIR"
    $CLI --workdir "$DIR" stop --project-id "$ID" ;;
  status)
    $GUARD
    verify ;;
  env)
    $GUARD >&2
    vars=$($CLI --workdir "$DIR" status -o env)
    get() { printf '%s\n' "$vars" | sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}$/\1/p"; }
    [ "$(get API_URL)" = "$API_URL" ] || die "fixture API is $(get API_URL), expected $API_URL"
    echo "export NEXT_PUBLIC_SUPABASE_URL='$API_URL'"
    echo "export NEXT_PUBLIC_SUPABASE_ANON_KEY='$(get ANON_KEY)'"
    echo "export SUPABASE_SERVICE_ROLE_KEY='$(get SERVICE_ROLE_KEY)'"
    echo "export MAILPIT_URL='$MAILPIT_URL'"
    echo "export PBK30_APP_URL='http://127.0.0.1:$APP_PORT'"
    echo "export PBK30_APP_PORT='$APP_PORT'" ;;
  destroy)
    # Proves this is the marked fixture before deleting anything; the CLI
    # call names the project explicitly (an empty id would match them all).
    $GUARD --destructive
    $CLI --workdir "$DIR" stop --no-backup --project-id "$ID"
    # Remove only what generate_workdir/create wrote.
    rm -rf "$DIR/supabase"
    rm -f "$DIR/marker.json" "$DIR/identity.txt"
    rmdir "$DIR" 2>/dev/null || echo "kept $DIR (contains other files)" ;;
  *) sed -n '2,20p' "$0"; exit 64 ;;
esac
