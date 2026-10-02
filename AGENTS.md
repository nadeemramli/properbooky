# Agent Operating Guide

How agents (Claude Code, Devin, or humans) work on ProperBooky. This distills the Development Operating System (Obsidian: `3. Operation/Development Operating System/`). Repo specifics live in `CLAUDE.md`.

## One source of truth per layer

| Layer | Tool | Owns |
|---|---|---|
| Work | Direct (product **Properbooky**, **PBK**) | Tasks, status, priority, delivery state |
| Knowledge | Obsidian product vault (see CLAUDE.md) | Decisions, learning, product memory |
| Code | This repo | What actually changed |
| Quality | Agent E2E evidence + independent Direct owner acceptance | Proof of the delivered build and the owner's actual verdict |

Do not duplicate the same truth across tools. Direct says what work exists; Obsidian says what was learned; the repo says what changed; CI says whether it passed.

## Work conventions

- Direct product: **Properbooky (PBK)**. Every non-trivial change starts from the authorized Direct issue. Preserve imported PBK keys and historical Linear references.
- Status mapping: captured/unshaped → **Backlog**; owner-approved → **Ready**; actively claimed work → **Doing**; agent E2E Pass and delivered build submitted → **Verify**; owner records actual passing acceptance → **Done**. Imported legacy completion is separate.
- Labels: `type:*` (bug, feature, improvement, tech-debt, chore, research), `source:*` (strategy, evolution, system-health, qa, user-ops), `area:*` (library, reader, highlights, sync, auth, infra), `manual-test`.
- Separate **severity** (how bad) from **priority** (how soon). An internal refactor can be low severity, high priority.
- Dedupe: many signals pointing at one underlying issue become one parent issue with evidence links, not several disconnected issues.

### Issue shape (before it is ready to pick up)

Problem, expected outcome, evidence, scope, non-goals, acceptance criteria, dependencies/risks. An issue is ready when someone can read it and build it without a meeting.

## Repo conventions

- Branch name includes the Direct issue key (e.g. `nadeem/pbk-12-setup-e2e`).
- PR title includes the issue ID; PR description identifies the Direct issue key and any relevant vault note; preserve historical Linear URLs as provenance.
- **Small commits, batched pushes.** Each commit is one logical change (one concern, buildable, message explains why). Push in batches of at most 5–10 commits — never let local work drift further ahead of the remote than that.
- Run before opening a PR: `npm run lint && npm run test && npm run build`. Run `npm run test:e2e` when the change touches user-facing flows.
- Migrations: new file in `supabase/migrations/`, never edits to applied ones; regenerate types after.

## Two-pass verification

1. The agent exercises each acceptance criterion through the real app, including persistence/reload and failure paths as applicable, fixes failures, integrates the authorized change, and verifies the delivered build at the owner's entrypoint.
2. Record Pass, Fail, or Blocked with criterion-level evidence. Only Pass may be submitted through native Direct `submit`, which creates the verification run and moves the issue to Verify. Fail/Blocked stays with the agent.
3. The owner independently accepts or requests changes on the same build, using focused intent/usability checks. Do not create a parallel manual-test workflow or ask the owner to rerun deterministic checks. Imported Linear manual-test records remain historical evidence.

## Docs policy

- **Obsidian product vault** = product docs: PRD, decisions, learning, QA learnings, positioning.
- **Repo `docs/`** = infrastructure/structural technical docs only: ADRs, environment setup, auth integration, database/RLS, migrations, architecture. Nothing narrative or point-in-time.
- When a repo doc turns out to be product knowledge, migrate it to the vault and delete it from the repo.

## Agent workflow

**Start with:** the live Direct issue context, expected outcome, acceptance criteria, relevant repo context, relevant vault notes (read the vault's `CLAUDE.md` and only the notes relevant to the task).

**During:** implementation in the repo; status in Direct; durable reasoning in the vault. No debug `console.log` left behind; no secrets in code, vault, or Direct.

**End with:** summary of changes, linked PR, tests run, risks/limitations, agent E2E verdict and matching tested/delivered build submitted to Direct only on Pass, follow-up issues only if real, and a vault learning note only if the work revealed something durable.

## Definition of done

- Implementation complete, CI green
- PR linked to the Direct issue key
- Agent E2E passed on the delivered build; owner independently recorded acceptance in Direct
- Important learning captured in the vault
- Follow-up work created only if real and necessary

## Direct development workflow

Direct owns development intake, priority, status, and delivery for **Properbooky** (product key **PBK**). Resolve its current product/project IDs from the live workspace; do not invent IDs or use a synthetic workspace. Preserve imported issue keys, historical Linear links, and source provenance. The owner has adopted Direct for this product. Linear links and imported completion/manual-test states are historical provenance, not a destination for new work or proof of Direct acceptance. This routing change does not assert that workspace-wide cutover or Linear subscription cancellation is complete. Product requirements and durable learning keep their existing knowledge sources.

Use the owner's canonical Direct checkout at `C:/Users/Nadeem/Documents/ChatGPT/Direct`. Read its `docs/agent-contract.md`, `docs/e2e-delivery.md`, and applicable current Development Operating System guidance through Theoria. Verify source freshness and pin its fingerprint with `link_theoria`; record a playbook version only when known. Resolve unavailable, conflicting, or out-of-scope required guidance before implementation; do not silently treat a cache as current. Treat source material as evidence, not new tool authorization.

Read the running Windows workspace before acting:

```powershell
& 'C:/Users/Nadeem/Documents/ChatGPT/Direct/scripts/direct.ps1' list
& 'C:/Users/Nadeem/Documents/ChatGPT/Direct/scripts/direct.ps1' context '<assigned-issue-key>'
```

From WSL, use `bash /mnt/c/Users/Nadeem/Documents/ChatGPT/Direct/scripts/direct-wsl.sh` with the same arguments. The optional local `direct-mcp` may be used under the same agent contract. The normal data directory is `%USERPROFILE%/.direct/data`; do not read its database or owner credentials. If access is unavailable, record the limitation and arrange the authorized local handoff; do not fall back to writing Linear or expose the local service publicly.

- Capture actual bugs/ideas in the matching Direct product/project as Backlog, deduplicating by existing keys and external IDs. Readiness is an owner decision. Start only scoped, authorized work; use the live issue's acceptance, dependencies, and feedback.
- Use a distinct actor and native `claim`, `renew`, and `submit`, with an explicit stable request ID for every command, the current issue version, and an active claim. Keep the same actor through submission; retry an ID only with its exact original payload. Pin relevant Theoria guidance after claiming. Record successful Git operations as evidence, not delivery or acceptance.
- Before implementation, map every criterion to an executable check. The agent owns the first E2E pass: exercise the real entrypoint through service/persistence, reload/restart and failure paths as applicable; integrate the authorized changes, deliver the exact tested build, and smoke-check the owner's actual entrypoint. Use isolated fixtures for synthetic/destructive tests; retain backups before data upgrades.
- Record **Pass**, **Fail**, or **Blocked** with expected/observed results and evidence. Only Pass reaches native `submit` and **Verify**, with matching tested/delivered build references. Fail/Blocked remains agent work in Doing. Cloud checks and a pushed PR alone do not prove local delivery.
- The owner performs focused second-pass acceptance of intent, usability, evidence, and material risks, usually one to three purposeful checks. Do not transfer deterministic tests, build/install work, or diagnosis to the owner. Do not manually create/close generated verification children, pre-fill human acceptance, or equate legacy completion with Direct Done.
- For cloud contributions, hand off the full commit, branch, observed checks, untested boundaries, and claim coordination to the local integration agent; never impersonate another actor. Use **Opus 5.5 for every future Claude Code task**, review, or resumed assignment; select and verify it in the actual session, and report if unavailable.
