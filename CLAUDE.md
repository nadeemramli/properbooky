# ProperBooky

Personal reading system: a Reader-by-Readwise-style app (library + EPUB/PDF reader + highlights) with Readwise-style sync capabilities (Obsidian export, local-first usage, mobile). Built for local/personal use first; Supabase provides auth + storage so login/sync can be enabled later.

See `AGENTS.md` for the development workflow (Linear, product vault, verification loop). Read it before shaping or picking up work.

## Commands

```bash
npm run dev              # Next.js dev server (localhost:3000)
npm run build            # builds Supabase edge functions, then next build
npm run build:edge       # compile supabase/functions only
npm run lint             # next lint (note: eslint.ignoreDuringBuilds is true in next.config.js)
npm run test             # Jest unit tests
npm run test:e2e         # Playwright E2E tests (e2e/)
npm run supabase:types   # regenerate lib/database.types.ts from the remote project
```

## Stack

- Next.js 13 App Router, React 18, TypeScript
- Supabase: auth (email/password + Google OAuth), Postgres with RLS, storage buckets, Deno edge functions (`supabase/functions/`)
- UI: Tailwind + shadcn/ui (`components/ui/`), Radix primitives
- Data: TanStack Query, react-hook-form + zod
- Books: `epubjs`/`react-reader` (EPUB), `pdfjs-dist`/`react-pdf` (PDF)

## Layout

- `app/(main)/library/` — library UI (grid/list, filters, tags) and `read/[bookId]/` reader route; reader components in `library/components/reader/`
- `app/auth/` — Supabase auth pages + OAuth callback route
- `app/api/` — route handlers (rate-limited via Upstash)
- `lib/supabase/` — client factories: `client.ts` (client components), `server.ts` (server components), `lib/supabase.ts` (plain client)
- `lib/hooks/` — `use-auth.ts`, `use-books.ts`, etc.
- `lib/config/` — `flags.ts` / `development.ts`: dev-mode config (auth bypass with a hardcoded dev user, auto-provisioned storage + default books)
- `supabase/migrations/` — SQL migrations (source of truth for schema)
- `types/` — hand-authored domain types

## Supabase

- Project: `properbooky`, id `weyclyuthdbqyjdeelzb` (region ap-southeast-1, free plan). Decision 2026-07-12: the remote project stays paused; develop against the local stack (`supabase start`), with local connection values in `.env.development.local`. Restore the remote only when cloud login/sync work resumes.
- Required env (`.env.local`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`; optional Upstash + Google OAuth vars
- Dev mode (`.env.development`, `NEXT_PUBLIC_DEVELOPMENT=true`): auth is bypassed with a dev user (`lib/config/flags.ts`) so the app runs without logging in
- Schema changes go through `supabase/migrations/` (never ad-hoc SQL against prod), then `npm run supabase:types`

## Known caveats

- Legacy Pages Router remnants in `app/pages/` including a NextAuth setup — Supabase auth in `app/auth/` is the real one; don't extend NextAuth
- Two `Database` type sources exist: prefer generated `lib/database.types.ts` over `types/database.ts`
- Three Supabase client factories exist (see Layout); pick the one matching the component context
- Test coverage is minimal; `__tests__/supabase.test.ts` hits the live database and fails when the project is paused

## Product knowledge vault

This repo uses an external Obsidian product vault for product memory and learning. When it is available as an additional Claude Code directory:

- Read the vault before shaping product work
- Write durable learning (decisions, build logs, QA learnings, postmortems, insights) to the vault, not the repo
- Repo `docs/` is for infrastructure/structural technical docs only (ADRs, setup, DB/RLS, migrations)

Product vault:

- Windows: `C:\Users\Nadeem\Desktop\Obsidian\build-blog\build-vault\5. Idea Vault\Application\B2C\Active\Properbooky`
- WSL: `/mnt/c/Users/Nadeem/Desktop/Obsidian/build-blog/build-vault/5. Idea Vault/Application/B2C/Active/Properbooky`

Launch with vault access from WSL:

```bash
CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1 claude --add-dir "/mnt/c/Users/Nadeem/Desktop/Obsidian/build-blog/build-vault/5. Idea Vault/Application/B2C/Active/Properbooky"
```
