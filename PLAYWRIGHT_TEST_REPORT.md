# PLAYWRIGHT E2E TEST REPORT — Audit 2026-07-21

Generated from the extended Playwright harness run (REPORT phase). This report reconciles the raw
run totals against the per-failure triage verdicts and separates **genuine product defects** from
**test-bugs, flakes, and environment artifacts**. Every product defect is cross-referenced to an
`AUD-*` entry appended to `AUDIT_FINDINGS.md`.

Evidence root: `artifacts/audit-2026-07-21/evidence/playwright/`
HTML report: `artifacts/audit-2026-07-21/evidence/playwright/playwright-report/`
Machine totals: `artifacts/audit-2026-07-21/evidence/playwright/test-results/results.json`

---

## 1. Scope

| Dimension | Coverage |
|---|---|
| **Specs** | **22 total = 14 existing + 8 new.** New this phase: `admin-boundary`, `object-authorization`, `registration-approval`, `clinical-report-lifecycle`, `academic-evaluation-submit`, `responsive`, `notification-access`, `account-enumeration`. Existing extended/kept: `accessibility`, `api`, `auth`, `dashboard`, `forms`, `navigation`, `performance`, `permissions`, `regression`, `security-smoke`, `tables`, `v2-role-workflows`, `workspace`, `zz-rate-limiting`. |
| **Browsers / engines** | 5 projects (+`setup`): **chromium** (Blink), **firefox** (Gecko), **webkit** (Safari) — all three binaries verified working; plus **mobile-chrome** and **tablet** (Blink). |
| **Viewports** | Desktop **1920×1080** (chromium/firefox/webkit); phone **393×851** (Pixel 5, touch, mobile UA); tablet **820×1180** (touch). |
| **Cross-engine matrix** | 10 UI-critical specs replayed on firefox + webkit (`CROSS_BROWSER_UI`). |
| **Responsive matrix** | 4 layout-reflow specs replayed on mobile-chrome + tablet (`RESPONSIVE_UI`). |
| **Roles exercised** | superadmin, **admin** (plain `role_key='admin'` fixture minted at runtime by `admin-boundary` — the first E2E coverage of the true-admin vs superadmin boundary), nurse, resident, consultant, student_rep, and **anonymous** (registration/enumeration/401 probes). |
| **DB effects** | Asserted via the API helpers (report status transitions, user activation, notification rows, access-request rows) — not "page loaded" checks. |
| **Config** | `workers:1`, `fullyParallel:false`, `retries:0`, `trace/screenshot/video: *-on-failure`. Self-managed backend: `scripts/start-e2e-backend.mjs` recreates + seeds `backend/database/e2e.sqlite` fresh; dev DB and the :8443/:33306 parity stack untouched. |

**Deferred (not run this phase)** — see §7 (NOT COVERED) for the full list: Excel/CSV import upload spec, Unicode/Amharic/RTL boundary-data spec, MariaDB-only schema behaviors (E2E is SQLite), storage-PUT / broadcasting-auth security probes (backend-targeted), concurrency two-user E2E, component/vitest + visual-regression snapshots, and the axe a11y gate expansion.

---

## 2. Totals

Raw Playwright outcome (authoritative, from `results.json`). **Playwright exit code 1.** Wall time ≈ 33.5 min.

| Project | Passed | Failed | Flaky¹ | Skipped / did-not-run |
|---|---:|---:|---:|---:|
| setup | 8 | 0 | 0 | 0 |
| chromium (1920) | 132 | 11 | 0 | 4 |
| firefox (1920) | 40 | 6 | 0 | 1 |
| webkit (1920) | 40 | 6 | 0 | 1 |
| mobile-chrome (393) | 8 | 11 | 0 | 0 |
| tablet (820) | 19 | 0 | 0 | 0 |
| **TOTAL** | **247** | **34** | **0** | **6** |

287 tests scheduled: 247 passed, 34 failed, 6 did-not-run.

¹ `retries:0`, so Playwright marks nothing "flaky." One failure (`responsive` workspace-switcher localStorage read) is a genuine **flake** — it passed on a clean isolated re-run — and is tabled as such in §5.

**Failures after triage:** of 34 failed test instances, **7 map to 3 genuine product defects**; the remaining **27 are test-bugs, a flake, or environment artifacts** (25 test-bugs + 1 flake + 1 rate-limit/env). The 6 did-not-run are collateral: 4 chromium (`account-enumeration` sibling probes aborted by a broken `beforeAll`) and 2 (firefox+webkit) `clinical-report-lifecycle` test #4 short-circuited by serial mode after test #3 failed.

---

## 3. Genuine product defects

Three distinct defects, all reproduced by Playwright. Full entries appended to `AUDIT_FINDINGS.md`.

| ID | Sev | Spec / failing test | Root cause (file:line) | Production impact | Recommended fix | Evidence |
|---|---|---|---|---|---|---|
| **AUD-UI-008** | Medium | `clinical-report-lifecycle.spec.ts` › "admin locks the report; the nurse sees read-only and a nurse save is 422" (chromium + firefox + webkit) | Client/server data-contract mismatch. `WorkspaceController::show` returns **all** reporting periods (`WorkspaceController.php:69`) but only **windowed** reports (`:84-97`); `ReportPeriodWindow::ids` caps the window at the current period, excluding all future periods even for `window='all'` and older-than-9 in `default` (`ReportPeriodWindow.php:50-58`). The report form derives status purely from the windowed bootstrap and never fetches its own `(assignment, period)` report (`report-form.tsx:478-487, 546`), so an out-of-window report falls through to `not_started` + `canEdit=true` (`selectors.ts:289-318`). | A nurse/admin opening a report whose period is out of the client window (any future-dated period, or a locked/submitted/draft report older than the last ~9 periods, reachable via deep-link or notification) sees a **blank, editable "Not started" form** instead of the true locked/submitted state: read-only banner absent, Save/Submit enabled, prior values appear lost (looks like data loss). **No integrity/authz breach** — server rejects every write to a locked report (422) and enforces ownership (403). | Have the report page fetch `GET /api/reports?assignment_id=&reporting_period_id=` (already un-windowed when both filters are present) and merge into state before deriving status/`canEdit`. Secondary: let `window='all'` include future periods. | `test-results/clinical-report-lifecycle--21b94-nly-and-a-nurse-save-is-422-chromium/` (`error-context.md`, `test-failed-1.png`, `trace.zip`) + `…-firefox/`, `…-webkit/` |
| **AUD-API-009** | Medium | `notification-access.spec.ts` › "a notification addressed to a {resident,consultant} is readable and clearable by that recipient" (chromium) | `Notification` uses `HasUuids` but omits `id` from `$fillable` (`Notification.php:11-18`); `restore()` calls `updateOrCreate(['id'=>$id], …)` (`NotificationController.php:133-145`). The guarded `id` is silently dropped by `fill()`, so `HasUuids` mints a **fresh** UUID and the client-supplied id is never persisted. | The SPA "Clear all → Undo/restore" flow re-POSTs cleared notifications by their original id expecting verbatim re-create. Because every restored row is re-keyed: (1) restore is **not idempotent** — a repeat undo / retry / double-submit inserts **duplicate** rows and can inflate the unread bell count; (2) the endpoint's own IDOR guard (`find($id)` at `:128-131`) is **dead code**, never matching; (3) client/server ids diverge. **No cross-user leak** — `recipient_id` scoping is correct. Reproduced at the backend layer (throwaway RefreshDatabase test: restored row surfaced under a server v7 UUID, not the client v4). | One line: add `'id'` to `Notification::$fillable`. `HasUuids::setUniqueIds()` only generates when the key is empty, so all other `Notification::create([...])` sites are unaffected; restore becomes idempotent and the IDOR guard goes live. Surgical alt: assign `$model->id` directly in `restore()`. | `test-results/notification-access-Regres-66f5f-clearable-by-that-recipient-chromium/trace.zip` (+ `…-4327e-…` resident variant) |
| **AUD-API-010** | Low | `notification-access.spec.ts` › "{resident,consultant} GET /api/notifications → 200 with a readable list" (chromium) — the `?unread=true` sub-assertion | `NotificationController::index` validates `'unread' => ['sometimes','boolean']` (`NotificationController.php:22`). Laravel's `boolean` rule uses strict `in_array` against `[true,false,0,1,'0','1']` (`ValidatesAttributes.php:488-497`), so the query string `?unread=true` (PHP string `"true"`) fails validation → **422**. `?unread=1`/`?unread=0` pass; `?unread=true`/`?unread=false` do not. | The endpoint publishes an `unread` boolean filter that **422s on the canonical `true`/`false` encoding.** Impact today is minimal: no `src/` caller sends `?unread=` (the SPA computes the unread bell count client-side from the `/api/workspace` snapshot), and a working escape hatch (`?unread=1`) exists. It is a **latent API-contract bug** that bites any external consumer using the documented filter the natural way, or if the frontend is refactored to fetch the unread view server-side. *(Note: a competing triage read this as a pure test-bug since the app matches its declared Laravel contract; retained as a Low defect because the server advertises a boolean filter that rejects the standard boolean literal — an over-restrictive validation, i.e. a permitted action wrongly refused.)* | Normalize the param instead of relying on the strict rule: `'unread' => ['sometimes','in:0,1,true,false,on,off']` and read via `$request->boolean('unread')`. Keeps `?unread=1` working and accepts `?unread=true`. Add a backend feature test pinning both encodings. | `test-results/notification-access-Regres-53496----200-with-a-readable-list-chromium/` (+ `…-864e5-…`) |

> The genuine regression the `notification-access` spec was written to guard — **residents and consultants can now read their own notifications** (the C-AUTHZ-001 fix) — **is verified passing**: plain `GET /api/notifications` returned 200 for both roles. AUD-API-009 and AUD-API-010 are defects surfaced by the spec's secondary assertions on top of that confirmed fix.

---

## 4. Test-bugs (harness defects — NOT product defects)

These 25 failing test instances reflect defects in the tests, not the application. Kept separate so they are never mistaken for product issues. **None indicate a forbidden action being allowed.**

| # inst. | Spec / failing test(s) | Projects | Classification | Root cause | Fix (test-side) |
|---:|---|---|---|---|---|
| 11 | `dashboard` (4 tests), `navigation` (5 tests incl. "visits every nav route"×4 + "Nav links resolve"), `workspace` (2 tests) — "shell ready" gate | mobile-chrome (393) | test-bug | `shellReady()` / `visit()` gate on `getByRole('button',{name:'Sign out'})`, which lives in the desktop cluster `hidden … sm:flex` (`app-shell.tsx:371`) — display:none below the 640px `sm` breakpoint. On phones sign-out relocates behind the account-menu Sheet (`app-shell.tsx:397-409, 461-471`). App is correct; the sibling `responsive.spec.ts` even asserts `Sign out` has count 0 at phone width. | Gate on a viewport-agnostic control — the always-rendered header **Notifications** button (`app-shell.tsx:353-369`) — as `responsive.spec.ts:awaitShell` already does. |
| 3 | `v2-role-workflows` › "non-designated resident is denied by the API" | chromium, firefox, webkit | test-bug | Asserts **403** on `GET /api/academic/morning-sessions/today`, but `MorningSessionPolicy::viewToday` intentionally returns a **safe 200** (`canRecord:false`, roster omitted) to any active resident/consultant (`MorningSessionPolicy.php:24-28`; pinned by `V2ReadAuthorizationTest.php:52-69`, `ROLE_PERMISSION_MATRIX.md:278`). The real 403 boundary belongs to nurse/student_rep. | Assert 200 + `canRecord===false` + `session.people===undefined`; put a genuine 403 check on `POST …/record` or a nurse. |
| 3 | `v2-role-workflows` › "reuses fresh analytics data when revisiting a tab" | chromium, firefox, webkit | test-bug | Waits on `getByText('Morning punctuality')`, a string renamed out of the UI by commit `6494dec` (now eyebrow "Morning sessions" + h1 "Punctuality and attendance", `academic-operations-tabs.tsx:102-104`; the old phrase survives only as a code comment). Tab renders correctly; the real assertion (`morningRequests===1`) never ran. | Anchor on `getByRole('heading',{name:'Punctuality and attendance'})`. |
| 2 | `navigation` › "visits every nav route with no fatal errors" (consultant, superadmin) | webkit | test-bug | WebKit surfaces navigation-cancelled in-flight fetches as `"… due to access control checks."` pageerrors; `visit()` advances via `page.goto` without letting fetches settle, `captureDiagnostics` accumulates across routes, and the benign-filter (`diagnostics.ts:28-29`) has no cancellation allowance. All URLs are 200/authorized (same-origin); chromium/firefox pass. | Let each route settle (`waitForLoadState('networkidle')`), reset diagnostics per route, and filter WebKit cancellation noise tied to a matching cancelled request. |
| 2 | `v2-role-workflows` › "designated recorder cancels a pending session with an audited reason" | firefox, webkit | test-bug | Non-idempotent: the test permanently cancels the singleton "today" morning session. It's in `CROSS_BROWSER_UI`, replayed against one seed-once DB; chromium runs first and consumes the pending session, so firefox/webkit find the cancellation form correctly hidden. App is correct (records cancellation, hides form for non-pending). | `test.skip(browserName!=='chromium', …)` on this mutating test, or drop the spec from `CROSS_BROWSER_UI`. |
| 1 | `account-enumeration` › "clinical POST /api/access-requests answers identically…" (+ 4 sibling probes did-not-run) | chromium | test-bug | `beforeAll` reads `department.template_id` but the admin serializer emits camelCase **`templateId`** only (`SerializesAdminResources.php:92`), so the department `.find()` is always undefined and the guard throws, aborting the whole describe. **The C-SEC-004 enumeration fix is therefore currently UNVERIFIED** — no probe is sent. App is correct/internally consistent. | Read `templateId` (cast + predicate + assignment). No app change. |
| 1 | `object-authorization` › "the request is not disclosed to another consultant (mine feed nor review queue)" | chromium | test-bug | Expects a section-less consultant to get **200** (filtered) from `GET /api/admin/transfer-requests`, but `TransferRequestPolicy::viewAny` returns 403 for non-admin, non-section-head consultants (`TransferRequestPolicy.php:14-19`; documented `ROLE_PERMISSION_MATRIX.md:283`). 403 is the *stronger* non-disclosure — safe direction. | Assert 403 for a section-less consultant; exercise the filtered-200 branch with a real section head. |
| 1 | `auth` › "rejects invalid credentials and stays on /login" | firefox | test-bug | Asserts the backend string `"These credentials do not match our records."`, which only ever appears in an auto-dismissing (~4s) Sonner toast; the persistent inline error is the generic fallback. On slower Gecko the toast dismisses before the 10s poll. App shows a clear inline error + stays on /login; no enumeration (`AuthController.php:38-54` returns `auth.failed` identically). | Assert the persistent inline error + the stays-on-/login URL; verify no-enumeration at the API layer, not on toast text. |
| 1 | `auth` › "superadmin logs in and lands on /admin" | firefox | test-bug / env | The login POST was **rate-limited (429)** — the IP-keyed `throttle:10,1` limiter (`api.php:38`) accumulated login POSTs across setup + chromium + firefox from one loopback IP. `uiLogin`'s throttle-recovery reads an ephemeral toast after a 12s timeout, so it never detects the 429 and the retry/backoff is dead code. App + limiter are correct (prod keys on real client IPs). | Make `uiLogin` branch on the actual 429 response (honor `retry-after`); minimize cross-project UI logins or give the e2e backend a higher/dedicated login throttle. |

---

## 5. Flakes and environment issues (kept separate)

| Spec / test | Project | Class | Notes |
|---|---|---|---|
| `responsive.spec.ts` › "switches clinical → academic in the More sheet and persists across reload" | chromium | **flake** | A single non-retrying `page.evaluate` read of `localStorage['stpaul:workspace']` races the React passive effect that writes it (`workspace-context.tsx:36-38`). At failure the app had already flipped to academic (URL, nav, eyebrow all correct); only the storage mirror lagged. **Clean isolated re-run PASSED.** Fix: `await expect.poll(() => …localStorage…).toBe('academic')`. No product bug. |
| Backend/port contention during re-runs | n/a (harness) | **env** | Several triage re-run attempts hit `EPERM` deleting a OneDrive-synced `e2e.sqlite` held open by orphaned `php artisan serve` / concurrent sibling harness runs, and "port 8000 already in use". Incidental to this machine (repo under `OneDrive\Desktop`), orthogonal to every classification. The seed-once launcher and `retain-on-failure` artifacts were sufficient to triage without a clean re-run. |
| WebKit binary (scout note) | webkit | **env (resolved)** | Scout flagged that the webkit binary download had not finished in the sandbox. It **did run this phase** (40 passed / 6 failed), so coverage is real; keep `npx playwright install webkit` as a first-run prerequisite on fresh machines. |

---

## 6. Reproduction commands

Run from the repo root (`C:\Users\Hasse\OneDrive\Desktop\Mesay`). The harness is self-managing: it recreates and seeds `backend/database/e2e.sqlite` and boots Vite :5173 + Laravel :8000 itself (`reuseExistingServer:false`). Leave the parity stack (:8443/:33306) alone. On a fresh machine, install engines first: `npx playwright install chromium firefox webkit`.

```bash
# Full suite, all projects (the merge gate). Exit code 1 with the failures above.
npx playwright test

# Per project (each auto-runs the 'setup' dependency first):
npx playwright test --project=chromium        # full suite @1920
npx playwright test --project=firefox         # CROSS_BROWSER_UI @1920
npx playwright test --project=webkit          # CROSS_BROWSER_UI @1920
npx playwright test --project=mobile-chrome   # RESPONSIVE_UI @393 (Pixel 5)
npx playwright test --project=tablet          # RESPONSIVE_UI @820

# Reproduce each genuine product defect:
npx playwright test tests/e2e/clinical-report-lifecycle.spec.ts   # AUD-UI-008 (chromium+firefox+webkit)
npx playwright test tests/e2e/notification-access.spec.ts --project=chromium  # AUD-API-009 + AUD-API-010

# Inspect evidence:
npx playwright show-report artifacts/audit-2026-07-21/evidence/playwright/playwright-report
npx playwright show-trace  artifacts/audit-2026-07-21/evidence/playwright/test-results/<dir>/trace.zip
```

Run commands **unpiped** when the exit status matters (a piped exit code has misled this audit before).

---

## 7. NOT COVERED (honest gaps)

What the brief asked for that this run did **not** deliver:

1. **Excel/CSV import upload** (risk-area #6, the active branch's headline feature). No fixture XLSX driven; the swallowed-422 behavior at `lib/api/admin.ts:151-172` is unexercised. Recommended as the 9th new spec. Clinical persistence is covered instead by `clinical-report-lifecycle`.
2. **C-SEC-004 account-enumeration is written but UNVERIFIED.** `account-enumeration.spec.ts` aborts in `beforeAll` on a `template_id` vs `templateId` key bug (§4), so not one enumeration probe was sent. Fix the key, then this coverage becomes real.
3. **Existing `v2-role-workflows.spec.ts:16` `non_recorder` 403 expectation is still wrong** (contradiction C-2 — backend correctly returns a safe 200). This is an edit to an existing spec, outside the new-file plan; must be corrected in phase 2.
4. **Unicode / Amharic / RTL / emoji / max-length boundary-data spec** (Gap #17) — deferred as a dedicated spec; only opportunistic Amharic sprinkling was possible in write-path specs.
5. **MariaDB / prod-parity-only behaviors** — enum `CHECK` rejection, generated columns, triggers. E2E runs on SQLite; the parity stack is off-limits per the rules. These belong to the MariaDB CI lane (see AUD-DB-001 class).
6. **Security probes better suited to backend/targeted tests** — `PUT /storage/{path}` arbitrary-write, `/broadcasting/auth` channel authz (inert under `BROADCAST_CONNECTION=log`), change-password/me/logout throttle, password-reset expiry/reuse.
7. **Concurrency / two-user simultaneous-edit E2E** (risk #15) — deferred; backend already has lock-recheck coverage.
8. **Component/vitest tests, visual-regression snapshots (`toHaveScreenshot` baselines), and `load-test.mjs`** — out of Playwright-E2E scope for this phase.
9. **Harness capability knobs left unchanged intentionally** — `retries` stays 0 and trace/screenshot/video stay `*-on-failure`, so a green run yields no artifacts. A separate phase-2 decision.
10. **axe a11y gate not expanded** to serious/moderate across authenticated mobile/nurse/consultant/rep surfaces. Partially mitigated by `responsive.spec`'s overflow checks; full expansion deferred.

Additionally, three failing specs (`v2-role-workflows` non_recorder, `object-authorization` transfer queue, several mobile-chrome shell gates) currently produce **false-red CI signal** and should be corrected (per §4) so the suite's green/red is trustworthy before it becomes a merge gate.
