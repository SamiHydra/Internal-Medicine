# Workflow: offline sync

What happens to a nurse's report save when the ward wifi drops, how it comes
back, and what the nurse sees. The full contract, with every failure
classification, is `docs/OFFLINE_SYNC_MODEL.md`; this is the working
summary. Only the weekly report form is queued offline; every other write
fails fast with a message and keeps the user's input on screen.

## 1. Principles

1. Never lose the user's work silently: a queued save is deleted only when
   the server accepted it or the user chose to drop it.
2. Never overwrite the server silently: a save composed against a copy the
   server has since changed is refused (409) and shown next to the server's
   copy.
3. Never bypass authorization or locks: a replay is an ordinary API request
   with the session of the moment it replays.
4. Retry only what a retry can fix.

## 2. The queue

Saves that fail at the network level, or while `navigator.onLine` is false,
are written to IndexedDB (`stpaul-offline-reports`, store `reportSaves`;
`localStorage` fallback), keyed by user, assignment and week. Repeated
offline saves of the same report coalesce into one record that keeps the first
queue time and the first loaded revision; once the user asked to submit
offline, the replay submits.

The service worker keeps the application shell available offline (never API
responses), under a cache name derived from the built asset names, so every
deploy replaces it.

## 3. Replay

```text
PENDING ──replay: 'online' event, tab visible, sign-in, every 30 s, "Apply"──▶ POST /api/reports
   ├─ 201 ──────────────▶ removed; form updated; toast "Offline report save synced."
   ├─ network error ───▶ stays PENDING; the round stops
   ├─ 401 / 419 ───────▶ stays PENDING; app signs out; replays after the same user signs in
   ├─ 409 stale/exists ▶ CONFLICT with the server copy attached
   ├─ 403, 404, 422 ───▶ CONFLICT (locked or rejected)
   └─ 408, 429, 5xx ───▶ attempts += 1; CONFLICT (exhausted) after 5
```

Replay runs oldest first, one record at a time, in one tab at a time (Web
Lock `stpaul:offline-report-sync`), and continues past conflicts.

## 4. Stale-write detection

Every save carries `expectedUpdatedAt`: the report's `updatedAt` as the form
loaded it, or `null` when no report existed. The server checks it under the
row lock it uses for the write:

| Client sent | Server state | Result |
|---|---|---|
| key absent | any | last write wins (imports, older clients) |
| `null` | no report | creates the draft |
| `null` | report exists | 409 `exists` |
| timestamp equal to stored `updated_at` (second precision) | | proceeds |
| timestamp differs | | 409 `stale` with the server copy |

The check runs before the lock check, so a report locked after the client
loaded it answers 409 with `status: locked`. While the form is open and the
workspace refreshes, untouched cells take the server's values and the
revision moves forward, so two people editing different cells online rarely
conflict.

## 5. What the nurse sees

| State | Report page | Home / My reports |
|---|---|---|
| Pending | chip "Offline save queued"; status line "Changes are queued offline and will sync when the connection returns." | banner "One report save is waiting to sync" |
| Synced | toast "Offline report save synced." | banner gone |
| Conflict | chip "Offline changes need review"; the review panel at the top: the reason (changed by whom and when, locked, refused, gave up), a table of every cell where "Your value" differs from "Server value", and the actions below; Save and Submit disabled until resolved | banner "One offline save needs your review" |
| Session expired | back at the sign-in page; toast explains the changes are kept on the device | replays after sign-in |

Review panel actions:

- **Apply my values over the server copy**: replays re-based on the server's
  revision; an explicit, audited overwrite (per-cell audit rows on submitted
  reports). If the server changed again, a new panel appears.
- **Keep the server copy**: drops the queued record and reloads the server's
  row into the grid.
- **Copy my values**: puts the differing cells on the clipboard as text.
- **Try again** (locked, exhausted): replays now.
- **Discard my changes** (rejected, exhausted): drops the record.

## 6. Locks, roles and assignments

- Locked while the save waited: 409 with the locked copy; nothing written;
  after an unlock, "Try again" sees the newer revision and shows a fresh
  comparison. Since 2026-09-10 an unlocked draft comes back as a draft and the
  grid shows the server's saved cells, never an empty grid.
- Assignment retired or role changed: 403, parked as rejected, nothing
  written.
- Week not yet started: 422, parked as rejected.

## 7. The wider continuity loop

Short outage: the queue above. Long outage: an administrator downloads the
import template for the week and department, the ward fills it in Excel, and
the administrator imports it through the same validated submission path
(blank cells on active days clear; malformed groups are skipped and
reported). See [CLINICAL-REPORTING.md](CLINICAL-REPORTING.md) section 9.

## 8. Where each step is proven

| Scenario | Proof |
|---|---|
| Offline save, reconnect, one sync, queue clears | e2e `offline-sync.spec.ts` A |
| Lock applied while a save waits; refused; kept; keep-server; draft restored on unlock | e2e B; `ReportWorkflowTest::test_a_stale_revision_against_a_locked_report_reports_the_lock`; regression `offline-rules.spec.ts` AA-1 |
| Two devices, stale copy, explicit apply | e2e C; backend stale and exists tests; regression AB |
| Queue survives browser restart | e2e D |
| Session expiry during offline work | e2e E; regression AA-4 |
| Flapping network, no duplicates | e2e F |
| Replay order | e2e G |
| Retired assignment, future week | regression AA-2, AA-3 |
| Record semantics and failure classification | `report-save-queue.test.ts`, `report-save-queue.conflict.test.ts`, `conflict-rows.test.ts` |
