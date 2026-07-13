# Agent Operating Guide

How agents (Claude Code, Devin, or humans) work on ProperBooky. This distills the Development Operating System (Obsidian: `3. Operation/Development Operating System/`). Repo specifics live in `CLAUDE.md`.

## One source of truth per layer

| Layer | Tool | Owns |
|---|---|---|
| Work | Linear (team **Properbooky**) | Tasks, status, priority, delivery state |
| Knowledge | Obsidian product vault (see CLAUDE.md) | Decisions, learning, product memory |
| Code | This repo | What actually changed |
| Quality | CI + manual-test sub-issues | Proof it builds, passes, and a human vetted it |

Do not duplicate the same truth across tools. Linear says what work exists; Obsidian says what was learned; the repo says what changed; CI says whether it passed.

## Linear conventions

- Team: **Properbooky**. Every non-trivial change starts from a Linear issue.
- Status mapping (team uses default states): raw/unshaped → **Backlog**; shaped + approved to pick up → **Todo**; being built → **In Progress**; PR open + manual test pending → **In Review**; merged/released and vetted → **Done**.
- Labels: `type:*` (bug, feature, improvement, tech-debt, chore, research), `source:*` (strategy, evolution, system-health, qa, user-ops), `area:*` (library, reader, highlights, sync, auth, infra), `manual-test`.
- Separate **severity** (how bad) from **priority** (how soon). An internal refactor can be low severity, high priority.
- Dedupe: many signals pointing at one underlying issue become one parent issue with evidence links, not several disconnected issues.

### Issue shape (before it is ready to pick up)

Problem, expected outcome, evidence, scope, non-goals, acceptance criteria, dependencies/risks. An issue is ready when someone can read it and build it without a meeting.

## Repo conventions

- Branch name includes the Linear issue ID (e.g. `nadeem/pbk-12-setup-e2e`).
- PR title includes the issue ID; PR description links the Linear issue and any relevant vault note.
- **Small commits, batched pushes.** Each commit is one logical change (one concern, buildable, message explains why). Push in batches of at most 5–10 commits — never let local work drift further ahead of the remote than that.
- Run before opening a PR: `npm run lint && npm run test && npm run build`. Run `npm run test:e2e` when the change touches user-facing flows.
- Migrations: new file in `supabase/migrations/`, never edits to applied ones; regenerate types after.

## Verification loop (manual test)

"Completed" must mean "vetted":

1. Finish a feature issue → open PR → move the feature issue to **In Review** (never straight to Done).
2. Create a **manual-test sub-issue** under it: title `Manual test: <feature>`, label `manual-test`, assigned to the owner, containing the PR link and numbered test cases from the acceptance criteria (steps → expected → pass/fail).
3. Pass → close the sub-issue; feature moves to Done after merge. Fail → note what broke, spawn a follow-up bug sub-issue, iterate.

Manual tests are Linear sub-issues, never a compiled test-plan document.

## Docs policy

- **Obsidian product vault** = product docs: PRD, decisions, learning, QA learnings, positioning.
- **Repo `docs/`** = infrastructure/structural technical docs only: ADRs, environment setup, auth integration, database/RLS, migrations, architecture. Nothing narrative or point-in-time.
- When a repo doc turns out to be product knowledge, migrate it to the vault and delete it from the repo.

## Agent workflow

**Start with:** the Linear issue, expected outcome, acceptance criteria, relevant repo context, relevant vault notes (read the vault's `CLAUDE.md` and only the notes relevant to the task).

**During:** implementation in the repo; status in Linear; durable reasoning in the vault. No debug `console.log` left behind; no secrets in code, vault, or Linear.

**End with:** summary of changes, linked PR, tests run, risks/limitations, manual-test sub-issue created, follow-up issues only if real, and a vault learning note only if the work revealed something durable.

## Definition of done

- Implementation complete, CI green
- PR linked to the Linear issue
- Manual-test sub-issue passed
- Important learning captured in the vault
- Follow-up work created only if real and necessary
