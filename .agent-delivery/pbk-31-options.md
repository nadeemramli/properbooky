# PBK-31 evidence and options (decision pending — owner)

Evidence gathered read-only at `origin/main` 9c850168b35c2545bbe7ba88fac27f908960366d. Nothing was deleted or changed.

## What the issue says vs. what the code shows

| Claim in PBK-31 | Finding |
|---|---|
| `/api/update-stats` called from nowhere | **Confirmed.** No caller in `app/`, `lib/`, `components/`, `desktop/`. It invokes edge functions `update-reading-stats`, `update-challenges`, `update-missions`. |
| Edge functions never called | **Confirmed** for all five (`calculate-priority`, `obsidian-sync` have no caller either). |
| `types/guards.ts` weak guards | File is actually `supabase/functions/types/guards.ts`, imported only by the five edge functions. |
| `reading_sessions` / `reading_activities` dropped, never recreated | **Confirmed**: created in `20240204000000_add_user_features.sql`, dropped in `20240321000000_fix_stats_cleanup.sql` (also `reading_statistics`). |
| "Unreachable so it's harmless today" | **Not entirely.** The web Dashboard (`app/(main)/page.tsx`, route `/`) renders `ActivityFeed` (queries `reading_activities`, dropped) and `ReadingStats` (queries `reading_statistics`, dropped). `MissionBoard`/`GoalsChallenges` query `missions`/`challenges`, which still exist. So two dashboard widgets error at runtime on every visit to `/` (runtime confirmation pending a local stack run). `lib/database.types.ts` still types the dropped tables. |
| Build coupling | `npm run build` runs `build:edge` (edge functions tsc + `supabase functions build`) before `next build`; CI sidesteps via `npx next build` + separate edge typecheck. |

## Options

**A. Delete the server half, keep a working dashboard (recommended for the current release).**
Remove `app/api/update-stats`, the five edge functions, `supabase/functions/types/guards.ts`, and the `build:edge` step; replace `ActivityFeed`/`ReadingStats` with an honest empty state (or remove them from `/`). No migration needed; regenerate types later with PBK-5. Low risk, reversible via git. Aligns with the desktop local-first direction where reading stats would come from sidecars, not Postgres.

**B. Delete everything including mission/challenge widgets.** Also drop `MissionBoard`/`GoalsChallenges` and (in a new migration) `missions`/`challenges`. Larger blast radius and a schema change; only if gamification is explicitly out of the product.

**C. Revive.** New migration recreating `reading_sessions`/`reading_activities`/`reading_statistics` with RLS, forward the caller's `Authorization` header from `/api/update-stats` (stop sending the service-role key as a user JWT), fix `minutes_read` / `highlights.count` references, tighten guards, add a real caller (reader session end) and tests. Several days of work for a web surface that is not the release's primary journey.

**Minimum fix regardless of decision** (could ride PBK-30 if it reproduces): stop the `/` dashboard from querying dropped relations, because it is a visible error on a reachable page.

Owner question: is reading-stats/gamification part of the near-term Reader/Readwise direction? A/B = no, C = yes.
