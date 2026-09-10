# Offline synchronization model

How the nurse report form behaves when the network is unreliable, what the
server does with a save that arrives late, and what the user sees. This is the
contract the code in `src/lib/offline/report-save-queue.ts`,
`src/context/app-data-context.tsx` (the replay loop), `src/components/reports/`
and `backend/app/Services/Reports/ReportSubmissionService.php` implements, and
the contract `tests/e2e/offline-sync.spec.ts` proves.

Status date: 2026-09-07. Scope: the weekly clinical report form. No other
mutation in the application is queued offline; every other write fails fast
with an error message and keeps the user's input on screen (see
`PRE_SERVER_HARDENING_REPORT.md`, Frontend Failure Handling).

## 1. Principles

1. **Never lose the user's work silently.** A queued save is deleted only when
   the server has accepted it or the user has chosen to drop it.
2. **Never overwrite authoritative server state silently.** A save that was
   composed against a copy the server has since changed is refused (HTTP 409)
   and shown to the user next to the server's copy.
3. **Never bypass authorization or locks.** A queued save is an ordinary API
   request when it replays; it carries no privilege from the moment it was
   queued. An expired session, a lock, a retired assignment or a role change
   refuse it exactly as they would refuse a live save.
4. **Retry only what a retry can fix.** Offline and transient failures retry;
   everything else stops and asks.

## 2. What is queued and how

| Item | Value |
|---|---|
| Storage | IndexedDB database `stpaul-offline-reports`, store `reportSaves`, index `userId`; falls back to `localStorage` key `stpaul:offline-report-save-queue:v1` when IndexedDB is unavailable (private mode, blocked storage). |
| Key | `<userId>:<assignmentId>:<reportingPeriodId>` (URL-encoded parts). One record per report per user; repeated offline saves of the same report **coalesce** into that record. |
| Record | `payload` (the exact `POST /api/reports` body: values, `submit`, `expectedUpdatedAt`), `queuedAt` (first offline save), `updatedAt`, `attempts`, `lastError`, `status` (`pending` or `conflict`), `conflict` (reason, message, HTTP status, time detected, and the server's copy when it sent one). |
| Coalescing rules | Later offline saves replace the values but keep the first `queuedAt` (replay order) and the first `expectedUpdatedAt` (the revision the device last saw from the server). `submit` is sticky: once the user asked to submit offline, the replay submits. |
| Scope | Keyed by user. Signing out or an expired session does **not** clear the queue; a different user signing in on the same device does not see or replay another user's queue. |

A save is queued when the request fails with a network-level error
(`TypeError: Failed to fetch` and equivalents) or when `navigator.onLine` is
false. Any HTTP answer, whatever the status, means the network is up and is
never treated as "offline".

## 3. Lifecycle

```text
                 online save OK
   edit ───────────────────────────────▶ saved (server copy applied to the form)
     │
     │ network error / offline
     ▼
  PENDING  (toast: "Report draft queued offline")
     │
     │ replay: window 'online', tab becomes visible, sign-in, every 30 s,
     │         and "Apply" from the review panel
     ▼
  POST /api/reports with the queued payload
     ├─ 201 ──────────────▶ record removed; form/state updated from the response;
     │                      toast "Offline report save synced."
     ├─ network error ────▶ stays PENDING (message recorded, attempts unchanged); stop this round
     ├─ 401 / 419 ────────▶ stays PENDING, attempts unchanged; the app signs out;
     │                      toast "Your session expired before your offline changes
     │                      could sync"; replay resumes after the next sign-in
     ├─ 409 (stale/exists) ─▶ CONFLICT with the server's copy attached
     ├─ 422 "locked", 403, 404, other 422/400 ─▶ CONFLICT (locked / rejected)
     └─ 408, 429, 5xx, unknown ─▶ attempts += 1; PENDING until attempts reaches 5,
                                  then CONFLICT (exhausted). Never deleted.
```

Replay runs oldest `queuedAt` first, one record at a time, in one tab at a time
(Web Locks `stpaul:offline-report-sync`; browsers without Web Locks fall back to
the per-tab in-flight guard). A round stops at the first offline or
authentication failure and continues past conflicts.

## 4. Stale-write detection (the revision check)

Every save the form makes, online or queued, carries `expectedUpdatedAt`:

- the `updatedAt` of the report as the form loaded it, or
- `null` when the form loaded no report for that week (the client believes it
  is creating the week's first draft).

The server (`ReportSubmissionService::save`) checks it **under the same row
lock it uses for the write**, so two devices saving the same week are
serialised and the second one is told about the first:

| Client sent | Server state | Result |
|---|---|---|
| key absent | any | no check: last write wins (kept for imports and older clients) |
| `null` | no report | save proceeds (creates the draft) |
| `null` | report exists | **409**, reason `exists` |
| timestamp | no report | save proceeds (recreates; nothing to overwrite) |
| timestamp equal to stored `updated_at` (second precision) | | save proceeds |
| timestamp differs | | **409**, reason `stale` |

The 409 body carries the server's current row: `id`, `status`, `lockedAt`,
`updatedAt`, `updatedById`, `updatedByName` and every cell value, in the same
shape the report API already uses. The check precedes the lock check, so a
report locked after the client loaded it answers 409 with `status: locked`
rather than a bare 422; a lock the client already knew about still answers 422
(policy) or 403 (policy on the `PUT` route), as before.

Known limit: `updated_at` has one-second precision. Two saves against the same
loaded copy within the same second cannot be told apart; the per-cell audit
trail on submitted reports remains the record of who changed what.

## 5. Online field-level merge (why a 409 is rare when online)

While the form is open and the app refreshes the workspace (tab focus, sign-in,
the admin poll), the form keeps the user's **dirty** cells and takes the
server's value for every cell the user has not touched, and `expectedUpdatedAt`
moves to the refreshed revision. Two people editing different cells of the same
week online therefore merge without a conflict; only a stale copy that was not
refreshed (offline, or no refresh between load and save) produces a 409.

## 6. What the user sees

| State | Report page | Nurse home / My reports |
|---|---|---|
| Pending | chip "Offline save queued", status line "Changes are queued offline and will sync when the connection returns.", footer "Offline changes queued" | banner "One report save is waiting to sync (Ward for Week)" |
| Synced | toast "Offline report save synced." (silent on the automatic 30 s retry) | banner disappears |
| Conflict | chip "Offline changes need review"; the **review panel** at the top of the form: reason (changed by whom and when, locked, refused, gave up), a table of every cell where "Your value" differs from "Server value", and three actions (below); Save/Submit are disabled until the panel is resolved and autosave pauses | banner "One offline save needs your review", linking to the report |
| Session expired | app returns to the sign-in page; toast explains the changes are kept on the device | after sign-in the queue replays |

Review panel actions:

- **Apply my values over the server copy**: replays the queued payload re-based
  on the server's reported `updatedAt`. It is an explicit, informed overwrite;
  on submitted reports it produces the usual per-cell audit rows. If the server
  changed again in between, a new panel appears with the newer copy.
- **Keep the server copy**: drops the queued record, reloads the server's row
  and puts its values in the grid.
- **Copy my values**: puts the differing cells on the clipboard as text
  (`Field (Day): mine X / server Y`) so nothing is lost even if the user then
  keeps the server copy.

For a **locked** report the panel says so; "Try again" replays and will keep
failing until an administrator unlocks the report, after which the first replay
sees a newer revision (the unlock) and shows a fresh comparison to apply.

The same panel appears for an **online** save that returns 409 (two devices,
stale copy). In that case the refused values are held in the page (not queued);
applying re-sends them with the server's revision; keeping the server copy
reloads the grid.

## 7. Authentication expiry

A queued save never carries credentials of its own; it uses the session cookie
of the moment it replays. When the session has expired (401) or its CSRF token
is gone (419) the API client signs the app out exactly as it does for any other
request, the replay stops without counting an attempt, and the queue stays on
the device. The next sign-in by the **same user** replays it; another user
signing in on the device does not touch it.

## 8. Permanent failure

There is no automatic deletion. After five transient failures a record is
parked as `exhausted` and shown in the review panel with "Try again", "Discard
my changes" and "Copy my values". A save the server rejects for a reason a
retry cannot fix (validation, authorization, a retired assignment) is parked
on the first refusal with the server's message. Records live in the browser
profile until resolved; clearing site data removes them, which the browser
warns about in its own UI.

## 9. Interaction with locks, roles and assignments

- Lock applied while the save waited: the replay answers 409 with the locked
  copy; nothing is written; the user sees the lock and their values.
- Assignment retired or role changed while the save waited: 403; parked as
  `rejected` with the server message; nothing is written.
- Reporting week not yet started (clock skew): 422; parked as `rejected`.

## 10. What is verified and where

| Scenario | Proof |
|---|---|
| A offline save, reconnect, one sync, queue clears, value persists, one status row | `tests/e2e/offline-sync.spec.ts` A |
| B admin locks while a save waits; refused; kept; reviewable; keep-server path | spec B; backend `ReportWorkflowTest::test_a_stale_revision_against_a_locked_report_reports_the_lock` |
| C two devices, stale copy, 409, explicit apply | spec C; backend `test_a_stale_revision_is_refused_with_409_and_the_current_server_values`, `test_expecting_no_report_is_refused_once_a_report_exists` |
| D queued work survives browser restart | spec D (persistent profile; the first reopen runs with the API unreachable) |
| E session expiry during offline work | spec E |
| F flapping network, no duplicate rows, no storms, no duplicate history | spec F |
| G replay order | spec G |
| Queue record semantics, failure classification | `src/lib/offline/report-save-queue.test.ts`, `report-save-queue.conflict.test.ts`, `src/lib/reports/conflict-rows.test.ts` |
| Last-write-wins is kept for callers that send no revision | backend `test_saves_without_a_revision_keep_last_write_wins` |

Not covered on the Vite gate: reloading the page while offline (the service
worker only registers on the production bundle). That path was exercised on
the Docker parity stack during the 2026-09-06 release validation and is part
of the production smoke suite's manual checklist.
