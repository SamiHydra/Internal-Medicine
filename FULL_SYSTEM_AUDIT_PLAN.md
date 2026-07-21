# FULL SYSTEM AUDIT PLAN

> **This file is the permanent source of truth for the audit.**
> Do not rely only on conversation context or memory.
>
> At the beginning of every new work session:
> 1. Read `FULL_SYSTEM_AUDIT_PLAN.md` (this file).
> 2. Read `AUDIT_PROGRESS.md`.
> 3. Read unresolved issues in `AUDIT_FINDINGS.md`.
> 4. Continue from the last verified checkpoint.
> 5. Do not restart completed work unless regression testing requires it.

---

# PART 1 - Mandatory Audit Persistence Protocol

Before inspecting, testing, modifying, or running the application, create the following files in the project root:

1. `FULL_SYSTEM_AUDIT_PLAN.md`
2. `AUDIT_PROGRESS.md`
3. `AUDIT_FINDINGS.md`
4. `AUDIT_COMMAND_LOG.md`

## 1. FULL_SYSTEM_AUDIT_PLAN.md

Copy this entire audit instruction into `FULL_SYSTEM_AUDIT_PLAN.md`.

This file is the permanent source of truth for the audit. Do not rely only on the current conversation context or memory.

At the beginning of every new work session:

* Read `FULL_SYSTEM_AUDIT_PLAN.md`.
* Read `AUDIT_PROGRESS.md`.
* Read unresolved issues in `AUDIT_FINDINGS.md`.
* Continue from the last verified checkpoint.
* Do not restart completed work unless regression testing requires it.

## 2. AUDIT_PROGRESS.md

Create a detailed checklist covering:

* System discovery.
* Environment setup.
* Identified roles.
* Account creation for every role.
* Authentication testing.
* Authorization testing.
* Role-by-role workflows.
* Frontend and responsive testing.
* Backend and API testing.
* Security testing.
* Performance testing.
* Database review.
* Scalability review.
* Issue fixing.
* Regression testing.
* Final reporting.

Use these statuses:

* `[ ]` Not started
* `[~]` In progress
* `[x]` Completed
* `[!]` Blocked
* `[F]` Failed

After every meaningful test group, update `AUDIT_PROGRESS.md` with:

* Work completed.
* Roles tested.
* Workflows tested.
* Tests passed.
* Tests failed.
* Current blockers.
* Files created or changed.
* Exact next task.
* Last verified checkpoint.

Never mark an item complete without test evidence.

## 3. AUDIT_FINDINGS.md

Record every confirmed issue immediately when it is discovered.

For each issue include:

* Issue ID.
* Title.
* Severity.
* Category.
* Affected role.
* Affected module.
* Reproduction steps.
* Expected result.
* Actual result.
* Evidence location.
* Suspected root cause.
* Relevant files.
* Fix status.
* Regression-test status.

Do not wait until the end of the audit to record findings.

## 4. AUDIT_COMMAND_LOG.md

Record important commands used during the audit, including:

* Installation commands.
* Application startup commands.
* Migration and seeding commands.
* Playwright commands.
* Test commands.
* Database inspection commands.
* Security scanning commands.
* Performance testing commands.
* Cleanup commands.

Include important command results and failures.

Never store passwords, tokens, API keys, cookies, or other secrets in this file.

## Context-Window Protection

Do not attempt to hold the entire audit state in the conversation context.

Use the project files as persistent working memory.

Before the context becomes large:

1. Finish the current atomic task.
2. Save all findings.
3. Update the progress checklist.
4. Record the exact next action.
5. Save any test evidence.
6. Continue using the saved checkpoint.

Sub-agents must return concise, structured findings rather than large unfiltered logs.

Each sub-agent report must include:

* Scope tested.
* Tests executed.
* Passed tests.
* Failed tests.
* Confirmed issues.
* Evidence paths.
* Files changed.
* Remaining work.

The coordinating agent must merge sub-agent results into the persistent audit files immediately.

Do not repeatedly load every generated report into context. Read only the plan section, progress section, role, module, or unresolved issue needed for the current task.

## Execution Rule

Do not begin the actual audit until:

* The four persistence files have been created.
* The complete audit instructions have been saved.
* The initial checklist has been generated.
* The testing environment has been identified.
* The first checkpoint has been recorded.

After completing these preparation steps, begin the system audit without requesting unnecessary confirmation.

---

# PART 2 - Full Product Functionality, Security, Performance, and Scalability Audit

Perform a complete end-to-end audit of the entire application using **Playwright** and multiple specialized sub-agents.

The goal is to test every major workflow, role, frontend screen, backend endpoint, permission boundary, database interaction, and critical failure scenario. Do not limit the audit to happy-path testing.

## Core Requirements

### 1. Understand the System First

Before testing:

* Inspect the project structure, README files, environment configuration, database schema, routes, API endpoints, authentication system, middleware, role definitions, permissions, seeders, migrations, and existing tests.
* Identify all user roles supported by the application.
* Create a complete role and permission matrix.
* Identify which roles can register directly and which must be created or approved by an administrator.
* Identify all major modules, workflows, forms, dashboards, API integrations, background jobs, file uploads, notifications, and administrative functions.
* Do not assume intended behavior when it can be verified from the code.

Do not make destructive changes to production data. Use the local or designated testing environment.

## 2. Multi-Agent Audit Structure

Use separate sub-agents with clearly divided responsibilities.

### Agent A - Authentication and Authorization

Test:

* Signup for every role that supports public registration.
* Administrator-created accounts for roles that cannot register directly.
* Login and logout.
* Email verification.
* Password reset.
* Remember-me functionality.
* Session expiration.
* Invalid credentials.
* Duplicate email or username registration.
* Weak passwords.
* Disabled, suspended, rejected, deleted, or unverified accounts.
* Direct URL access without authentication.
* Cross-role page access.
* Cross-role API access.
* Privilege escalation attempts.
* Modified role or permission values sent from the browser.
* Access after logout.
* Concurrent sessions.
* CSRF protection.
* Cookie security.
* Token storage and token expiration.
* Account enumeration through error messages.
* Rate limiting for login, signup, password reset, and verification endpoints.

Confirm that every protected action is enforced by the backend, not only hidden in the frontend.

### Agent B - Role-Based User Workflows

For every role:

1. Create a fresh account.
2. Complete signup, verification, approval, onboarding, and profile setup.
3. Log in using the created account.
4. Visit every page available to that role.
5. Complete every major workflow from beginning to end.
6. Test creating, viewing, editing, submitting, approving, rejecting, cancelling, archiving, restoring, exporting, downloading, and deleting records where applicable.
7. Verify that dashboard totals and statuses update correctly.
8. Verify that data created by one role appears correctly for the relevant roles.
9. Verify that users cannot view or modify records belonging to unauthorized users or organizations.
10. Verify the workflow after refreshing the page, opening a new tab, logging out, and logging back in.

Create a clear test matrix containing:

* Role
* Workflow
* Test steps
* Expected result
* Actual result
* Status
* Severity
* Evidence

### Agent C - Frontend and UI/UX

Use Playwright across supported screen sizes.

Test at minimum:

* Desktop.
* Laptop.
* Tablet.
* Mobile.

Inspect:

* Broken layouts.
* Overflow.
* Clipped text.
* Misaligned cards.
* Empty cards.
* Overlapping elements.
* Unreadable text.
* Incorrect spacing.
* Inconsistent typography.
* Broken modals.
* Dropdowns hidden behind other elements.
* Buttons with no response.
* Incorrect loading states.
* Missing error states.
* Missing empty states.
* Missing confirmation dialogs.
* Duplicate submissions.
* Forms losing data unexpectedly.
* Incorrect disabled-button behavior.
* Browser back and forward navigation.
* Refresh behavior.
* Deep-link behavior.
* Keyboard navigation.
* Focus indicators.
* Tab order.
* Form labels.
* Basic accessibility.
* Console errors and warnings.
* Failed network requests.
* Missing assets.
* Broken images.
* Incorrect responsive navigation.
* Slow or visually unstable rendering.

Capture screenshots for every confirmed UI issue.

### Agent D - Backend and API

Inspect and test every important backend route and API endpoint.

Test:

* Valid requests.
* Invalid requests.
* Missing required fields.
* Incorrect data types.
* Boundary values.
* Oversized values.
* Empty values.
* Duplicate records.
* Invalid IDs.
* Deleted IDs.
* Unauthorized access.
* Forbidden access.
* Mass-assignment attempts.
* Modified ownership IDs.
* Modified organization IDs.
* Unexpected HTTP methods.
* Repeated submissions.
* Concurrent updates.
* Failed transactions.
* Partial operations.
* File upload validation.
* Error response consistency.
* Correct HTTP status codes.
* Database rollback behavior.
* Logging behavior.
* Sensitive information exposure.
* Stack traces exposed to users.
* N+1 queries.
* Excessive API calls.
* Missing pagination.
* Unbounded search queries.
* Incorrect caching.
* Stale data.
* Race conditions.

Compare frontend behavior with direct API requests to ensure the backend cannot be bypassed.

### Agent E - Security

Perform a defensive application-security review based on OWASP principles.

Test for:

* Broken access control.
* Insecure direct object references.
* Horizontal privilege escalation.
* Vertical privilege escalation.
* SQL injection.
* Cross-site scripting.
* Stored XSS.
* Reflected XSS.
* DOM-based XSS.
* CSRF.
* Server-side request forgery where relevant.
* Unsafe file uploads.
* Path traversal.
* Command injection where relevant.
* Open redirects.
* Weak password policies.
* Missing rate limits.
* Brute-force exposure.
* Session fixation.
* Predictable identifiers.
* Sensitive information in frontend bundles.
* Secrets committed to the repository.
* Sensitive information in logs.
* Insecure CORS configuration.
* Missing security headers.
* Insecure cookies.
* Improper validation.
* Improper output encoding.
* Mass assignment.
* Over-posting.
* Account enumeration.
* Unsafe password-reset flows.
* Unauthorized exports or downloads.
* Dependency vulnerabilities.

Do not perform destructive exploitation. Use safe test payloads and document the evidence.

### Agent F - Performance and Reliability

Measure actual application behavior rather than making assumptions.

Test:

* Initial page load.
* Authentication response time.
* Dashboard load time.
* Large-table rendering.
* Search and filtering.
* Pagination.
* Form submission.
* File upload and download.
* Repeated navigation.
* Concurrent users.
* Slow network conditions.
* API response times.
* Database query times where measurable.
* Memory usage.
* CPU usage.
* Browser console performance warnings.
* Failed requests under load.
* Timeouts.
* Connection-pool limits.
* Retry behavior.
* Recovery after backend errors.
* Recovery after temporary network loss.

Use realistic test data and controlled load testing. Do not overload production systems.

Identify:

* Slow endpoints.
* Large frontend bundles.
* Excessive JavaScript.
* Unoptimized images.
* Duplicate requests.
* Blocking requests.
* Missing indexes.
* N+1 queries.
* Expensive joins.
* Unbounded result sets.
* Missing pagination.
* Repeated database queries.
* Inefficient dashboard calculations.
* Potential memory leaks.

### Agent G - Database Integrity and Scalability

Inspect migrations, schema design, indexes, foreign keys, constraints, and query patterns.

Evaluate:

* Primary keys.
* Foreign keys.
* Unique constraints.
* Nullability.
* Cascading delete behavior.
* Soft deletes.
* Orphan records.
* Duplicate records.
* Transaction safety.
* Data consistency.
* Audit fields.
* Timestamps.
* Index coverage.
* Composite indexes.
* Search performance.
* Sorting performance.
* Pagination strategy.
* Large-table behavior.
* Concurrent writes.
* Race conditions.
* Lock contention.
* Connection usage.
* Archiving strategy.
* Backup and recovery considerations.
* Growth of logs, sessions, notifications, audit records, and uploaded files.
* Multi-tenant data isolation where applicable.

Estimate likely scalability problems at:

* 1,000 users.
* 10,000 users.
* 100,000 users.
* High concurrent usage.

Clearly distinguish verified defects from predicted scalability risks.

## 3. Playwright Execution Requirements

Create maintainable Playwright tests using:

* Page Object Model or an equivalent reusable structure.
* Separate authentication setup for each role.
* Fresh and isolated test data.
* Unique generated emails and identifiers.
* Automatic screenshots on failure.
* Video recording on failure.
* Trace collection on failure.
* Browser console capture.
* Network request and response monitoring.
* Failed-request logging.
* Test retries only when justified.
* Clear assertions based on expected business behavior.

Run tests in at least Chromium. Run Firefox and WebKit where the application supports them.

Do not mark a test as passed simply because the page loaded. Verify visible content, database effects, status transitions, permissions, and downstream workflow results.

## 4. Test Data

Create sufficient test data to expose real issues:

* Multiple accounts for every role.
* Active and inactive users.
* Verified and unverified users.
* Approved and rejected users.
* Records owned by different users.
* Records in every supported status.
* Empty datasets.
* Large datasets.
* Duplicate and conflicting records.
* Boundary-length text.
* Special characters.
* Unicode text.
* Invalid dates.
* Very old and future dates.
* Large files and unsupported files where applicable.

Ensure test data can be cleaned up safely.

## 5. Issue Classification

Classify every confirmed issue as:

* Critical
* High
* Medium
* Low
* Informational

For every issue provide:

* Unique issue ID.
* Title.
* Affected module.
* Affected role.
* Environment.
* Severity.
* Category.
* Preconditions.
* Exact reproduction steps.
* Expected behavior.
* Actual behavior.
* Screenshot, video, trace, request, response, or log evidence.
* Relevant frontend file.
* Relevant backend file.
* Relevant database table or query.
* Root-cause analysis.
* Security or business impact.
* Recommended fix.
* Regression-test recommendation.

Do not report speculative issues as confirmed defects.

## 6. Fixing and Verification

First complete the audit and establish a clear baseline.

When fixing is permitted:

1. Fix issues in severity order.
2. Avoid unrelated refactoring.
3. Preserve existing business rules unless they are clearly defective.
4. Add automated regression tests for every important fix.
5. Re-run the affected workflow.
6. Re-run the complete role-based test suite.
7. Confirm that the fix did not break another role.
8. Record the files changed and the reason for each change.

An issue is not considered resolved until the original reproduction steps fail to reproduce it and the expected behavior is verified.

## 7. Required Deliverables

Create the following files in the project:

* `FULL_SYSTEM_AUDIT.md`
* `ROLE_PERMISSION_MATRIX.md`
* `FUNCTIONAL_TEST_MATRIX.md`
* `SECURITY_AUDIT.md`
* `PERFORMANCE_SCALABILITY_AUDIT.md`
* `DATABASE_REVIEW.md`
* `PLAYWRIGHT_TEST_REPORT.md`
* `ISSUE_REGISTER.md`
* `FIX_VERIFICATION_REPORT.md`

Also provide:

* Playwright test files.
* Reusable test helpers.
* Test-data setup and cleanup scripts.
* Screenshots.
* Videos for serious workflow failures.
* Trace files.
* Relevant console logs.
* Failed API request evidence.
* Performance measurements.

## 8. Final Summary

At the end, provide:

* Overall product readiness assessment.
* Total tests executed.
* Passed tests.
* Failed tests.
* Blocked tests.
* Issues grouped by severity.
* Issues grouped by role.
* Issues grouped by frontend, backend, database, security, and performance.
* Highest-risk workflows.
* Security-release blockers.
* Scalability-release blockers.
* Recommended fix priority.
* Remaining untested areas.
* Exact commands required to reproduce the tests.

Do not provide a vague summary such as "the application works correctly." Every conclusion must be supported by executed tests, code inspection, logs, screenshots, traces, API evidence, or database evidence.

Continue until every accessible role and major workflow has been tested. When something cannot be tested, explain precisely why it is blocked and what information or dependency is missing.

---

# PART 3 - Environment Notes (project-specific, appended by the auditor)

* **Application:** St Paul's Hospital reporting + academic platform.
* **Frontend:** Vite + React SPA at repo root. Dev server `npm run dev` -> http://localhost:5173
* **Backend:** Laravel + Sanctum in `backend/`. Dev server `php backend/artisan serve` -> http://127.0.0.1:8000
* **Same-origin requirement:** `vite.config.ts` proxies `/api` and `/sanctum` to the backend. Tests MUST drive
  http://localhost:5173, never :8000 directly, or Sanctum SameSite cookies produce "CSRF token mismatch".
* **Dev DB:** SQLite at `backend/database/database.sqlite`, already migrated and seeded. This is the designated
  TESTING environment. There is no production data on this machine.
* **Backend test lane:** `php backend/artisan test` runs on sqlite `:memory:` per `backend/phpunit.xml`.
* **Seeded dev login:** `admin@stpaulos.local` (superadmin). Nurses `abel.gemechu`, `hana.abera`.
  Demo academic staff `demo.{section}.c{n}@` / `demo.{section}.r{n}@stpaulos.local`.
  Credentials themselves are recorded in the operator's private notes, NOT in the audit files.
* **Restore command if the dev DB is damaged:** `php backend/artisan migrate:fresh --seed` (destructive to the
  dev DB only; re-seeds all reference data and dev users).

## Deviations from the instruction, and why

Recorded here so the deviation is auditable rather than silent:

1. **"Do not make destructive changes to production data."** No production environment is reachable from this
   machine. All testing targets the local SQLite dev DB. Load testing is bounded accordingly - SQLite is
   single-writer, so concurrency findings from this lane are indicative, not representative of the MariaDB
   production lane. This limitation is called out wherever a concurrency result is reported.
2. **Scalability estimates at 1k / 10k / 100k users** cannot be empirically measured on this hardware within a
   reasonable budget. They are produced by schema and query-pattern analysis plus measured per-query cost at
   seeded scale, and are labelled **PREDICTED**, never **VERIFIED**, per the instruction's own requirement to
   distinguish the two.
