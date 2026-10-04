# Local Supabase stack

The remote project stays paused (decision 2026-07-12). Development and the PBK-30 runtime suite use a local stack started from `supabase/config.toml` with every migration in `supabase/migrations/`.

## Start, reset, connect

```bash
scripts/local-supabase.sh start   # pin the database image, start, verify 14/14 migrations
scripts/local-supabase.sh env     # write .env.development.local (gitignored) for npm run dev
scripts/local-supabase.sh reset   # destroy the LOCAL volumes and start from scratch
scripts/local-supabase.sh stop    # stop containers, keep data
```

The script uses Supabase CLI 2.33.9 (`npx supabase@2.33.9`; override with `SUPABASE_CLI`) and refuses to run while a remote project is linked (`supabase/.temp/project-ref`). Services the web app does not use are skipped (`SUPABASE_EXCLUDE`).

## Why the database image is pinned

Migrations `20240324000000_add_storage_bucket`, `20240325000000_enhance_storage_security` and `20240329000000_setup_default_books` create indexes and an `updated_at` trigger on `storage.objects`. On 21 April 2025 Supabase stopped letting the `postgres` role create indexes on, or otherwise alter, tables in the `auth`, `storage` and `realtime` schemas. Local images `supabase/postgres:15.8.1.084` and later enforce this, so a fresh `supabase start` aborts at `20240324` with `must be owner of table objects`.

These migrations were applied to the remote project before the restriction and must not be edited. The script writes `15.8.1.069`, the last pre-restriction image, to `supabase/.temp/postgres-version`. That is the file the CLI uses to pin the database version, normally written by `supabase link`. This is the local workaround Supabase describes in [discussion 34270](https://github.com/orgs/supabase/discussions/34270). In that image `postgres` is a member of `supabase_storage_admin`, which is how the historical statements succeed. No grants or ownership are changed.

Revisit this when the project moves to a newer local image. Squashing a baseline migration, or a coordinator-approved privilege-tolerant edit of the three migrations, would remove the pin.

## Local auth settings

- Email sign-up requires confirmation, as on hosted projects. Mail is captured by Mailpit at <http://127.0.0.1:54324>.
- Redirects allow `http://127.0.0.1:3000/**` and `http://localhost:3000/**`.
- The email rate limit is raised for repeated local runs.
- `supabase/seed.sql` creates the confirmed dev-mode account `dev@properbooky.com` with id `FLAGS.DEV_USER_ID`. Dev mode always uses the signed-in session's real id, so a dev account with a different id also works.

## PBK-30 runtime suite

```bash
scripts/local-supabase.sh reset
PBK30_DISPOSABLE=1 scripts/pbk30-verify.sh all
```

The suite builds the app in production mode against the local stack, because `next dev` forces the dev-mode auth bypass. It then runs `e2e/local-supabase/c2-c4`, stops the server and the containers while keeping the volumes, starts both again, runs `c5`, and finally runs the dev-mode check under `next dev`. Evidence goes to `.pbk30/` (or `PBK30_ARTIFACTS`).

`PBK30_DISPOSABLE=1` lets the dev-mode check delete and recreate the dev account, which cascades to its books, so only set it on a disposable stack. CI runs the same sequence in the `web-local-supabase` job.

Hosts that cannot pull from `public.ecr.aws` can set `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io`.
