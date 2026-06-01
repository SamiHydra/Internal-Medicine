# Claude Code prompts — paste in order

Each prompt assumes `academic-module-claude-code-brief.md` is sitting in the repo (root or `docs/`) so Claude Code can read it. Run one stage, check its gate, then send the next. Don't send the next prompt until the current gate passes.

---

## 0 · Kickoff — read & reconcile (paste first)

```
I'm adding a new "Academic" module to this codebase. The full spec is in academic-module-claude-code-brief.md at the repo root.

Do this first, and write NO code yet:
1. Read docs/ARCHITECTURE.md in full, then read academic-module-claude-code-brief.md in full.
2. Reply with: (a) a one-paragraph restatement of the plan in your own words; (b) the exact existing files you'll copy patterns from for each layer — migration, model, policy, controller, serializer, API client, page, nav; (c) any mismatch between the spec and the real code: wrong paths, renamed conventions, anything that wouldn't apply cleanly.
3. Then stop and wait for me to say "Stage 1".

Work strictly stage by stage. After each stage, run its verification command, show me the output, and stop for my confirmation before starting the next. Backend first: do NOT create or edit any frontend file until the Stage 2 PHPUnit test passes. Treat the spec's "Locked design decisions" as fixed unless you found a genuine conflict in step 2 — in which case flag it and ask, don't silently change course.
```

---

## 1 · Stage 1 — backend data model, roles, permissions, policies

```
Do Stage 1 from the spec — migrations, models, roles, permissions, policies. Follow it exactly, honoring the conventions: UUID PKs + HasUuids, foreignUuid(...)->constrained(...) with the delete behavior noted (restrictOnDelete for author/subject/ward, nullOnDelete for home_ward_id), the Permissions matrix additions, and MANUAL Gate::policy registration in AppServiceProvider::boot().

When done: run `php artisan migrate`, then `composer dump-autoload`. Show me the migration output and the new role + permission entries. Then stop — don't start Stage 2 until I confirm.
```

---

## 2 · Stage 2 — backend API, analytics, routes, tests

```
Do Stage 2 from the spec — the submission controller and the admin listing controller, the serializer methods, the analytics service + filters VO, the analytics controller, the routes, and the feature test.

Match the "Field & validation reference" and "API payload shapes" sections EXACTLY: camelCase responses including the computed qualityScore/performanceScore; accept snake_case AND camelCase on input; enforce the direction/role check on each store; two-layer authz (permission: middleware on the route AND Gate::authorize in the action).

Then run `php artisan test` and show me the result. Fix until it's green. Stop — do NOT touch any frontend file yet.
```

---

## 3 · Stage 3 — frontend plumbing + submission

```
Do Stage 3 from the spec — frontend plumbing and the submission experience.

Add the new roles to the UserRole type. Fix the landing/redirect logic (the nurse/admin switch in HomeRedirect and ProtectedRoute) so resident|consultant land on /academic. Create src/lib/api/academic.ts and add it to the barrel index.ts (NEVER importing realtime). Add the payload/response types matching the "API payload shapes" section exactly. Build the role-aware /academic submission page with Zod + react-hook-form, using components/ui primitives and the section-panel styling from the spec (copy access-request-page.tsx and report-form.tsx's FieldInput). Add the nav entries for the new roles and the admin "Academic" link.

Then run `npm run verify`. Fix until green. Stop before the admin dashboards.
```

---

## 4 · Stage 4 — frontend admin dashboards

```
Do Stage 4 from the spec — the admin academic dashboard (/admin/academic) and the per-person detail page (/admin/academic/people/:userId), plus their routes inside the existing admin guard.

Reuse ReportingScopePanel, ChartCard, InsightPanel, the 4-up tone-tile pattern, and the existing blue/navy/gold/steel chart palette — don't hand-roll filter UIs or re-style charts. Drive everything from the academic analytics endpoints and listAcademicEvaluations.

Then run `npm run verify`. Fix until green. Finally, give me a short click-through test script to run as an admin.
```

---

## (optional) Seed demo data

```
Extend DevUserSeeder (it already self-guards against production/testing) to add 2 resident users, 2 consultant users with a home_ward_id, and ~30 evaluations across 2–3 wards spread over the last ~8 weeks, with realistic variation in the answers — enough to make the trend and Pareto charts render with real shape. Run the seeder and confirm the dashboard populates.
```

---

## (optional) Document the module

```
Update docs/ARCHITECTURE.md to document the Academic module: the two new tables, the two new roles and their permissions, the new routes, the analytics service, and the new pages — matching the doc's existing style and section structure.
```
