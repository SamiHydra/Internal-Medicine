# Status transitions

Every state machine in the platform, with who may cause each move and what is
written when it happens. Statuses are stored lower-case with underscores; the
label the interface shows is in brackets.

## Clinical report

Stored in `reports.status`; `submitted_at` and `locked_at` carry the two
independent facts behind it.

```text
                 save                 submit                 edit a cell
  (no row) ───────────▶ draft ───────────────▶ submitted ─────────────▶ edited_after_submission
                          │                        │                          │
                          │ lock                   │ lock                     │ lock
                          ▼                        ▼                          ▼
                        locked                   locked                     locked
                          │ unlock                 │ unlock                   │ unlock
                          ▼                        ▼                          ▼
                        draft                    submitted                  edited_after_submission
```

| From | To | Caused by | Who | Writes |
|---|---|---|---|---|
| no row | `draft` (Draft) | first save without `submit` | assigned nurse, admin | report row, history "Draft created from the web form." |
| no row | `submitted` (Submitted) | first save with `submit` | assigned nurse, admin | report row with `submitted_at`, history "draft" then "submitted", admin notification, critical-value check |
| `draft` | `draft` | further saves | assigned nurse, admin | values only; no history, no cell audit |
| `draft` | `submitted` | submit | assigned nurse, admin | `submitted_at`, history "Weekly report submitted.", admin notification, alerts |
| `submitted` | `edited_after_submission` (Edited) | a cell changes | assigned nurse, admin | one `audit_logs` row per changed cell, history "Submitted report changed while still unlocked.", admin notification, alerts re-run |
| `edited_after_submission` | `edited_after_submission` | further edits | assigned nurse, admin | more audit rows; status never returns to `submitted` |
| any unlocked | `locked` (Locked) | lock | admin, superadmin | `locked_at`, history "Report locked after review.", nurse notification |
| `locked` | pre-lock state | unlock | admin, superadmin | `locked_at` cleared, history "Report unlocked for correction." carrying the restored status, nurse notification |

Rules: `submitted_at` is written once and never cleared; a lock never writes it;
unlock restores `draft` when `submitted_at` is null, otherwise
`edited_after_submission` when the history carries it or `submitted`. While
locked every save and submit is refused (403), for administrators too.
Comments are allowed in every state.

Derived display states (never stored by the workflow): **Not started** when no
row exists for the week; **Overdue** when a draft's deadline has passed and
enforcement is on, or no row exists after the deadline.

## Action item

Stored in `action_items.status`; every change writes `action_item_status_history`.

| From | May move to |
|---|---|
| `open` (Open) | `assigned`, `in_progress`, `resolved` |
| `assigned` (Assigned) | `open`, `in_progress`, `resolved` |
| `in_progress` (In progress) | `assigned`, `resolved` |
| `resolved` (Resolved) | `open`, `closed` |
| `closed` (Closed) | `open` |

Guards: `assigned` and `in_progress` require an active administrator as
assignee (an explicit null assignee in the same request counts as none);
`closed` requires a resolution note and can only follow `resolved` ("Only a
resolved action item can be verified and closed."). Outstanding statuses for
escalation: `open`, `assigned`, `in_progress`. Severities: `low`, `medium`,
`high`. Overdue is derived from `due_at` while outstanding.

## Transfer request

Stored in `transfer_requests.status`.

```text
pending ──approve (destination head or admin)──▶ approved ──effective date reached (scheduler)──▶ applied
   │
   ├──reject (destination head or admin)────────▶ rejected
   └──cancel (the requesting consultant)────────▶ cancelled
```

An approval carries an effective date: the next rotation boundary by default,
an earlier date only by administrator override, never a past date. Applying
moves the consultant's section and closes the old ward-service assignment.

## Morning session

Stored in `morning_sessions.status`.

| From | To | By |
|---|---|---|
| (none) | `pending` | `academic:open-morning-session` at 00:05 on configured days; start time snapshotted |
| `pending` | `recorded` | a designated recorder on the session day, or an admin; attendance snapshotted |
| `pending` | `cancelled` | a designated recorder on the session day, or an admin |
| `recorded` | `recorded` | an admin correction (audited) |

A pending session past its day stays pending as an oversight signal; recorders
are reminded once, 15 minutes after the snapshotted start.

## Teaching session

Stored in `teaching_sessions.status`.

| From | To | By |
|---|---|---|
| (none) | `pending` | `academic:generate-teaching-sessions` at 00:10 from the batch schedule |
| `pending` | `held` | the representative whose scope covers the activity type and subgroup |
| `pending` | `not_held` | the same representative, with a required reason |
| `pending` | `cancelled` | an administrator |

Attendance per student is recorded on a held session by a consultant or an
administrator.

## Evaluation form version

Stored in `evaluation_forms.status`, one row per version of a form key.

```text
published ──storeDraft (Maintenance)──▶ draft ──updateStructure──▶ draft ──publish──▶ published
                                                                                      │
                                                          previous published ────────▶ archived
```

Exactly one published version per key (database constraint). Content edits
apply to the published version in place. Core fields cannot be removed or
retyped in a draft, and a draft that violates that cannot be published.
Submitted evaluations pin the version they answered.

## Analytics export

Stored in `analytics_exports.status`.

```text
pending ──worker picks up──▶ processing ──file written──▶ ready ──7 days──▶ (download answers 410) ──EXPORT_RETENTION_DAYS──▶ pruned
                                  └──exception──▶ failed
```

Download: owner 200, other administrators 403, missing 404, not yet ready
409, expired 410.

## Access requests

Nurse access request (`access_requests.status`): `pending` to `approved`
(account activated, assignments created, requester notified) or `rejected`
(account stays inactive). Administrator and academic access requests
(`admin_access_requests.status`): `pending` to `approved` (account created
with `password_change_required`) or `rejected`.

## User account

`users.active` is a boolean, not a status: `true` (Active) or `false`
(Inactive). Deactivation is immediate for every layer. A superadmin can never
be deactivated; an administrator can be deactivated only by the superadmin;
nobody can deactivate themselves through the application. `password_change_required`
gates every route except password change and the workspace bootstrap.

## Offline save record (browser)

Stored in IndexedDB, not on the server.

```text
pending ──201──▶ (removed)
   │──network error / 401 / 419──▶ pending (unchanged)
   │──409 stale or exists──▶ conflict (server copy attached)
   │──403, 404, 422──▶ conflict (locked or rejected)
   └──408, 429, 5xx ×5──▶ conflict (exhausted)
conflict ──"Apply my values"──▶ pending (re-based on the server revision)
conflict ──"Keep the server copy" / "Discard"──▶ (removed)
```

See [../workflows/OFFLINE-SYNC.md](../workflows/OFFLINE-SYNC.md).
