# Complete Functional, Playwright, Security, Performance, and Scalability Audit

You are a senior software quality engineer, application security engineer, Laravel architect, React architect, database performance engineer, and DevOps reviewer.

Audit the current St. Paul’s Hospital Millennium Medical College Department of Internal Medicine Reporting and Academic Accountability Platform.

The system contains an existing production clinical reporting pillar and newly added academic V2 functionality. Your responsibility is to inspect, test, verify, stress, and analyze the current implementation. Find functional defects, authorization failures, security weaknesses, performance bottlenecks, data-integrity risks, concurrency problems, scalability limitations, migration defects, deployment risks, and maintainability problems.

Do not perform a superficial review. Verify behavior through executable tests, direct code inspection, database inspection, browser testing, and API testing.

## 1. Primary objectives

Complete all of the following:

1. Verify every existing clinical function still works.
2. Verify every implemented V2 academic function against the specification.
3. Build or expand Playwright end-to-end coverage.
4. Test all backend API routes directly.
5. Test permissions, policies, role isolation, and object-level authorization.
6. Check data integrity, historical snapshot behavior, transactions, indexes, and database constraints.
7. Test concurrency and race conditions.
8. Perform a full security review aligned with OWASP guidance.
9. Measure frontend, API, database, queue, scheduler, and analytics performance.
10. Analyze scalability using current and projected data volumes.
11. Inspect production deployment configuration and operational readiness.
12. Produce a complete, evidence-based defect report.
13. Add regression tests for every confirmed defect.
14. Fix verified critical and high-severity defects unless doing so risks changing locked business behavior.
15. Do not hide or silently ignore failures.

## 2. Mandatory safety rules

Before running tests:

1. Confirm whether the environment is local, test, staging, or production.
2. Never run destructive tests against production.
3. Never run `migrate:fresh`, database truncation, mass deletion, stress testing, vulnerability exploitation, or synthetic account creation against production.
4. Use an isolated test database for automated backend tests.
5. Use staging or local infrastructure for Playwright and performance tests.
6. Do not display, copy, log, or commit real patient information, passwords, tokens, session cookies, API keys, database credentials, private certificates, or personal records.
7. Redact sensitive values in screenshots, traces, logs, reports, and test artifacts.
8. Do not weaken authentication, authorization, CSRF protection, validation, TLS, or audit logging to make tests pass.
9. Do not disable existing tests.
10. Do not rewrite assertions merely to accommodate defective behavior.
11. Preserve the clinical reporting pillar.
12. Preserve historical snapshot behavior.
13. Do not introduce Redis or another state-management library.
14. Do not introduce unnecessary architecture changes.
15. Do not use em dashes in user-facing strings, comments, reports, or documentation.

## 3. Required initial repository inspection

Before modifying anything, inspect the repository and document:

- Current branch and commit.
- Working tree status.
- Backend and frontend directory structure.
- Laravel version.
- PHP version.
- Composer dependency versions.
- React, TypeScript, Vite, React Router, TanStack Query, React Hook Form, Zod, Tailwind, Vitest, and Playwright versions.
- Database engine and version.
- Current environment configuration, excluding secrets.
- Authentication configuration.
- Session, cache, and queue drivers.
- Scheduler registration.
- Existing test counts.
- Existing Playwright setup, if present.
- Existing CI workflow.
- Existing linting, formatting, static-analysis, and security tools.
- All registered API routes.
- All frontend routes.
- Permission constants and role mappings.
- Policies and their registered model relationships.
- Database migration status.
- Database indexes and foreign keys.
- Scheduled commands and queue jobs.
- Service worker and PWA configuration.
- Deployment scripts and systemd definitions.

Read representative existing files before adding new patterns:

- One migration.
- One model.
- One policy.
- One API controller.
- One service.
- One admin controller.
- One feature test.
- One React page.
- One React form.
- One TanStack Query implementation.
- One Vitest test.
- Existing clinical analytics caching code.
- Existing template content and structure editing code.
- Existing audit-log implementation.

Follow the existing project conventions.

## 4. Establish the baseline

Run the existing checks before making changes.

### Backend

```bash
cd backend
php artisan about
php artisan route:list
php artisan migrate:status
php artisan test
php artisan test --filter=Academic
composer audit
```

Run any existing formatter, static analyzer, or architecture test already configured.

Examples only, when installed:

```bash
./vendor/bin/pint --test
./vendor/bin/phpstan analyse
./vendor/bin/pest
```

### Frontend

```bash
npm ci
npm run test
npm run lint
npm run build
npm audit
```

Record:

- Total tests.
- Passed tests.
- Failed tests.
- Skipped tests.
- Flaky tests.
- Test duration.
- Build duration.
- Warnings.
- Dependency vulnerabilities.
- Existing failures that were present before the audit.

Do not claim a newly introduced regression when it existed in the baseline.

## 5. Build a requirements-to-test traceability matrix

Create:

```text
docs/TEST_COVERAGE_MATRIX.md
```

For every function, include:

| Requirement | Backend route or service | Frontend page | Existing test | New test | Result | Evidence | Defect ID |
|---|---|---|---|---|---|---|---|

Classify each item as:

- Fully tested.
- Partially tested.
- Not tested.
- Not implemented.
- Implemented incorrectly.
- Blocked by environment.
- Not applicable.

Do not mark a feature as passed based only on code inspection. A passed feature should have executable evidence whenever practical.

## 6. Test account and fixture strategy

Create controlled test fixtures for at least these roles:

- Superadmin.
- Admin.
- Consultant.
- Consultant who is a destination section head.
- Consultant who is not a section head.
- Resident Year 1.
- Resident Year 2.
- Resident Year 3.
- Designated morning recorder.
- Non-designated morning recorder.
- Student representative with group scope.
- Student representative with subgroup A scope.
- Student representative with subgroup B scope.
- Inactive user.
- User without a section.
- User without a duty assignment.
- User on annual leave.
- User on external rotation.
- User on dialysis.
- User on OPD.
- User on Transition duty.
- User with overlapping daily and monthly duties.

Create test data covering:

- All six wards.
- All eight sections.
- Paired ward mappings.
- All duty categories.
- Monthly assignments.
- Daily assignments.
- Rotation calendars.
- Calendar-month blocks.
- Eight-week blocks.
- Transfer requests in every status.
- Current and historical evaluations.
- Multiple evaluation-form versions.
- C1 and C2 student batches.
- Two overlapping C1 batches.
- Both student subgroups.
- Teaching sessions in every status.
- Morning sessions in every status.
- Roster overrides.
- Notifications.
- Audit-log records.

Use factories and seeders rather than fragile direct inserts where possible.

## 7. Playwright architecture

Use Playwright with TypeScript.

Create or verify:

```text
playwright.config.ts
tests/e2e/
tests/e2e/fixtures/
tests/e2e/pages/
tests/e2e/helpers/
test-results/
playwright-report/
```

Use:

- Page-object classes for reusable workflows.
- Authenticated storage state per role.
- API-based test setup where appropriate.
- Isolated test data.
- Stable selectors using `data-testid`.
- No arbitrary sleep statements.
- Assertions based on visible behavior and API outcomes.
- Automatic screenshots, traces, videos, console logs, and network logs on failure.
- Desktop and mobile viewport coverage.
- Chromium as mandatory.
- Firefox and WebKit for critical workflows.
- Parallel execution only after isolation is proven.
- Serial execution for workflows that intentionally share state.

Configure test retries only in CI. A test that passes only after retry must be reported as potentially flaky.

Capture:

- Browser console errors.
- Failed network requests.
- Unhandled promise rejections.
- React warnings.
- Hydration errors.
- Accessibility-critical failures.
- Unexpected redirects.
- Requests returning 401, 403, 404, 419, 422, 429, or 500.

## 8. Authentication and session testing

Test:

### Login

- Correct credentials.
- Incorrect password.
- Unknown user.
- Empty fields.
- Invalid email format.
- Inactive account.
- Repeated failed login attempts.
- Rate limiting.
- Error-message information leakage.
- Login redirect by role.
- Return-to-original-page behavior.
- Session regeneration after login.

### Logout

- Normal logout.
- Logout from multiple tabs.
- Back-button behavior after logout.
- API access after logout.
- Session-cookie invalidation.
- Service-worker cache behavior after logout.

### Sanctum and CSRF

- SPA CSRF cookie acquisition.
- Missing CSRF token.
- Invalid CSRF token.
- Expired session.
- Requests without credentials.
- Cross-origin requests.
- Same-origin production behavior.
- 419 recovery behavior.
- Cookie attributes:
  - Secure.
  - HttpOnly.
  - SameSite.
  - Correct domain.
  - Correct path.
- Session fixation.
- Session reuse after password or account-status changes, when applicable.

### Route guards

For every frontend route:

- Anonymous access.
- Correct role.
- Incorrect role.
- Direct URL entry.
- Browser refresh.
- Client-side navigation.
- Prefetch behavior.
- API denial even if the frontend guard is bypassed.

A hidden navigation item is not an authorization control. Confirm the API returns 403.

## 9. Clinical pillar regression testing

The existing clinical pillar must remain operational.

Test all implemented workflows for:

- Weekly report templates.
- Template publishing and versioning.
- Report creation.
- Draft saving.
- Report submission.
- Submission locking.
- Reopening or correction behavior.
- Approval or review workflows.
- Analytics.
- Excel import.
- Excel export.
- Reminders.
- Action items.
- Comments.
- Audit logs.
- Notification generation.
- Permission restrictions.
- Historical records.
- Date filtering.
- Pagination.
- Search.
- Empty states.
- Validation errors.
- Large Excel files.
- Invalid Excel formats.
- Formula injection risks in exported CSV or Excel content.
- Duplicate import behavior.
- Import transaction rollback.
- Idempotency.
- Failed queue jobs.
- Concurrent edits.
- Lock bypass attempts.

Confirm that academic V2 database changes did not alter clinical behavior, reporting vocabulary, or existing department relationships.

## 10. Academic structure administration

Test ward, section, and duty-type management.

### Wards

- List.
- Create.
- Read.
- Update.
- Activate and deactivate.
- Duplicate name.
- Duplicate slug.
- Missing fields.
- Invalid slug.
- Delete or deactivate a referenced ward.
- Foreign-key behavior.
- Audit logging.
- Unauthorized access.
- Non-admin API request.
- Direct object access with another ID.

### Sections

- Create and update.
- Assign section head.
- Remove section head.
- Assign inactive user as head.
- Assign non-consultant as head.
- Duplicate names and slugs.
- Deactivate a section with consultants.
- Delete behavior with referenced records.
- Audit log.
- Workspace `headsSections` accuracy.

### Duty types

Test all fields and combinations:

- Section-specific duty.
- Department-wide duty.
- Ward service.
- Clinical duty.
- On-call.
- External.
- Leave.
- Monthly granularity.
- Daily granularity.
- Pairing enabled.
- Pairing disabled.
- Ward pairing key.
- Pairing-group key.
- Morning-roster inclusion.
- Morning-roster exclusion.
- Active and inactive status.

Reject invalid combinations, including:

- Pairing enabled with neither ward nor pairing group.
- Invalid category.
- Invalid granularity.
- Inactive referenced ward or section, when prohibited.
- Duplicate slug.
- Missing required fields.

Confirm all mutations create audit records.

## 11. Duty roster and assignment testing

Test `RosterService` and every related endpoint.

### Assignment lookup

- Assignment beginning on the queried date.
- Assignment ending on the queried date.
- Date one day before.
- Date one day after.
- Monthly assignment.
- Daily assignment.
- Multiple daily assignments.
- Monthly plus daily assignment.
- Inactive duty type.
- Inactive user.
- Missing assignment.

### Pairing keys

Verify:

- Ward service returns `ward:<uuid>`.
- OPD returns `group:opd`.
- Transplant returns the expected group key.
- Dialysis returns no key.
- On-call returns no key.
- External rotation returns no key.
- Annual leave returns no key.
- Transition returns the ward key.
- Duplicate keys are removed.
- Monthly plus daily pairing returns both valid keys.

### Pair eligibility

Test:

- Same ward and same date.
- Same ward but non-overlapping dates.
- Shared pairing group.
- Different pairing group.
- One user without an assignment.
- One user on leave.
- One user on an external rotation.
- Two users on Transition duty on the same day.
- Transition duty on different days.
- OPD pairing.
- Transplant pairing.
- Consultant on dialysis.
- Inactive user.
- Invalid role direction.

### Overlap protection

Test:

- Monthly assignment overlapping another monthly assignment.
- Exact date-range duplicate.
- Partial overlap at start.
- Partial overlap at end.
- Contained overlap.
- Adjacent non-overlapping assignments.
- Daily assignment stacked on monthly assignment.
- Multiple daily assignments on one date.
- Two concurrent requests attempting to create overlapping monthly assignments.

The overlap check and insert must be protected by a transaction and appropriate locking. Attempt to reproduce a race condition using parallel requests.

### Bulk assignment

Test:

- Entire valid batch succeeds.
- One invalid row causes complete rollback.
- Duplicate rows.
- Missing user.
- Missing duty type.
- Invalid dates.
- End before start.
- Inactive user.
- Inactive duty type.
- Unauthorized operator.
- Audit behavior.
- Query count.
- Large batch performance.

## 12. Rotation calendar and planner testing

Test:

### Calendar creation

- Year 1 calendar month.
- Year 2 calendar month.
- Year 3 fixed eight-week blocks.
- Duplicate training year and academic-year label.
- Invalid training year.
- Missing block length for fixed weeks.
- Block length provided for calendar month.
- Zero blocks.
- Excessive blocks.
- Invalid start date.

### Block generation

Verify:

- Calendar-month blocks align to calendar boundaries.
- Eight-week blocks are exactly 56 days inclusive according to the system’s date convention.
- No gaps.
- No overlaps.
- Correct block order.
- Correct final date.
- Leap-year handling.
- Start date near month end.
- Re-running generation is safe or explicitly rejected.
- Existing assignments are not silently corrupted.

### Planner

- Load residents by training year.
- Correct rotation groups.
- Save individual plan.
- Save Year 3 group plan.
- Group expansion to every group member.
- Empty group.
- Resident changes group.
- Partial plan.
- Duplicate cell.
- Invalid duty.
- Assignment overlap.
- Transaction rollback.
- Historical plan preservation.
- Query and payload size.

## 13. Consultant transfer workflow

Test:

- Consultant submits request.
- User without consultant eligibility submits request.
- Same source and destination section.
- Missing source section.
- Missing destination section.
- Duplicate pending request.
- Cancel own pending request.
- Cancel approved request.
- Cancel another consultant’s request.
- Destination head sees request.
- Origin head permissions.
- Unrelated head permissions.
- Admin permissions.
- Superadmin permissions.
- Non-head consultant gets 403.
- Destination head approves.
- Destination head rejects.
- Decision reason, when supported.
- Default effective date.
- Immediate admin override.
- Scheduled future application.
- Application exactly once.
- Retry after partial failure.
- Old section assignment closes correctly.
- New section persists correctly.
- Current and historical records remain accurate.
- Notifications reach correct users.
- Every decision writes an audit row.
- Scheduler uses overlap protection.
- Two actors deciding the same request concurrently.

Confirm the system cannot approve an already rejected, cancelled, approved, or applied request.

## 14. Rotation-aware evaluation testing

Test both evaluation directions.

### Form options

- Default date is today.
- Past valid date.
- Future date rejected.
- Date outside current assignment.
- Same-pair peers only.
- Correct opposite role.
- No duplicate subjects.
- Inactive subjects excluded.
- User without assignment.
- User on non-pairing duty.
- Author current placement.
- Ward list comes from `wards`.
- No legacy `homeWardId` dependency.
- Historical date returns historical peers, not current peers.

### Submission

- Resident evaluates consultant.
- Consultant evaluates resident.
- Wrong evaluation direction.
- Subject is self.
- Subject has wrong role.
- Same ward.
- Different ward.
- Shared OPD group.
- Shared Transition day.
- Different Transition day.
- Dialysis user.
- Leave user.
- External user.
- Date boundary.
- Duplicate evaluation, according to current uniqueness rules.
- Client submits forged ward ID.
- Client submits forged placement type.
- Server snapshots the correct ward and placement.
- Rotation changes after submission.
- Historical evaluation still displays original ward and placement.
- Policy and controller produce consistent denial.

### External evaluation entry

Test:

- Admin enters a valid external evaluation.
- Superadmin enters one.
- Consultant attempts entry.
- Resident attempts entry.
- External evaluator name required.
- External department required when specified by the form.
- Author ID cannot also be set.
- Entered-by user is stored.
- Valid external duty slugs only.
- Resident’s actual external assignment is checked when required.
- Historical placement snapshot.
- Audit logging.
- Form validation.
- Duplicate submission.

## 15. Evaluation form engine testing

Test every supported field type:

- Boolean.
- Rating.
- Percent.
- Integer.
- Time.
- Text.
- Single select.
- Multi-select.

For each field type, test:

- Valid input.
- Missing required input.
- Null optional input.
- Wrong type.
- Boundary values.
- Malformed JSON.
- Unknown option.
- Duplicate multi-select options.
- Unexpected additional field.
- Inactive field.
- Very long text.
- HTML and script input.
- Unicode and Amharic content.

### Versioning

Test:

- Exactly one published version per key.
- Draft creation from published version.
- Content edit does not create a version.
- Structural edit creates a draft or new version.
- Publish archives previous published version.
- Historical evaluation keeps original form ID.
- Historical labels remain available.
- Old evaluation renders after field removal from a later version.
- Publishing two versions concurrently.
- Failed publish transaction.
- Version numbering race condition.

### Core fields

Confirm these cannot be removed or type-changed:

- `senior_present`.
- `senior_joined_at`.
- `presence_minutes`.
- `overall_rating`.

Test:

- Admin attempts core-field deletion.
- Superadmin attempts core-field deletion.
- Core field key change.
- Core field type change.
- Core field deactivation.
- Core field label edit.
- Non-core field deactivation.
- Policy and service-level enforcement.

### Unified evaluation invariants

Verify:

- Exactly one subject type is populated.
- Exactly one evaluator source is populated.
- User evaluation.
- Student evaluation.
- External evaluation.
- Invalid combinations rejected at service level.
- Invalid combinations rejected at database level where practical.
- Header and answers save atomically.
- Failed answer insert rolls back header.
- Duplicate field answer rejected.
- Form key matches form ID.
- Unknown field key rejected.

### Migration verification

Run and inspect:

```bash
php artisan academic:verify-migration
```

Verify:

- Source and destination row counts.
- Random deep comparison.
- Booleans.
- Times.
- Integers.
- Percentages.
- JSON values.
- Null handling.
- Ward references.
- Placement types.
- External evaluator fields.
- No duplicate evaluation records.
- No orphaned answers.
- No legacy records silently skipped.

Create an additional deterministic parity test, not only random verification.

## 16. Undergraduate module testing

### Student batches

Test:

- C1 batch.
- C2 batch.
- Correct attachment length.
- Overlapping C1 batches allowed.
- Invalid dates.
- End before start.
- Duplicate label.
- Activation and deactivation.
- Batch with students.
- Delete and foreign-key behavior.
- Audit logging.

### Students

Test:

- Create.
- Update.
- Activate and deactivate.
- Assign subgroup A.
- Assign subgroup B.
- No subgroup.
- Duplicate external ID.
- Unicode names.
- CSV import.
- CSV header validation.
- Duplicate rows.
- Partial invalid file.
- Large file.
- Formula injection.
- Encoding problems.
- Transaction rollback.
- Re-import behavior.
- Authorization.

### Subgroup placements

Test:

- Manual weekly placement.
- Subgroup A and B.
- Two overlapping C1 batches.
- Duplicate batch, subgroup, and week.
- Missing ward.
- Inactive ward.
- Week boundary.
- Historical placement remains unchanged.
- Editing a placement does not rewrite historical session snapshots.
- Audit logging.

### Representative assignments

Test:

- Group representative.
- Subgroup A representative.
- Subgroup B representative.
- One user assigned to multiple scopes.
- Inactive assignment.
- Wrong user role.
- Representative for another batch.
- Expired batch.
- Duplicate assignment.
- Audit log.

### Teaching session generation

Verify seeded schedules:

C1:

- Lecture Monday through Friday.
- Teaching round Tuesday and Thursday.
- Bedside Monday and Friday.
- Seminar Wednesday.

C2:

- Lecture Friday.
- Teaching round Tuesday and Thursday.
- Bedside Monday and Wednesday.
- Seminar Friday.

Test:

- Daily generation.
- Correct cohort scope.
- Correct subgroup scope.
- Correct ward snapshot.
- Missing placement produces flagged null ward.
- Idempotent rerun.
- Overlapping C1 batches.
- Inactive batch.
- Inactive schedule.
- Weekends.
- Holiday behavior where implemented.
- Timezone and date boundary.

### Rep activity recording

Test:

- Group rep records lecture.
- Group rep records seminar.
- Group rep cannot record bedside.
- Group rep cannot record teaching round.
- Subgroup A rep records subgroup A bedside.
- Subgroup A rep cannot record subgroup B.
- Subgroup B equivalent.
- Held.
- Not held with reason.
- Not held without reason.
- Cancelled with reason.
- Cancelled without reason.
- Already recorded session.
- Editing after cutoff.
- Wrong batch.
- Inactive assignment.
- Direct API bypass.
- Audit logging where required.

### Student attendance

Test:

- Consultant records attendance.
- Admin records attendance.
- Representative attempts attendance.
- Correct cohort roster.
- Correct subgroup roster.
- Student from another batch injected into payload.
- Duplicate student.
- Missing student.
- Partial presence list.
- Session status changes to held.
- Existing status behavior.
- Attendance snapshot after student subgroup changes.
- Atomic write.
- Concurrent attendance saves.

### Student evaluations

Test:

- Any consultant may evaluate any student.
- Ward pairing is not required.
- Student weekly form.
- Student final form.
- Weekly ward prefill.
- Weekly start-date snapshot.
- Student outside active attachment.
- Final evaluation timing.
- Duplicate weekly evaluation behavior.
- Unauthorized representative.
- Unauthorized student role, if students have accounts.
- No route exists for students or representatives to evaluate consultants.

### Mandatory representative isolation

Build a route-level test that enumerates every academic evaluation route and verifies a `student_rep` receives 403.

Do not test only one route.

Also verify the workspace bootstrap and frontend contain no evaluation data, score data, assessment data, analytics data, or hidden prefetched evaluation response for representatives.

## 17. Morning session testing

Test:

### Session generation

- Monday.
- Wednesday.
- Friday.
- Tuesday excluded.
- Thursday excluded.
- Saturday excluded.
- Sunday excluded.
- Configured session days changed.
- Idempotent creation.
- Scheduled time snapshot.
- Setting changes after creation do not change historical sessions.
- Scheduler overlap protection.

### Roster

Include:

- Ward-service consultant.
- Ward-service resident.
- Consultant on dialysis.
- Consultant on non-ward internal duty where `counts_for_morning_roster` is true.
- Daily Transition assignment.
- Monthly plus daily assignment without duplicate user.

Exclude:

- Annual leave.
- External rotation.
- Inactive user.
- Duty type configured not to count.

Test overrides:

- Include user.
- Exclude user.
- Start date.
- End date.
- Open-ended override.
- Conflicting include and exclude behavior.
- Duplicate override.
- Historical snapshot.

### Recorder authorization

- Designated recorder.
- Multiple designated recorders.
- Admin.
- Superadmin.
- Non-designated resident.
- Non-designated consultant.
- Representative.
- Removed recorder.
- Direct API bypass.

### Recording

- Started on time.
- Started late with actual time.
- Started late without actual time.
- Client-forged delay.
- Server computes delay.
- Actual start before scheduled time.
- Midnight or malformed time.
- Full attendance roster.
- Partial payload.
- Unknown user.
- Duplicate user.
- User not expected on roster.
- Concurrent record attempts.
- Same-day correction.
- Correction after same day.
- Admin correction.
- Historical attendance unaffected by later roster changes.

### Cancellation

- Reason required.
- Recorder cancellation rules.
- Admin cancellation.
- Already recorded session.
- Already cancelled session.
- Audit logging.

### Reminder

- 08:15 pending session reminder.
- Recorded session receives no reminder.
- Cancelled session receives no reminder.
- Multiple recorders.
- Email failure.
- In-app notification.
- Job retries.
- Duplicate-notification prevention.

## 18. Academic analytics and cache testing

Verify all implemented analytics:

- Evaluation counts.
- Per-person summaries.
- Ward filters.
- Date filters.
- Form-key filters.
- Morning punctuality.
- Average delay.
- Attendance rate.
- Teaching held rate.
- Reasons breakdown.
- Pending backlog.
- Student attendance.
- Weekly evaluation trajectory.
- Weekly versus final comparison.
- Batch rollups.

### Correctness

- Empty dataset.
- One record.
- Multiple wards.
- Multiple form versions.
- Null answers.
- Inactive fields.
- Historical labels.
- External evaluations.
- Date boundaries.
- Invalid filters.
- Unauthorized person-level access.

### Cache behavior

Test:

- First request is a cache miss.
- Identical second request is a hit.
- Different filters create different keys.
- New evaluation changes the content stamp.
- Updated evaluation changes the content stamp.
- Deleted or archived evaluation behavior.
- Cache TTL.
- Concurrent cache fill.
- Cache failure fallback.
- Cache driver failure does not break correctness.
- No cross-user authorization leakage.
- No stale data after mutation.

Measure cache hit and miss duration.

Inspect whether the content-stamp query itself becomes a bottleneck at projected scale.

## 19. Workspace bootstrap testing

Verify every expected field:

- `currentPlacement`.
- `isMorningRecorder`.
- `headsSections`.
- `repScope`.
- `pendingTransferCount`.
- `academicSetup`.

Test:

- Each role.
- User without placement.
- Multiple assignments.
- Daily plus monthly assignment.
- Section head.
- Admin.
- Representative.
- Missing calendars.
- Consultants without section.
- People without assignment.
- Inactive records.
- Window-bounded payload.
- No per-row unbounded data growth.
- No sensitive evaluation data for representatives.
- Query count.
- Payload size.
- Response time.
- Cache behavior, if applicable.

Check for N+1 queries.

## 20. Notifications, queue, and scheduler testing

Inventory every scheduled command and queued job.

Test:

- Correct schedule.
- Correct timezone.
- `withoutOverlapping`.
- Idempotency.
- Retry behavior.
- Maximum attempts.
- Backoff.
- Failure recording.
- Failed-job handling.
- Queue restart behavior.
- Duplicate command invocation.
- Database queue lock contention.
- Long-running jobs.
- Job payload size.
- Serialized model changes.
- Deleted model before job execution.
- Email failure.
- Notification duplication.
- Notification authorization and recipient correctness.

Run scheduler and worker tests in a controlled environment.

Verify:

- Section-transfer application.
- Teaching-session generation.
- Morning-session opening.
- Morning reminder.
- Representative reminder.
- Missing-placement Friday alert.
- Leadership digest.
- Existing clinical reminders.

## 21. API contract and validation testing

For every API route:

- Successful request.
- Anonymous request.
- Authenticated unauthorized request.
- Object-level unauthorized request.
- Missing body.
- Malformed JSON.
- Wrong content type.
- Missing required field.
- Unexpected field.
- Wrong data type.
- Invalid UUID.
- Valid UUID for another tenant or user context, where applicable.
- Nonexistent UUID.
- Inactive referenced object.
- Pagination boundaries.
- Excessive page size.
- Sorting input.
- Filter input.
- Search input.
- Date input.
- Unicode input.
- Very long strings.
- Duplicate submission.
- Replay request.
- Concurrent request.
- Correct status code.
- Stable camelCase response format.
- No stack trace or SQL detail in error response.

Check that each new route has:

1. Permission middleware.
2. Controller policy authorization.
3. Happy-path test.
4. Coarse permission-denial test.
5. Policy-narrowing denial test.
6. Audit test for administrative mutations.

Produce an automated route audit where practical.

## 22. Database integrity review

Inspect migrations, schema, models, and service writes.

Verify:

- UUID primary keys.
- Correct foreign-key actions.
- Restrict deletes for referenced domain records.
- Cascade deletes only for true child rows.
- Nullable foreign keys use correct null behavior.
- Composite indexes exist exactly where required.
- Unique indexes exist.
- Date-range queries use indexes.
- Enum behavior is consistent across MySQL and MariaDB.
- Fillable properties are complete and safe.
- Casts are correct.
- Relationships are typed and accurate.
- No mass-assignment vulnerability.
- No orphaned rows.
- No duplicate answer rows.
- No inconsistent form key and form ID.
- No impossible evaluation subjects.
- No impossible author combinations.
- No duplicate morning attendance.
- No duplicate student attendance.
- No duplicate teaching sessions.
- No duplicate rotation blocks.
- No transfer request applied twice.

Run integrity queries that report:

- Orphaned foreign keys.
- Duplicate logical keys.
- Overlapping monthly assignments.
- Rotation block gaps.
- Rotation block overlaps.
- Evaluations missing answers.
- Answers referencing unknown form fields.
- Historical evaluations missing form versions.
- Student sessions missing a valid batch.
- Attendance rows for students outside the session roster.
- Morning attendance users outside the recorded roster.
- Applied transfers without `applied_at`.
- Published-form keys with zero or multiple published versions.

Document every query and result.

## 23. Transaction and concurrency testing

Identify all write operations that require atomic behavior.

At minimum:

- Assignment overlap check and insert.
- Bulk assignments.
- Rotation planning.
- Transfer approval.
- Transfer application.
- Form publishing.
- Evaluation header and answers.
- Teaching-session generation.
- Teaching attendance.
- Morning attendance.
- Audit log plus administrative mutation.
- Excel import.

Use parallel requests or parallel test processes to test:

- Double submission.
- Lost updates.
- Duplicate creation.
- Overlap race.
- Two section heads deciding one request.
- Two admins publishing form versions.
- Two recorders recording one morning session.
- Two consultants saving attendance.
- Scheduler and manual action running simultaneously.
- Retry after transaction failure.

Look for:

- Missing row locks.
- Incorrect isolation assumptions.
- Deadlocks.
- Non-idempotent retries.
- Partial writes.
- Audit record committed when mutation rolls back.
- Mutation committed without audit record.

## 24. Security audit

Use OWASP Top 10 and relevant OWASP ASVS controls.

### Access control

Test:

- Horizontal privilege escalation.
- Vertical privilege escalation.
- IDOR.
- Forced browsing.
- Parameter tampering.
- Hidden frontend actions.
- Direct API access.
- UUID enumeration.
- Admin-only mutations.
- Section-head decisions.
- Designated-recorder rules.
- Representative scope rules.
- Historical record access.
- Analytics access.
- Export access.

### Injection

Test safely in local or staging:

- SQL injection.
- Stored XSS.
- Reflected XSS.
- DOM XSS.
- CSV or spreadsheet formula injection.
- Log injection.
- Header injection.
- Email content injection.
- Path traversal.
- Command injection in deployment or backup scripts.
- Template injection.
- Malformed JSON.
- Oversized input.

Use harmless proof strings. Do not extract real data.

### CSRF and browser security

Verify:

- State-changing routes require CSRF protection.
- SameSite cookie configuration.
- Secure cookie configuration.
- CORS restrictions.
- No wildcard credentialed CORS.
- Clickjacking protection.
- Content Security Policy.
- X-Content-Type-Options.
- Referrer Policy.
- Permissions Policy.
- HSTS on HTTPS.
- MIME-type handling.
- Mixed-content absence.
- Cache-control on authenticated pages.
- Sensitive API responses are not browser-cached improperly.

### Authentication security

Inspect:

- Password hashing.
- Password policy.
- Login throttling.
- Account enumeration.
- Session expiration.
- Remember-me behavior.
- Password reset, when present.
- Token revocation.
- Inactive-user sessions.
- Concurrent sessions.
- MFA, when present.
- Default credentials.
- Seeded production credentials.

### File and import security

Inspect all upload or import paths:

- MIME validation.
- Extension validation.
- File-size limits.
- Filename sanitization.
- Storage location.
- Executable upload prevention.
- Macro-enabled spreadsheet handling.
- Zip bomb risk.
- CSV formula injection.
- Malformed workbook handling.
- Temporary-file cleanup.

### Sensitive data

Check:

- API responses.
- Logs.
- Exception pages.
- Browser storage.
- React state.
- Query cache.
- Service-worker caches.
- Playwright artifacts.
- Audit logs.
- Notification content.
- Email content.
- Database backups.
- `.env` exposure.
- Source maps.
- Public build files.
- Git history.
- Deployment scripts.

### Dependency and configuration security

Run:

```bash
composer audit
npm audit
```

Also inspect:

- Unsupported packages.
- Known CVEs.
- Debug mode.
- APP_ENV.
- APP_KEY.
- Trusted proxies.
- Host-header handling.
- URL generation.
- TLS verification.
- Database account privileges.
- File permissions.
- Storage permissions.
- Queue worker privileges.
- Web-server user.
- SSH configuration.
- Firewall rules.
- Unattended upgrades.
- fail2ban.
- Backup encryption and permissions.

Do not automatically perform major dependency upgrades during the audit. Report compatibility and remediation risks first.

## 25. PWA and frontend resilience testing

Test:

- Manifest validity.
- Installability.
- HTTPS requirement.
- Service-worker registration.
- Service-worker update behavior.
- Old asset invalidation.
- Offline shell behavior.
- API request behavior offline.
- Clear offline message.
- Failed mutation while offline.
- Duplicate mutation after reconnect.
- Logout clears sensitive cached content.
- User A logs out and User B logs in on the same device.
- No User A data remains visible.
- Stale frontend with newer backend API.
- Backend validation errors.
- Slow network.
- Request timeout.
- API 500.
- API 419.
- API 401.
- API 403.
- Queue-delayed state.
- Browser refresh on nested routes.
- Mobile viewport.
- iOS Safari and WebKit behavior.
- Android Chrome behavior.
- Keyboard-only usage.
- Screen-reader labels.
- Focus management.
- Modal focus traps.
- Color contrast.
- Zoom at 200 percent.
- Long names and translated text.
- Empty states.
- Loading states.
- Error states.

Run Lighthouse or equivalent against a production build.

Record:

- Performance score.
- Accessibility score.
- Best-practices score.
- PWA findings.
- LCP.
- CLS.
- INP or available interaction metric.
- JavaScript bundle size.
- Largest chunks.
- Unused JavaScript.
- Render-blocking resources.

## 26. Performance testing

Use local or staging only.

Prefer k6 for API load testing. Artillery is acceptable if already used.

Create:

```text
tests/performance/
tests/performance/k6/
tests/performance/README.md
```

### Workload profiles

Derive final concurrency from actual expected usage. At minimum test:

1. Single-user baseline.
2. Normal usage.
3. Morning-session peak.
4. Weekly clinical-report deadline.
5. Academic evaluation burst.
6. Analytics dashboard use.
7. Stress test.
8. Short soak test.
9. Queue backlog recovery.

Use provisional tiers when no SLO exists:

- 1 virtual user.
- 10 virtual users.
- 25 virtual users.
- 75 virtual users.
- 150 virtual users.

Do not run 75 or 150 virtual users against production.

### Critical API scenarios

Measure:

- Login.
- Workspace bootstrap.
- Report-template loading.
- Clinical report save.
- Clinical report submit.
- Roster month grid.
- Rotation planner load.
- Rotation planner save.
- Form options.
- Evaluation submission.
- Published form loading.
- Academic analytics.
- Teaching sessions.
- Student attendance save.
- Morning roster.
- Morning attendance save.
- Admin dashboards.
- Notifications list.

Record:

- Requests per second.
- Median.
- p90.
- p95.
- p99.
- Error rate.
- Timeout rate.
- Database CPU.
- Database connections.
- PHP-FPM workers.
- Memory.
- Queue depth.
- Slow queries.
- Lock waits.
- Deadlocks.
- Response sizes.

Unless the project already defines SLOs, use these provisional review thresholds:

- Simple authenticated GET p95 below 500 ms.
- Ordinary write p95 below 800 ms.
- Complex analytics p95 below 1,500 ms on cache miss.
- Cached analytics p95 below 500 ms.
- Error rate below 1 percent under expected load.
- No database deadlocks under expected load.
- No unbounded memory growth during the soak test.
- Workspace bootstrap response remains reasonably small and bounded.
- No single ordinary page causes excessive duplicate requests.

Do not report only averages.

## 27. Database performance analysis

Enable query logging or Laravel query listeners in test only.

For critical routes, capture:

- Query count.
- Duplicate queries.
- Slowest queries.
- Total query duration.
- N+1 patterns.
- Missing eager loading.
- Full table scans.
- Temporary tables.
- Filesort.
- Index selection.
- Returned row count.
- Examined row count.

Run `EXPLAIN` or `EXPLAIN ANALYZE` where supported for:

- Assignment lookup.
- Pairing peers.
- Morning roster.
- Evaluation filtering.
- Evaluation-answer joins.
- Analytics content stamp.
- Student attendance.
- Teaching-session oversight.
- Transfer-request listing.
- Rotation planner.
- Admin roster month grid.

Verify these indexes are present and used:

- Duty assignments by user and date range.
- Duty assignments by duty type and date range.
- Evaluations by subject and date.
- Evaluations by student and date.
- Evaluations by ward and date.
- Evaluations by form key and date.
- Evaluation answers by evaluation and field key.
- Students by batch and subgroup.
- Teaching-session uniqueness and dates.
- Morning-session date.
- Attendance uniqueness.

Check whether EAV analytics loads more answer rows into PHP than necessary. Recommend SQL aggregation, precomputed summaries, or future read models only when evidence shows the existing cache and query design are insufficient.

## 28. Scalability analysis

Use actual database measurements and the specified expected annual growth.

Evaluate at least:

- 1 year.
- 3 years.
- 5 years.
- 10 years.

Model:

- Duty assignments.
- Morning attendance.
- Teaching sessions.
- Student attendance.
- Evaluations.
- Evaluation answers.
- Audit logs.
- Notifications.
- Queue jobs.
- Failed jobs.
- Session rows.
- Cache rows.
- Backups.

Expected high-volume area:

- Evaluation answers may grow by approximately 150,000 to 220,000 rows per year.

Test or estimate:

- Table size.
- Index size.
- Backup duration.
- Restore duration.
- Analytics query duration.
- Migration duration.
- Pagination performance.
- Admin-history performance.
- Cleanup requirements.
- Database connection demand.
- Disk growth.
- Log growth.
- Queue-table growth.
- Session-table growth.
- Cache-table growth.

Check whether old database queue, session, cache, notification, and audit records have retention or cleanup strategies.

Identify the point at which:

- Analytics becomes too slow.
- Backups exceed the operational window.
- Restore time becomes unacceptable.
- Database storage approaches disk limits.
- Queue throughput becomes insufficient.
- A persistent queue worker needs more processes.
- Redis would become justified in the future.

Do not recommend Redis merely because it is common. Base recommendations on measured evidence.

## 29. Deployment and operational audit

Inspect the intended on-premises topology.

Verify:

- Nginx serves the SPA.
- `/api` is proxied correctly.
- PHP-FPM configuration.
- MariaDB configuration.
- Same-origin Sanctum configuration.
- CORS is not unnecessarily permissive.
- HTTPS works on the LAN.
- Certificate renewal works.
- Service worker works with the certificate.
- Queue worker systemd unit.
- Automatic restart.
- Correct working directory.
- Correct user.
- Correct environment.
- `queue:restart` behavior.
- Scheduler cron.
- Scheduler heartbeat.
- Log rotation.
- File permissions.
- Backup script.
- Backup retention.
- Off-box copy.
- Backup integrity check.
- Restore documentation.
- Disk threshold check.
- Certificate-expiry check.
- Secure-cookie check.
- APP_URL check.
- Firewall.
- Hospital subnet restrictions.
- SSH restriction.
- fail2ban.
- Security updates.
- UPS considerations.
- Monitoring.
- Health check.
- Rollback process.

Review scripts for:

- `set -euo pipefail`.
- Quoting.
- Secret exposure.
- Destructive commands.
- Partial-deployment behavior.
- Migration failure.
- Build failure.
- Health-check failure.
- Rollback.
- Concurrent deployment.
- Backup before migration.
- Queue restart.
- File ownership.
- Log output.

Run shellcheck when available.

Test `php artisan app:launch-readiness` and verify each check genuinely fails when its condition is broken.

## 30. Code-quality and maintainability review

Inspect for:

- Fat controllers.
- Business logic inside React components.
- Duplicated authorization logic.
- Policy and controller inconsistency.
- Service classes with excessive responsibilities.
- Unbounded queries.
- Hidden coupling to `home_ward_id`.
- Hard-coded wards, sections, duties, roles, or form fields.
- Hard-coded analytics labels.
- Inconsistent date handling.
- Mutable historical data.
- Missing transactions.
- Missing audit logs.
- Missing type declarations.
- Incorrect model casts.
- Loose TypeScript types.
- `any` usage.
- React effect misuse.
- Unstable query keys.
- Stale TanStack Query data.
- Missing cache invalidation.
- Duplicate requests.
- Broken loading and error handling.
- Runtime-built schemas that differ from backend validation.
- Inconsistent naming between snake_case and camelCase.
- Tests coupled to implementation details.
- Flaky selectors.
- Dead code.
- Deprecated code.
- Commented-out production code.
- Debug statements.
- Sensitive console logging.

Report maintainability issues separately from confirmed functional defects.

## 31. Required defect severity system

Use:

### Critical

- Unauthorized access to confidential data.
- Authentication bypass.
- Privilege escalation.
- Data corruption.
- Permanent historical-record mutation.
- Production-wide outage.
- Backup or restore failure with no recovery.
- Clinical pillar unusable.

### High

- Major workflow unusable.
- Student representative accesses evaluations or scores.
- Incorrect pairing permits or blocks evaluations.
- Broken transaction causes partial writes.
- Transfer applied incorrectly.
- Form versioning corrupts historical rendering.
- Serious stored XSS, SQL injection, CSRF, or IDOR.
- Severe performance failure under expected load.

### Medium

- Important edge case fails.
- Incorrect validation.
- Missing audit row.
- N+1 query with measurable impact.
- Accessibility failure blocking some users.
- Incorrect notification.
- Recoverable stale cache.

### Low

- Minor UI issue.
- Wording problem.
- Non-blocking warning.
- Small maintainability concern.
- Cosmetic inconsistency.

For each defect provide:

- ID.
- Title.
- Severity.
- Confidence.
- Module.
- Requirement.
- Environment.
- Preconditions.
- Reproduction steps.
- Expected result.
- Actual result.
- Screenshots or traces.
- API request and redacted response.
- Relevant logs.
- Relevant code locations.
- Root-cause analysis.
- Data impact.
- Security impact.
- Performance impact.
- Scalability impact.
- Recommended fix.
- Regression test required.
- Fix status.
- Verification status.

## 32. Required output files

Create:

```text
docs/QA_SECURITY_PERFORMANCE_AUDIT.md
docs/TEST_COVERAGE_MATRIX.md
docs/SECURITY_REVIEW.md
docs/PERFORMANCE_AND_SCALABILITY_REPORT.md
docs/DATABASE_INTEGRITY_REPORT.md
docs/DEPLOYMENT_READINESS_REVIEW.md
docs/KNOWN_RISKS.md
tests/e2e/
tests/performance/
```

Where practical, also create:

```text
artifacts/audit/
artifacts/audit/screenshots/
artifacts/audit/traces/
artifacts/audit/api/
artifacts/audit/performance/
```

Do not commit sensitive traces or credentials.

## 33. Final report structure

The main audit report must contain:

1. Executive summary.
2. Overall readiness rating.
3. Baseline test results.
4. Functional coverage summary.
5. Clinical regression result.
6. Academic V2 result.
7. Playwright result.
8. Authorization result.
9. Security result.
10. Data-integrity result.
11. Performance result.
12. Scalability result.
13. Deployment result.
14. Accessibility and UX result.
15. Critical defects.
16. High defects.
17. Medium defects.
18. Low defects.
19. Untested or blocked areas.
20. Recommended remediation order.
21. Go-live recommendation.
22. Exact commands used.
23. Environment limitations.
24. Evidence index.

The go-live recommendation must be one of:

- Ready.
- Ready with documented low-risk exceptions.
- Not ready until critical issues are fixed.
- Not ready until critical and high issues are fixed.

Do not mark the platform ready merely because the existing test suites pass.

## 34. Fixing confirmed problems

After the audit report has been produced:

1. Fix critical issues first.
2. Add a failing regression test before each fix whenever practical.
3. Make the smallest safe correction.
4. Do not change locked business rules.
5. Do not weaken validation or authorization.
6. Preserve API compatibility unless the existing API is insecure.
7. Run focused tests after each fix.
8. Run the complete backend and frontend suites after the fix set.
9. Re-run affected Playwright tests.
10. Re-run affected security tests.
11. Re-run affected performance scenarios.
12. Update the defect status and evidence.

Do not mix unrelated refactoring into security or defect fixes.

## 35. Mandatory final verification commands

Run the project’s actual configured commands. At minimum:

```bash
cd backend
php artisan migrate:fresh --seed
php artisan test
php artisan test --filter=Academic
php artisan academic:verify-migration
php artisan app:launch-readiness
composer audit
```

Then:

```bash
npm ci
npm run test
npm run lint
npm run build
npx playwright test
npm audit
```

Run performance commands documented in `tests/performance/README.md`.

Record exact results, including failures.

## 36. Completion rules

The audit is not complete until:

- Every route has been inventoried.
- Every major workflow has a traceability entry.
- Critical role boundaries have direct API tests.
- Student representative isolation has a full route-list test.
- Historical snapshot behavior has regression tests.
- Concurrency-sensitive writes have been tested.
- Database indexes have been inspected with query plans.
- Analytics cache correctness has been tested.
- Playwright covers all critical user journeys.
- Security findings contain evidence.
- Performance findings contain measured data.
- Scalability findings include multi-year projections.
- Deployment scripts and readiness checks have been reviewed.
- All test commands and results are documented.
- Remaining limitations are stated honestly.

Begin by inspecting the repository and establishing the baseline. Do not begin broad refactoring before the baseline and test matrix are complete.
