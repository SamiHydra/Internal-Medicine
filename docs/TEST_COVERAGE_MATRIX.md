# Test Coverage Matrix

Audit date: 2026-07-12  
Scope: Existing implementation and existing executable tests only. No tests were added or rewritten.

## Classification rules

- **Fully tested**: the stated row, as narrowly written, has direct executable baseline evidence.
- **Partially tested**: some happy paths and important boundaries have executable evidence, but audit-specified cases remain.
- **Not tested**: implementation may exist, but this stage found no sufficient executable evidence.
- **Not implemented**: no corresponding implementation was found.
- **Implemented incorrectly**: inspection found a concrete mismatch or unsafe design.
- **Blocked by the environment**: verification requires a service, tool, browser, database, or host unavailable in this stage.
- **Not applicable**: the requirement does not fit the current architecture.

Passing source-level unit or feature tests are evidence only for the behavior they directly assert. Code inspection alone is not marked as a passed feature.

## Baseline and platform matrix

| Requirement | Backend route or service | Frontend page or component | Existing test | Missing test | Implementation status | Current verification | Evidence location |
|---|---|---|---|---|---|---|---|
| Safe environment classification | PHPUnit in-memory SQLite; local SQLite runtime | Local Vite API origin | Full backend suite ran without touching local DB | Production/staging classification automation | Implemented | Fully tested | `backend/phpunit.xml`; `BASELINE_TEST_RESULTS.md` |
| Repository and tool baseline | Artisan, Composer lock, npm lock, CI | Vite/React toolchain | Existing suites/build/lint | Composer advisory query | Implemented | Partially tested | `BASELINE_TEST_RESULTS.md` |
| CI on SQLite and MariaDB | GitHub Actions backend jobs | GitHub Actions frontend job | CI definitions exist | Current remote run status and artifacts | Implemented | Blocked by the environment | `.github/workflows/ci.yml` |
| Direct API inventory | 160 `/api` routes | 36 explicit non-wildcard SPA paths | `route:list`; all 154 Sanctum routes return `401` anonymously | Happy-path, validation, coarse-permission, object-policy, and audit checks for every route | Implemented | Partially tested | `ROUTE_AND_AUTHORIZATION_INVENTORY.md`; `EXECUTABLE_VERIFICATION_RESULTS.md` |
| Playwright architecture | API supports browser flows | Existing specs under artifact directory | 93 tests in 14 files executed; production subset 31/31 passed | Repair fixture coverage; move/verify fixtures, pages, helpers, traces | Implemented incorrectly | Partially tested | `playwright.config.ts`; `artifacts/pre-deployment-qa/PLAYWRIGHT_TESTS`; `EXECUTABLE_VERIFICATION_RESULTS.md` |

## Authentication and authorization

| Requirement | Backend route or service | Frontend page or component | Existing test | Missing test | Implementation status | Current verification | Evidence location |
|---|---|---|---|---|---|---|---|
| Login success/failure and inactive accounts | `/api/auth/login`; `AuthController` | `login-page.tsx` | `AuthApiTest`; `AdminRegistrationTest` | Browser return-to path, enumeration, repeated failures beyond existing cases | Implemented | Partially tested | `backend/tests/Feature/AuthApiTest.php` |
| Login rate limiting | Login throttle 10/min | Login form | Backend assertion; focused Playwright file passed 5/5 with persistent cache | Reset-window timing and distributed cache behavior | Implemented | Partially tested | `AuthApiTest.php`; `zz-rate-limiting.spec.ts`; `EXECUTABLE_VERIFICATION_RESULTS.md` |
| Logout and session invalidation | `/api/auth/logout` | App shell/logout | `AuthApiTest` | Multi-tab, back button, service-worker cache, post-password-change session invalidation | Implemented | Partially tested | `AuthApiTest.php` |
| Password reset and forced change | Forgot/reset/change endpoints; password-change middleware | Forgot, reset, change pages | `WorkspaceApiTest`; `AuthApiTest`; `CreateSuperadminTest` | Expired token browser flow and concurrent sessions | Implemented | Partially tested | Corresponding backend feature tests |
| Sanctum and CSRF | Sanctum CSRF cookie; stateful API middleware | API client CSRF bootstrap | `AuthApiTest`; client unit tests | Invalid/expired CSRF, 419 recovery, production cookie attributes, cross-origin denial | Implemented | Partially tested | `backend/config/sanctum.php`; `src/lib/api/client.test.ts` |
| Frontend route guards | Server API remains authoritative | `ProtectedRoute`; `App.tsx` | Playwright navigation and permission specs passed in the full run | Exhaustive path/role/refresh matrix | Implemented | Partially tested | `src/routes/route-guards.tsx`; `App.tsx`; `EXECUTABLE_VERIFICATION_RESULTS.md` |
| Role permission map | `Permissions`; permission middleware | Role-specific navigation | `AuthorizationTest` | Full route-permission consistency generator | Implemented | Partially tested | `backend/tests/Feature/AuthorizationTest.php` |
| Object-level authorization | Report, notification, transfer, morning, teaching, user policies | Hidden/guarded actions | Multiple module feature tests | Every route with valid foreign object ID, horizontal/vertical matrices | Implemented | Partially tested | `backend/app/Policies`; module tests |
| Student representative evaluation isolation for the current backend route set | All academic evaluation routes | Representative has only `/teaching` | Route-enumerating 403 test | Workspace/prefetch browser inspection and future-route guard | Implemented | Fully tested | `UndergraduateModuleTest::test_student_rep_receives_403_on_every_academic_evaluation_endpoint` |

## Clinical pillar

| Requirement | Backend route or service | Frontend page or component | Existing test | Missing test | Implementation status | Current verification | Evidence location |
|---|---|---|---|---|---|---|---|
| Report create, draft save, and validation | Report routes; submission/calculation/quality services | `report-form-page`; `report-form` | `ReportWorkflowTest` | Browser autosave, network interruption, concurrent edits | Implemented | Partially tested | `backend/tests/Feature/ReportWorkflowTest.php` |
| Submit, lock, unlock, history | Report workflow routes and locking service | Report form/admin board | `ReportWorkflowTest` | Concurrent lock bypass and retry behavior | Implemented | Partially tested | `ReportWorkflowTest.php` |
| Assignment and report scoping | Admin assignment routes; report policy | Nurse report selection | `ReportWorkflowTest`; `AdminApiTest` | All object IDs and inactive assignments | Implemented | Partially tested | Feature tests and `ReportPolicy.php` |
| Clinical template content/structure/version behavior | Admin template routes and config services | Template management page | `AdminApiTest` | Full publishing/version concurrency and historical-template rendering | Implemented | Partially tested | `AdminApiTest.php`; template services |
| Clinical comments | Report comment routes | `report-comments` | `ReportCommentTest` | Concurrent replies, large input, XSS browser rendering | Implemented | Partially tested | `ReportCommentTest.php` |
| Clinical import CSV/XLSX | Admin import routes and import services | Data import page | `ReportImportTest`; `XlsxReaderTest` | Large files, malformed workbook breadth, rollback/idempotency under failure | Implemented | Partially tested | Import feature/unit tests |
| Current guarded spreadsheet formula round-trip cases | `SpreadsheetSafe`; Xlsx writer | Import/export UI | Direct export/import tests | Additional formula variants and office-client verification | Implemented | Fully tested | `ReportImportTest.php`; `XlsxWriterTest.php` |
| Clinical analytics and export | Analytics routes/services | Admin dashboard and detail pages | `AnalyticsTest`; `AnalyticsExportTest` | Large data, all filters, query plans, cache failure | Implemented | Partially tested | Analytics feature tests |
| Clinical analytics cache | `DashboardAnalyticsService` | Custom browser cache helpers | Backend analytics tests; frontend analytics tests | Driver failure, cross-user leakage, production timings | Implemented | Partially tested | `DashboardAnalyticsService.php`; `analytics.test.ts` |
| Reminders, overdue, digest, alerts | Scheduled report commands and services | Notifications/action items | Reminder, overdue, digest, alert tests | Real queue/SMTP/SMS failure and duplicate scheduling | Implemented | Partially tested | `ReportReminderTest`; `NotificationsAndOverdueTest`; `LeadershipDigestTest` |
| Action items and audit logs | Action item/admin audit services | Action items and audit pages | `ActionItemTest`; `AdminApiTest` | Audit/mutation rollback atomicity across all writes | Implemented | Partially tested | Corresponding tests and services |

## Academic structure, roster, and rotations

| Requirement | Backend route or service | Frontend page or component | Existing test | Missing test | Implementation status | Current verification | Evidence location |
|---|---|---|---|---|---|---|---|
| Ward administration | Admin academic ward routes | Academic structure page | `RosterTest` | All validation, inactive references, direct object IDs, delete FK cases | Implemented | Partially tested | `RosterTest.php`; `AcademicStructureController.php` |
| Section administration and heads | Admin academic section routes | Academic structure page | `RosterTest`; `SectionTransferTest` | Inactive/non-consultant head and referenced delete matrix | Implemented | Partially tested | Feature tests and `SectionPolicy.php` |
| Duty-type administration and combinations | Admin duty-type routes | Academic structure page | `RosterTest` | Full invalid combination matrix and inactive references | Implemented | Partially tested | `RosterTest.php`; duty-type migration/model |
| Assignment lookup boundaries | `RosterService::assignmentFor/assignmentsFor` | Duty roster page | `RosterTest` | Every boundary with inactive users/types and multiple daily assignments | Implemented | Partially tested | `RosterTest.php`; `RosterService.php` |
| Pairing keys and eligibility | `RosterService` | Evaluation form options | `RosterTest`; `AcademicEligibilityTest` | Remaining role-direction and inactive-user combinations | Implemented | Partially tested | Both feature test files |
| Monthly assignment overlap protection | `RosterService::createAssignment` | Duty roster/rotation planner | Sequential overlap test | Parallel MariaDB requests and lock assertion | Unsafe unlocked check/insert | Implemented incorrectly | IA-002; `RosterService.php:191,331` |
| Bulk assignment atomicity | `RosterService::bulkAssign` | Duty roster and planner saves | Planner/roster feature tests | Invalid middle row rollback, large batch, query count, concurrent save | Implemented | Partially tested | `RosterService.php`; `RosterTest`; `RotationPlannerTest` |
| Rotation calendar generation | `RotationCalendarService`; calendar routes | Rotation planner | Fixed-week and month-block tests | Leap year, near month-end, rerun, zero/excessive blocks | Implemented | Partially tested | `RosterTest.php` |
| Rotation planner individual/group plans | Rotation routes and roster bulk service | Rotation planner page | `RotationPlannerTest` | Concurrent planners, partial invalid rollback, historical group changes | Implemented | Partially tested | `RotationPlannerTest.php` |

## Transfers and evaluations

| Requirement | Backend route or service | Frontend page or component | Existing test | Missing test | Implementation status | Current verification | Evidence location |
|---|---|---|---|---|---|---|---|
| Consultant transfer request/cancel/scope | Consultant transfer routes; policy/service | Transfer request card/review panel | `SectionTransferTest` | More policy object IDs and future-date edges | Implemented | Partially tested | `SectionTransferTest.php` |
| Transfer decision/application exactly once | Admin transfer routes; `TransferService` | Transfer review panel | Sequential command idempotency test | Two deciders, scheduler/manual race, failed side-effect retry | Missing transfer-row locks and atomic side effects | Implemented incorrectly | IA-003; `TransferService.php` |
| Rotation-aware form options | `/api/academic/form-options`; `RosterService` | Evaluation form page | `AcademicEvaluationApiTest`; `AcademicEligibilityTest` | Full date/assignment/inactive matrix | Implemented | Partially tested | Academic feature tests |
| User evaluation submission and snapshots | Consultant/resident evaluation routes; form service | Evaluation renderer | Academic evaluation/eligibility tests | Duplicate rule, forged placement variants, transaction failure injection | Implemented | Partially tested | `AcademicEvaluationApiTest`; `AcademicEligibilityTest` |
| External evaluation entry | Admin external evaluation route | External evaluation panel | Academic eligibility/evaluation tests | Every external slug, author conflict, audit failure, duplicates | Implemented | Partially tested | `AcademicEligibilityTest.php`; admin controller |
| Evaluation field types and validation | `EvaluationFormService` | `evaluation-form-renderer` | `EvaluationFormEngineTest` | Full valid/invalid matrix for all eight types, Unicode, long text, unknown extras | Implemented | Partially tested | `EvaluationFormEngineTest.php` |
| Evaluation content editing | Admin form content route/service | Evaluation forms page | Content-in-place test | Concurrent content edit and audit atomicity | Implemented | Partially tested | `EvaluationFormEngineTest.php` |
| Evaluation structural versioning | Draft/structure/publish routes/service | Evaluation forms page | Historical pinning and core-field tests | Concurrent draft/publish and failed transaction | No key-level lock or published uniqueness constraint | Implemented incorrectly | IA-004; `EvaluationFormService.php` |
| Unified evaluation invariants | `EvaluationFormService::store` | Evaluation submit surfaces | Service-path feature tests | Direct DB invalid combinations and check-constraint tests | Database checks absent | Implemented incorrectly | IA-005; evaluation migration |
| Header plus answers atomicity | Form service transaction | Evaluation submit surfaces | Existing submission tests | Forced answer-insert failure rollback | Implemented | Partially tested | `EvaluationFormService.php:73`; evaluation tests |
| Legacy migration parity | `academic:verify-migration`; migration service | Not applicable | `EvaluationFormEngineTest` invokes verifier | Deterministic full parity and controlled real dataset | Implemented | Partially tested | `EvaluationFormEngineTest::test_verify_migration_passes...` |
| Academic analytics correctness/cache | Academic analytics services/routes | Academic dashboard/person detail | Evaluation and operations analytics tests | Cache-driver failure, concurrent fill, large content-stamp timing | Implemented | Partially tested | `AcademicOperationsTest`; `EvaluationFormEngineTest` |

## Undergraduate and morning modules

| Requirement | Backend route or service | Frontend page or component | Existing test | Missing test | Implementation status | Current verification | Evidence location |
|---|---|---|---|---|---|---|---|
| Student batches | Admin batch routes | Students page | `UndergraduateModuleTest` | Delete/FK behavior, overlapping lifecycle breadth | Delete API absent | Partially tested | IA-011; `UndergraduateModuleTest.php` |
| Student CRUD and import | Admin student routes/import service | Students page | `UndergraduateModuleTest` | Delete behavior, large file, formula input, encoding/rollback breadth | Delete API absent | Partially tested | IA-011; `UndergraduateModuleTest.php` |
| Subgroup placements and snapshots | Placement routes; teaching service | Students page | `UndergraduateModuleTest` | Concurrent edits, inactive ward, all week boundaries | Implemented | Partially tested | `UndergraduateModuleTest.php` |
| Representative assignments and scope | Rep assignment routes; teaching policy | Representative log | `UndergraduateModuleTest` | Multi-scope, expiration, inactive user, duplicate race | Implemented | Partially tested | `UndergraduateModuleTest.php` |
| Teaching-session generation | Scheduled command; `TeachingService` | Admin/rep/attendance pages | Schedule/idempotency/overlap tests | Timezone, holiday, concurrent generation, missing placement alert timing | Implemented | Partially tested | `UndergraduateModuleTest`; `AcademicOperationsTest` |
| Representative activity recording | Teaching record route/policy | Rep log page | Scope/reason tests | Cutoff edges, concurrent recording, wrong batch object IDs | Implemented | Partially tested | `UndergraduateModuleTest.php` |
| Student attendance | Teaching attendance route/policy | Teaching attendance page | Consultant attendance test | Concurrent saves, duplicate/foreign students, atomic failure injection | Implemented | Partially tested | `UndergraduateModuleTest.php` |
| Student evaluations | Student evaluation route/form service | Evaluation form page | Weekly placement and consultant-access test | Final timing, duplicates, outside attachment, full field validation | Implemented | Partially tested | `UndergraduateModuleTest.php` |
| Morning-session generation | Open command; `MorningSessionService` | Admin morning panel | `MorningSessionTest` | Configured-day changes, timezone, concurrent scheduler | Implemented | Partially tested | `MorningSessionTest.php` |
| Morning roster and overrides | Roster and morning services | Morning attendance/admin panel | `RosterTest`; `MorningSessionTest` | Conflicting override precedence and large roster query count | Implemented | Partially tested | Both feature tests |
| Recorder authorization | Morning policy/routes | Morning attendance page | `MorningSessionTest` | Removed recorder, multiple recorders, direct ID matrix | Implemented | Partially tested | `MorningSessionTest.php` |
| Morning recording and correction | Morning record/admin update routes | Morning attendance page/admin panel | `MorningSessionTest` | Concurrent record, midnight, malformed time breadth, correction races | Implemented | Partially tested | `MorningSessionTest.php` |
| Morning cancellation | Admin cancellation route | Admin morning panel | Admin cancellation test | Designated-recorder cancellation | Recorder route absent | Not implemented | IA-012; routes and controller |
| Morning reminder | Scheduled reminder command | Notifications | `MorningSessionTest`; `AcademicOperationsTest` | Real queue/email failure, duplicates with multiple recorders, timezone | Implemented | Partially tested | Feature tests; scheduler |

## Workspace, queue, API, database, security, and operations

| Requirement | Backend route or service | Frontend page or component | Existing test | Missing test | Implementation status | Current verification | Evidence location |
|---|---|---|---|---|---|---|---|
| Workspace bootstrap fields and scoping | `/api/workspace`; `WorkspaceController` | App-data/workspace contexts | `WorkspaceApiTest`; `RosterTest`; `SectionTransferTest` | Every role, payload size, query count, representative sensitive-data inspection | Implemented | Partially tested | Corresponding feature tests |
| Queue job delivery/retry | `SendNotificationDelivery`; database queue | Notifications | `NotificationDeliveryTest` | Real worker, max attempts/backoff parity, deleted model, SMTP/SMS failure | Implemented | Partially tested | Job, queue config, feature test |
| Scheduler registration/idempotency | `routes/console.php`; commands | Not applicable | 15 events listed; 11 commands executed twice serially | Controlled clock, overlap locks, parallel workers, digest deduplication | Digest repeats same-window dispatch | Implemented incorrectly | IA-016; `EXECUTABLE_VERIFICATION_RESULTS.md` |
| Scheduler timezone correctness | All business-time schedules | Morning/teaching/reminders | None for local timezone | Execute with East Africa business time | UTC hard-coded, no per-event timezone | Implemented incorrectly | IA-006 |
| API contract for every route | Controllers and validation | API modules | Module feature tests plus anonymous checks for all 154 protected routes | Happy-path, validation, coarse-permission, policy, and audit matrix for all 160 routes | Implemented | Partially tested | Route inventory; `EXECUTABLE_VERIFICATION_RESULTS.md` |
| Database indexes and foreign keys | 54 migrations, 52 local tables | Not applicable | Migration execution in every backend test | Actual FK/index catalog, MariaDB query plans, orphan/duplicate queries | Implemented | Partially tested | Migrations; `migrate:status`; `db:show` |
| Database integrity reports | Models/services/migrations | Not applicable | 17 targeted queries returned zero on isolated seeded SQLite | MariaDB and sanitized-real-data runs; permanent repeatable harness | Not implemented as repository tooling | Partially tested | `EXECUTABLE_VERIFICATION_RESULTS.md` |
| Transaction and concurrency safety | Roster, transfers, forms, attendance, import | Mutation pages | Sequential transaction tests | Parallel request/process suite on MariaDB | Several lock gaps found | Implemented incorrectly | IA-002, IA-003, IA-004 |
| Security access control | Middleware, permissions, policies | Route guards/navigation | Authorization/module tests; all protected routes anonymous-denied; browser permission and IDOR smoke passed | Complete correct-role/wrong-role/object matrix | Implemented | Partially tested | Policies; feature tests; `EXECUTABLE_VERIFICATION_RESULTS.md` |
| Injection and XSS | Validation, spreadsheet safety, security headers | React rendering | Import formula/XML tests; browser reflected-XSS and sensitive-file smoke passed | Broader safe SQL/log/path/oversize probes | Implemented | Partially tested | Import tests; middleware; `EXECUTABLE_VERIFICATION_RESULTS.md` |
| CSRF/browser headers | Sanctum, CORS, security middleware | Static `_headers` | Local production-preview header and cookie checks passed | Real HTTPS, deployed CORS, HSTS, and cross-origin behavior | Implemented | Partially tested | Config; header files; `EXECUTABLE_VERIFICATION_RESULTS.md` |
| Dependency security | Composer/npm locks | Frontend dependency graph | `npm audit` executed | Composer audit and advisory applicability review | Frontend has known advisories | Implemented incorrectly | IA-001, IA-009 |
| PWA install/update/offline/logout isolation | API excluded from SW cache | Manifest, service worker, offline queue/cache | Manifest/SW/fallback probes and browser offline recovery passed | Install prompt, update race, user switching, logout isolation, mutation replay | Implemented | Partially tested | `public/sw.js`; offline tests; `EXECUTABLE_VERIFICATION_RESULTS.md` |
| Accessibility and responsive UX | API error states | React pages/components | Chromium Axe, keyboard, and configured responsive checks passed | Screen reader, zoom/contrast breadth, other browsers and devices | Implemented | Partially tested | Playwright accessibility spec; `EXECUTABLE_VERIFICATION_RESULTS.md` |
| Frontend performance | API endpoints | Production Vite build | Build output and production-preview performance smoke passed | Lighthouse, LCP/INP percentiles, unused JS, controlled cache/query profiling | Implemented | Partially tested | Build baseline; `performance-targets.test.ts`; `EXECUTABLE_VERIFICATION_RESULTS.md` |
| API/load/soak performance | Critical API routes | Critical pages | Legacy Node load script exists | Required k6 tiers, p50/p90/p95/p99, errors, resource telemetry | Required harness absent | Not implemented | `scripts/load-test.mjs`; no `tests/performance` |
| Database performance | Analytics, roster, evaluations | Dashboards/planners | Isolated query-count assertions in some tests | EXPLAIN/ANALYZE and N+1 profile for every critical route | Implemented services | Not tested | Migrations/services/tests |
| Scalability projections | Database-backed queues/cache/session | All high-volume modules | None | 1/3/5/10-year model, backup/restore timing, storage/retention | Not implemented as audit report | Not tested | Audit specification section 28 |
| Cloudflare Pages deployment | Separate API plus SPA dist | `wrangler.toml`, redirects, headers | Production build passes | Deployed origin, cookies, CORS, service worker, rollback | Configured | Blocked by the environment | `wrangler.toml`; `public/*` |
| On-prem Nginx deployment | PHP-FPM/Laravel API, scheduler, DB queue | Nginx-served SPA | Static file inspection only | Actual host, TLS, systemd, cron, firewall, backup/restore | Partial-release risk found | Implemented incorrectly | IA-007, IA-014; `deploy/*` |
| Launch readiness command | `app:launch-check` | Not applicable | Local check executed and failed closed with 7 failures/13 warnings | Required command alias and production-host execution | Required command name absent | Not implemented | IA-013; `LaunchReadinessCheck.php`; `EXECUTABLE_VERIFICATION_RESULTS.md` |
| Code style and static analysis | Pint installed; no PHPStan | ESLint/TypeScript | ESLint/build pass | Fix-free Pint pass and backend static analysis | Pint fails on 38 files | Implemented incorrectly | `BASELINE_TEST_RESULTS.md` |
| TanStack Query implementation | Not present | Custom contexts/API client | Custom cache/client tests | None unless architecture changes | Not used by repository | Not applicable | IA-015; `package.json` and source search |

## Coverage summary

The 220-test Laravel suite and 60-test Vitest suite provide meaningful regression protection. Follow-on verification adds anonymous rejection checks for all 154 protected routes, 17 clean integrity queries on isolated SQLite, a 90/2/1 complete Playwright result, and a 31/31 production-preview subset. The largest remaining gaps are systematic correct-role and object-policy route contracts, valid browser fixtures for two core workflows, concurrency, production-like MariaDB behavior, queue failure handling, deterministic migration parity, PWA user-switch/update behavior, performance percentiles, scalability projections, and live deployment verification.
