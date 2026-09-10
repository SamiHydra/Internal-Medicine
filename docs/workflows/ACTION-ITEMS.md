# Workflow: action items

Clinical governance follow-up: how a submitted value becomes a task, how the
task moves to closure, and how evidence and escalation work. Rules are
numbered as in [../02-BUSINESS-RULES.md](../02-BUSINESS-RULES.md) section 4.

## 1. Two kinds of trigger

**Critical value alerts.** The settings list the critical fields (default:
deaths, pressure ulcers, the hospital-acquired infection counts). When a
submission or a post-submission edit leaves a weekly total above zero,
administrators receive `critical_value_alert`; a later correction to zero
sends `critical_value_corrected` (rule 4.1). These are notifications, not
tasks, unless a rule below matches.

**Clinical alert rules.** An administrator defines a rule on a template
field: operator and threshold, severity (`low`, `medium`, `high`), a response
deadline in hours, the responsible role, the roles to notify, and effective
dates. Rules are versioned. When a submission trips a rule an action item is
created and linked to the report and the rule, with `due_at` set from the
deadline hours (rule 4.2). Administrators can also create action items by
hand from the Action items page (title, severity, optional department,
report, assignee, due time).

## 2. The status chain

```text
open ──▶ assigned ──▶ in_progress ──▶ resolved ──▶ closed
  ▲         │  ▲          │              │  ▲          │
  └─────────┘  └──────────┘              └──┘          │
  (reopen from any state back to open)  ◀──────────────┘
```

| Move | Requires |
|---|---|
| to `assigned` or `in_progress` | an active administrator as assignee; an explicit null assignee in the same request counts as none ("Assign an active administrator before starting this work.") |
| to `resolved` | a resolution note (kept on the item) |
| to `closed` | the item is `resolved` ("Only a resolved action item can be verified and closed.") |
| any other move | must be in the allowed list in [../reference/STATUS-TRANSITIONS.md](../reference/STATUS-TRANSITIONS.md) |

Every move writes `action_item_status_history`; assignment sends
`action_item_assigned` to the assignee.

## 3. Working an item

1. Open **Action items** (clinical workspace). Filter by status (or
   "outstanding"), severity, overdue, department; a notification deep link
   opens the item's sheet directly.
2. Assign it; the status moves to `assigned`.
3. Start work (`in_progress`); add comments as the investigation proceeds.
4. Attach evidence: files up to 10 MB of type pdf, jpg, jpeg, png, doc, docx,
   xls, xlsx, csv or txt. Files are stored outside the web root and
   downloaded through a policy-checked stream. A failed disk write is
   reported as an error, never recorded as a success (rule 4.4). Deleting a
   file is one at a time and audited.
5. Resolve with a note.
6. A second administrator verifies and closes it, or reopens it.

## 4. Escalation

`action-items:escalate-overdue` runs hourly. An outstanding item (`open`,
`assigned`, `in_progress`) whose `due_at` has passed and that has not been
escalated yet sends `action_item_overdue` to the owner and the clinical
administrators, writes an "overdue" history entry, and stamps
`overdue_notified_at` so it is sent once. Changing the due time clears the
stamp (rule 4.5).

## 5. Dashboard and digest

The action-item dashboard service feeds the outstanding counts and overdue
list on the admin dashboard; the leadership digest summarises open items for
the period.

## 6. Where each step is proven

| Step | Tests |
|---|---|
| Rule creation and triggering | `ActionItemTest`, `NotificationsAndOverdueTest` |
| Transitions and guards | `ActionItemTest::test_starting_work_while_clearing_the_assignee_is_refused` and siblings; regression `action-items.spec.ts` I |
| Evidence limits, MIME rules, authorization | `ActionItemTest`, regression J, e2e `failure-recovery.spec.ts` (upload and note) |
| Deep link closes without re-opening | `action-items-deep-link.test.tsx`, regression UI AE-06 |
| Escalation | `NotificationsAndOverdueTest` |
