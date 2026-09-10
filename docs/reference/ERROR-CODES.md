# Error codes

Every status and message the platform returns, and what the user sees. The
API always answers `{ message }`; validation adds `{ errors: { field: [...] } }`;
a conflict adds `{ conflict: {...} }`. The browser shows `message`, or the
first validation error, in a toast or inline.

## HTTP statuses

| Status | When | Message | User sees |
|---|---|---|---|
| 200 | success | | |
| 201 | created (report save, comment, user, assignment, request) | | |
| 202 | accepted (forgot password always; export queued) | | "If the address exists, a reset link was sent." / export listed as pending |
| 204 | logout, deletes, CSRF cookie | | |
| 400 | malformed request | "The request could not be understood." | toast |
| 401 | no session, expired session, non-stateful origin | "Unauthenticated." | the app signs out and returns to the login page (except on auth routes) |
| 403 | permission or policy denied | "This action is unauthorized." | toast; controls stay disabled |
| 403 | inactive account | "This account is inactive." | the app signs out |
| 403 | password change pending | "Password change required." | the change-password screen |
| 404 | unknown record; `details` with an unknown id ("One or more reports could not be found."); export file missing | | toast |
| 408 | client-side timeout | "The server took too long to respond. Please try again." | toast; the save is not queued |
| 409 | stale or duplicate report save; export not ready | "This record was changed by someone else. Reload and try again." (report conflict body below) | the conflict review panel |
| 410 | export expired (7 days) | | toast |
| 413 | body larger than the web server allows | "The uploaded file is too large." | toast |
| 419 | CSRF token mismatch or session token gone | "CSRF token mismatch." | the app signs out; re-priming the cookie on next sign-in |
| 422 | validation | "The given data was invalid." plus `errors` | inline field messages or toast |
| 429 | rate limit | "Too Many Attempts." | toast; wait a minute |
| 500 | unhandled exception | "Server Error" | toast; logged and counted |
| 502 | PHP-FPM unreachable | "Bad Gateway" | toast |
| 503 | maintenance mode or overloaded | "Service Unavailable" | the maintenance page during a deploy |

## Report conflict (409)

```json
{
  "message": "This report was changed since you loaded it.",
  "conflict": {
    "reason": "stale" | "exists",
    "report": { "id", "status", "lockedAt", "updatedAt", "updatedById", "updatedByName", "values": {} }
  }
}
```

| Reason | Meaning |
|---|---|
| `stale` | `expectedUpdatedAt` differs from the stored revision; someone saved in between, or an administrator locked or unlocked the report |
| `exists` | the client sent `expectedUpdatedAt: null` (believed no report existed) but one does |

## Validation messages worth recognising

| Message | Where | Meaning |
|---|---|---|
| "This reporting week has not started yet; reports can only be filed for the current or an earlier week." | report save | future period |
| "Locked reports are read-only." | report save reaching the service without the policy (imports, console) | the report is locked |
| "You are not allowed to edit this assignment." | report save | not the assigned nurse, assignment inactive, or role lacks `reports.submit` |
| "Unknown field key X for this report template." | report save, import | the payload names a field the template does not have |
| "Day X is not valid for this template." | report save, import | outside the template's active days |
| "Field X expects a non-negative whole number." / "...a non-negative decimal value." / "...HH:MM time values." / "...one of the configured choice options." | report save, import | type coercion failed |
| "Field X value is out of range." | report save | above 9,999,999,999 |
| Template rule messages (for example a `sum_lte` rule) under `values` | submit | a blocking consistency rule failed |
| "Retire this nurse's active reporting assignments before changing their role." | user update | role-transition guard |
| "The action item cannot move from X to Y." | action item update | outside the allowed chain |
| "Assign an active administrator before starting this work." | action item update | assigned or in progress without an assignee |
| "Only a resolved action item can be verified and closed." | action item update | |
| "Files up to 10 MB are allowed." | evidence upload | over the size rule |
| "The file failed to upload." | evidence upload | PHP refused it before the application (server upload limit) |
| "The effective date cannot be in the past." | transfer approval | |
| "Fixed-week calendars need a block length in weeks." | rotation calendar | |
| "The expected revision must be a valid timestamp." | report save | malformed `expectedUpdatedAt` |
| "A maximum of 100 report ids may be requested at once." | `/reports/details` | |
| "Admin privileges are required to change report locks." | lock/unlock reaching the service | |
| "You cannot delete this comment." | comment delete | not the author or an administrator |

## Offline conflict reasons (browser only)

Shown in the review panel on the report form; see
[../workflows/OFFLINE-SYNC.md](../workflows/OFFLINE-SYNC.md).

| Reason | Cause | Actions offered |
|---|---|---|
| stale | 409 stale on replay | Apply my values, Keep the server copy, Copy my values |
| exists | 409 exists on replay | same |
| locked | the report was locked while the save waited (409 with `status: locked`, or 422 "Locked reports are read-only.") | Try again (after unlock), Keep the server copy, Copy my values |
| rejected | 403, 404 or a 422 other than the lock message (assignment retired, role changed, week not started, invalid value) | Discard my changes, Copy my values |
| exhausted | five transient failures (408, 429, 5xx) | Try again, Discard my changes, Copy my values |

## Toasts the application produces on its own

| Toast | Cause |
|---|---|
| "Report draft queued offline" | a save failed at the network level or the device is offline |
| "Offline report save synced." | a queued save was accepted on replay |
| "Your session expired before your offline changes could sync" | 401 or 419 on replay; the queue is kept |
| "Unable to lock the report." / "Unable to unlock the report." | the lock endpoint failed; the button re-enables |
| "Unable to load report details." | the details fetch failed; the form shows a retry |
| "Check your email and password and try again." | login failure (any cause) |

## Console and readiness messages

| Message | Source | Meaning |
|---|---|---|
| "APP_DEBUG must be false in production." | boot | the application refuses to start |
| "Liveness check failed: expected 200 from /up, got N. Is the /up location present in the active nginx vhost?" | `deploy.sh` | the post-switch probe failed; rollback follows |
| "Deployment failed. Restoring the previous application release." | `deploy.sh` | automatic rollback |
| "Ignoring /opt/imreport/current: it does not point at a usable release." | `deploy.sh` | first install, no previous release |
| "WARNING Queue health threshold exceeded" | `queue:monitor-health` | depth or oldest job over the threshold |
| "WARNING Slow request" | request timing | over `SLOW_REQUEST_MS` |
| "NOTICE Observability webhook unreachable" | webhook | the collector did not answer; nothing else affected |
| "SQLSTATE[42000]: 1059 Identifier name '...' is too long" | MariaDB migration | an index or constraint name over 64 characters |
| "SQLSTATE[42S01]: 1050 Table already exists" | MariaDB migration | a previous migration failed part-way; restore the dump |
