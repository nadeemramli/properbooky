# Local Supabase stacks

The remote project stays paused (decision 2026-07-12). There are two local stacks, and they never share containers, volumes, ports or a workdir:

| | Development stack | PBK-30 fixture stack |
|---|---|---|
| Script | `scripts/local-supabase.sh` | `scripts/pbk30-stack.sh` |
| Project id (containers/volumes `supabase_*_<id>`) | `properbooky` | `pbk30-fixture` |
| Workdir | `supabase/` | `.pbk30-stack/` (generated, gitignored) |
| Ports | API 54321, DB 54322, Mailpit 54324 | API 55421, DB 55422, Mailpit 55424; app 3130 |
| Destructive commands | none | `destroy` only, behind the fixture guard |

## Development stack (non-destructive)

```bash
scripts/local-supabase.sh start    # start; pins the database image only when creating a new stack
scripts/local-supabase.sh status   # read-only: database image + applied migration versions
scripts/local-supabase.sh env      # write .env.development.local (gitignored) for npm run dev
scripts/local-supabase.sh stop     # stop containers, keep data
```

The script never deletes volumes and refuses to run while a remote project is linked (`supabase/.temp/project-ref`). An existing stack keeps its image and data.

### Why a new stack's database image is pinned

Migrations `20240324000000_add_storage_bucket`, `20240325000000_enhance_storage_security` and `20240329000000_setup_default_books` create indexes and an `updated_at` trigger on `storage.objects`. On 21 April 2025 Supabase restricted the `postgres` role in the `auth`, `storage` and `realtime` schemas, including creating indexes on their existing tables ([discussion 34270](https://github.com/orgs/supabase/discussions/34270)). Local images `supabase/postgres:15.8.1.084` and later enforce this, so a new stack on current images aborts at `20240324` with `must be owner of table objects`.

These migrations were applied to the remote project before the restriction and are not edited. For a new stack, the script writes `15.8.1.069`, the pre-restriction image that discussion names, to `supabase/.temp/postgres-version`. Supabase CLI 2.33.9 reads that file to choose the database image tag (`pkg/config/config.go`, `builder.PostgresVersionPath`). In that image `postgres` is a member of `supabase_storage_admin`, so the historical statements succeed without grants or ownership changes.

An existing development stack is left exactly as it is. Do not reset your own data to adopt the pin. `status` reports the image and whether every repository migration version is applied, and differences are only warnings. Removing the pin for good (a squashed baseline, or a coordinator-approved privilege-tolerant edit of the three migrations) is a separate decision.

## PBK-30 fixture stack (disposable)

```bash
scripts/pbk30-stack.sh create                      # new stack + marker; refuses if one exists or leftovers are found
PBK30_DISPOSABLE=1 scripts/pbk30-verify.sh all     # criteria 2-4, restart, criterion 5, dev mode
PBK30_DISPOSABLE=1 scripts/pbk30-stack.sh destroy  # drop the fixture's volumes and workdir
```

`create` generates `.pbk30-stack/supabase/config.toml` from the development config, with project id `pbk30-fixture` and ports 543xx moved to 554xx. It copies the migrations and seed, pins the image, starts the stack, and checks the applied migration versions and names exactly. It then writes a random nonce both into the fixture database (`pbk30_fixture.marker`) and into `.pbk30-stack/marker.json`.

`scripts/pbk30-fixture-guard.mjs` runs before every PBK-30 step. That covers the Playwright global setup, every admin (service-role) client, the dev-account deletion, `pbk30-verify.sh` and `destroy`. It refuses unless all of these hold:

- the marker exists and names `pbk30-fixture`, never `properbooky`;
- the workdir config has the same project id;
- `supabase_db_pbk30-fixture` is running with the CLI's project label for it;
- that database holds the marker's nonce;
- the Supabase URL in use is the fixture API, published by the fixture's own gateway.

Destructive steps additionally need `PBK30_DISPOSABLE=1`. `destroy` passes the project id to `supabase stop --no-backup` explicitly, because an empty id would match every local project's volumes. `create` will not adopt unmarked containers or volumes.

The suite builds the app into `.next` and serves it on 127.0.0.1:3130. Don't run it next to a dev server from the same checkout. Evidence goes to `.pbk30/` (or `PBK30_ARTIFACTS`).

### Proving isolation

```bash
node --test scripts/pbk30-fixture-guard.test.mjs          # wrong targets refused (no Docker needed)
scripts/pbk30-isolation-check.sh fingerprint before.txt   # read-only fingerprint of the development stack
scripts/pbk30-isolation-check.sh negatives-before-create  # destroy/create against wrong targets must fail
scripts/pbk30-isolation-check.sh negatives-with-fixture   # ordinary target, forged nonce, no intent, dev-mode spec
scripts/pbk30-isolation-check.sh fingerprint after.txt    # compare with before.txt
```

The fingerprint is read-only: volume names and creation times, plus counts and hashes of `auth.users`, `books`, `highlights` and `storage.objects`. Run it while the development stack is idle. CI runs this whole sequence with a development stack beside the fixture.

## Local auth settings (both stacks)

- Email sign-up requires confirmation, as on hosted projects. Mail is captured by Mailpit.
- Redirects allow the app's own origin (`127.0.0.1` / `localhost`, port 3000 for development and 3130 for the fixture).
- The local email rate limit is raised for repeated runs.
- `supabase/seed.sql` creates the confirmed dev-mode account `dev@properbooky.com` with id `FLAGS.DEV_USER_ID`. Dev mode always uses the signed-in session's real id.

Hosts that cannot pull from `public.ecr.aws` can set `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io`.
