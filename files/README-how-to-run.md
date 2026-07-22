# Academic module — Claude Code handoff package

A complete, ready-to-run package for adding the **Academic** evaluations section (residents and consultants evaluating each other after MDT rounds, with admin trend dashboards) to the St Paul Internal Medicine app.

## What's in the package

- **`academic-module-claude-code-brief.md`** — the full technical spec. This is what Claude Code reads and builds from: locked design decisions, both form field specs, validation rules, the exact API contract, and a stage-by-stage build plan with verification gates.
- **`claude-code-prompts.md`** — the prompts to paste into Claude Code, in order (kickoff + 4 stages + 2 optional extras).
- **`README-how-to-run.md`** — this file.

## Before you start

1. Open your repo in Claude Code.
2. Copy `academic-module-claude-code-brief.md` into the repo (the root or `docs/` is fine) so Claude Code can read it. (Alternatively, paste its contents when the kickoff prompt asks.)
3. Confirm you can run the backend (`php artisan ...`) and frontend (`npm ...`) locally, per `docs/ARCHITECTURE.md` → Build, Run, Test.

## How to run it

Paste the prompts from `claude-code-prompts.md` one at a time, in order:

1. **Kickoff** — Claude Code reads the spec and the architecture doc and reconciles them with the actual code. It reports the plan, the files it'll copy from, and any mismatches it found. **Read the mismatches before continuing** — that's where I may have guessed a name slightly wrong from the architecture doc.
2. **Stage 1** — backend data model. Gate: `php artisan migrate` runs clean.
3. **Stage 2** — backend API + analytics + tests. Gate: `php artisan test` is green. **Do not move to the frontend until this passes.**
4. **Stage 3** — frontend plumbing + the submission page. Gate: `npm run verify` is green; log in as a resident and a consultant and submit one evaluation each.
5. **Stage 4** — admin dashboard + per-person detail. Gate: `npm run verify` is green; click through `/admin/academic` and a person page.
6. *(optional)* seed demo data so the charts have shape; *(optional)* update the architecture doc.

## Rules of the road

- **One stage at a time.** After each, run the verification command and eyeball the result before sending the next prompt.
- **If a gate fails, paste the full error back to Claude Code** and let it fix it — don't advance with a red gate.
- **Backend before frontend, always.**
- The spec's *locked decisions* are settled. If Claude Code proposes deviating, say no — unless it surfaced a real conflict with the codebase, in which case decide it explicitly.

## One open choice

The resident form uses **yes/no items + a single 1–5 overall rating**, to mirror the MDT form and keep both dashboards uniform (% compliance per item). If you'd rather grade each competency on its **own 1–5 scale** (Mini-CEX style), say so in the kickoff prompt — Claude Code swaps the ten booleans for ten small-integer columns and the dashboard shifts from "% met" to "average per competency." Everything else stays the same.

## Safety note

This is local development, so risk is low — but as a habit: review any irreversible step (deleting data, changing permissions/sharing) before approving it, and never put real patient data into a development database.
