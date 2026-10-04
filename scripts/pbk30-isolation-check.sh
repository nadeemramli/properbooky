#!/usr/bin/env bash
# Live proof that PBK-30's destructive steps cannot reach the ordinary
# development stack (project "properbooky"). Read-only against that stack.
#
#   scripts/pbk30-isolation-check.sh fingerprint <file>
#       record a read-only fingerprint of the ordinary stack: row counts and
#       md5 over ids/timestamps of auth.users, books, highlights and
#       storage.objects, plus its volume names and creation times
#   scripts/pbk30-isolation-check.sh negatives-before-create
#   scripts/pbk30-isolation-check.sh negatives-with-fixture
#       attempt destructive operations against wrong targets; each must exit
#       non-zero before acting. Results: $PBK30_ARTIFACTS/isolation-*.tsv
#
# Run fingerprint before and after the fixture run and compare the files.
# Do it while the development stack is idle.
set -uo pipefail
cd "$(dirname "$0")/.."

ORD="properbooky"
ART=${PBK30_ARTIFACTS:-"$PWD/.pbk30"}
mkdir -p "$ART"
CLI=${SUPABASE_CLI:-"npx --yes supabase@2.33.9"}

fingerprint() {
  local out=$1
  {
    echo "# ordinary stack fingerprint $(date -u +%FT%TZ)"
    docker volume ls -q --filter "label=com.supabase.cli.project=$ORD" | sort |
      xargs -r docker volume inspect -f '{{.Name}} {{.CreatedAt}}'
    docker exec "supabase_db_$ORD" psql -U postgres -d postgres -At -c "
      select 'auth.users', count(*), md5(coalesce(string_agg(id::text || email || coalesce(updated_at::text,''), ',' order by id), '')) from auth.users
      union all select 'public.books', count(*), md5(coalesce(string_agg(id::text || coalesce(updated_at::text,''), ',' order by id), '')) from public.books
      union all select 'public.highlights', count(*), md5(coalesce(string_agg(id::text || coalesce(updated_at::text,''), ',' order by id), '')) from public.highlights
      union all select 'storage.objects', count(*), md5(coalesce(string_agg(id::text || coalesce(updated_at::text,''), ',' order by id), '')) from storage.objects"
  } > "$out"
  cat "$out"
}

RESULTS=""
expect_refusal() {
  # expect_refusal <label> <command...>: passes only on a non-zero exit.
  local label=$1; shift
  local log="$ART/isolation-$label.log" code
  "$@" > "$log" 2>&1
  code=$?
  if [ "$code" -ne 0 ]; then
    printf '%s\trefused\texit=%s\n' "$label" "$code" >> "$RESULTS"
    echo "ok   $label refused (exit $code)"
  else
    printf '%s\tNOT REFUSED\texit=0\n' "$label" >> "$RESULTS"
    echo "FAIL $label was not refused; see $log"
    FAILED=1
  fi
}

ord_env() {
  local vars
  vars=$($CLI status -o env)
  get() { printf '%s\n' "$vars" | sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}$/\1/p"; }
  ORD_URL=$(get API_URL); ORD_SERVICE=$(get SERVICE_ROLE_KEY); ORD_ANON=$(get ANON_KEY)
}

FAILED=0
case "${1:-}" in
  fingerprint) fingerprint "${2:?file}" ;;

  negatives-before-create)
    RESULTS="$ART/isolation-before-create.tsv"; : > "$RESULTS"
    ord_env
    empty=$(mktemp -d)
    # 1. No fixture marker anywhere: destroy must refuse.
    expect_refusal destroy-without-marker env PBK30_STACK_DIR="$empty" PBK30_DISPOSABLE=1 scripts/pbk30-stack.sh destroy
    # 2. A forged marker for the ordinary project, with the ordinary config.
    forged=$(mktemp -d); mkdir -p "$forged/supabase"; cp supabase/config.toml "$forged/supabase/"
    printf '{"project_id":"%s","nonce":"%s","api_url":"%s"}\n' "$ORD" "$(printf 'f%.0s' $(seq 48))" "$ORD_URL" > "$forged/marker.json"
    expect_refusal guard-forged-ordinary-marker env PBK30_STACK_DIR="$forged" PBK30_DISPOSABLE=1 node scripts/pbk30-fixture-guard.mjs --destructive --target "$ORD_URL"
    expect_refusal destroy-forged-ordinary-marker env PBK30_STACK_DIR="$forged" PBK30_DISPOSABLE=1 scripts/pbk30-stack.sh destroy
    # 3. An unmarked leftover for the fixture project id: create must not adopt it.
    docker volume create --label com.supabase.cli.project=pbk30-fixture pbk30-isolation-probe > /dev/null
    expect_refusal create-with-unmarked-leftover env PBK30_STACK_DIR="$empty" scripts/pbk30-stack.sh create
    docker volume rm pbk30-isolation-probe > /dev/null
    rm -rf "$empty" "$forged" ;;

  negatives-with-fixture)
    RESULTS="$ART/isolation-with-fixture.tsv"; : > "$RESULTS"
    ord_env
    # 4. The real marker, but the ordinary API as target.
    expect_refusal guard-fixture-marker-ordinary-target env PBK30_DISPOSABLE=1 node scripts/pbk30-fixture-guard.mjs --destructive --target "$ORD_URL"
    # 5. A copy of the real marker with a nonce the fixture DB does not hold.
    copy=$(mktemp -d); cp -R .pbk30-stack/supabase "$copy/"
    sed -E 's/"nonce": "[0-9a-f]+"/"nonce": "'"$(printf '0%.0s' $(seq 48))"'"/' .pbk30-stack/marker.json > "$copy/marker.json"
    expect_refusal guard-wrong-nonce env PBK30_STACK_DIR="$copy" PBK30_DISPOSABLE=1 node scripts/pbk30-fixture-guard.mjs --destructive --target http://127.0.0.1:55421
    expect_refusal destroy-wrong-nonce env PBK30_STACK_DIR="$copy" PBK30_DISPOSABLE=1 scripts/pbk30-stack.sh destroy
    rm -rf "$copy"
    # 6. Destructive without explicit intent.
    expect_refusal destroy-without-disposable env -u PBK30_DISPOSABLE scripts/pbk30-stack.sh destroy
    # 7. The dev-mode spec (deletes the dev account) aimed at the ordinary stack.
    expect_refusal devmode-spec-on-ordinary-stack env PBK30_PHASE=dev-mode PBK30_DISPOSABLE=1 \
      NEXT_PUBLIC_SUPABASE_URL="$ORD_URL" NEXT_PUBLIC_SUPABASE_ANON_KEY="$ORD_ANON" SUPABASE_SERVICE_ROLE_KEY="$ORD_SERVICE" \
      PBK30_ARTIFACTS="$ART/isolation-devmode" npx playwright test -c playwright.local-supabase.config.ts ;;

  *) sed -n '2,18p' "$0"; exit 64 ;;
esac
exit $FAILED
