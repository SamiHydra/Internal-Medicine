# 13. Troubleshooting

Symptom, cause, fix. Grouped by who notices the problem first. When a fix
says "check the log", the paths are in [09-OPERATIONS-MANUAL](09-OPERATIONS-MANUAL.md)
section 4.

## 1. Signing in and sessions

| Symptom | Likely cause | Fix |
|---|---|---|
| "CSRF token mismatch" or 419 on login | The page was opened on an origin that is not in `SANCTUM_STATEFUL_DOMAINS`, or `VITE_API_BASE_URL` points elsewhere (for example `127.0.0.1` instead of `localhost`, or `:8000` instead of the Vite origin) | Open the exact origin the bundle was built for; locally that is `http://localhost:5173`. In production check `APP_URL`, `SANCTUM_STATEFUL_DOMAINS`, `CORS_ALLOWED_ORIGINS` |
| Login says the credentials are wrong for a known-good account | The account is inactive, or the identifier has a typo; both answer the same way on purpose | An administrator checks Users & Access; reactivate or reset the password |
| "Too Many Attempts." | 10 logins per minute per IP (shared by ward computers behind one address) | Wait a minute. Locally, `POST /api/testing/flush-rate-limits` |
| Every page after login says 403 | The account must change its password first | Use the change-password screen; nothing else answers until then |
| Signed out unexpectedly | Session expired (120 minutes idle), the account was deactivated, or the password was changed in another session | Sign in again; queued offline saves are kept |
| Sign-in works on the desktop but not on a phone | The internal CA is not trusted on the device | Install `rootCA.crt` per [09-OPERATIONS-MANUAL](09-OPERATIONS-MANUAL.md) section 6 |

## 2. Reports and the weekly form

| Symptom | Likely cause | Fix |
|---|---|---|
| "This reporting week has not started yet" | The period selected is in the future | File the current or an earlier week |
| The report shows Overdue although it was saved | A draft past the deadline shows the derived Overdue state while enforcement is on; the stored status is still draft | Submit it. Overdue disappears on submission |
| Save or submit answers 403 with "This action is unauthorized." | The report is locked (administrators too), the assignment was retired, or the account lost `reports.submit` | Ask an administrator to unlock, or to re-activate the assignment |
| A conflict panel appears after saving | Another device or person changed the report since it was loaded (409 stale), or the client thought no report existed (409 exists) | Compare values, then "Apply my values" or "Keep the server copy" |
| The panel says the report was locked | An administrator locked it while the save waited | Ask for an unlock; "Try again" then shows a fresh comparison |
| Cells are empty after a reload although they were saved | Values load after the grid renders; wait for "Loading saved cells" to finish. Before 2026-09-10 a locked-then-unlocked draft could render empty and a save would clear cells; fixed in the report-summary merge | Reload; if cells stay empty, check the network tab for a failed details request |
| "Offline save queued" never clears | The device is still offline, or the session expired | Reconnect; sign in; the queue replays for the same user |
| Metrics show as dashes on an inpatient report | The department has no bed count | An administrator sets `bedCount` on the department |
| A field is missing from the form | The field was soft-disabled or the template's active days exclude that day | Templates page; historical values are kept |

## 3. Administration

| Symptom | Likely cause | Fix |
|---|---|---|
| An administrator cannot edit or deactivate another administrator | By design; only Maintenance may | Ask the Maintenance holder |
| "Retire this nurse's active reporting assignments before changing their role." | The role-transition guard | Retire the assignments first, then change the role |
| Cannot delete a department or template | It is referenced by assignments, reports or fields | Deactivate it instead |
| Structural template or form edit is refused | `templates.editStructure` and `evaluationForms.editStructure` are Maintenance-only | Ask the Maintenance holder; content edits (labels, order, options) are open to administrators |
| A settings save is refused with a validation message | Times must be `HH:MM` (`25:99` is refused); thresholds positive; recorder ids must exist | Correct the value |
| Import reports "skipped" groups | A malformed group (unknown field key, invalid day, bad value) is skipped and reported; the rest is applied | Read the error list, fix the sheet, re-import those rows |
| Export stays "pending" | No queue worker is running (locally: no `queue:work` terminal; server: a unit stopped) | Start the worker; the job then finishes within seconds |
| Export download answers 403 | Only the administrator who requested it may download it | Request a new export |
| Export download answers 410 | The file expired after seven days | Request a new export |
| Reminders, digest or reset e-mails do not arrive | `MAIL_MAILER=log` or the notification worker is down | Check `imreport-queue-notifications.log`; configure the transport |
| A nurse's action item cannot move to "in progress" | It has no assignee, or the request cleared the assignee | Assign an active administrator first |
| Evidence upload says "Files up to 10 MB are allowed." | The file is over the rule | Compress or split it |
| Evidence upload says "The file failed to upload." at 3 MB | The PHP-FPM pool limits were not installed (`upload_max_filesize` 2M) | Install `deploy/php-fpm.conf`, reload PHP-FPM; readiness warns about this |

## 4. Academic

| Symptom | Likely cause | Fix |
|---|---|---|
| A resident cannot find a consultant to evaluate | Eligibility comes from the roster: the two must share a placement on that date | Check the duty roster and rotation plan for the date |
| The morning session page says "cannot record" | The user is not a designated recorder, or the session is not today's | Add the user to Morning recorders in Settings; only same-day sessions can be recorded |
| No morning session opened today | Today is not a configured session day, or the scheduler is down | Check `morningSessionDays`; check the heartbeat |
| A representative cannot log a session | The activity type or subgroup is outside the representative's scope, or the rep assignment is inactive | Check the rep assignment's scope (group: lectures and seminars; subgroup: bedside and teaching rounds) |
| A transfer approval is refused | The decider is not the destination section's head and not an administrator, or the effective date is in the past | The head decides, or an administrator overrides with today or later |
| A transfer is approved but the consultant is still in the old section | Transfers apply at the effective date (next rotation boundary by default) by the 00:15 job | Wait for the date, or an administrator re-approves with an earlier effective date |
| Publishing a form draft is refused | The draft removes or retypes a core field | Restore the core field in the draft |

## 5. Server and operations

| Symptom | Likely cause | Fix |
|---|---|---|
| `app:launch-readiness --strict` fails | A named check; each line says why | [09-OPERATIONS-MANUAL](09-OPERATIONS-MANUAL.md) section 1 |
| The application refuses to boot: "APP_DEBUG must be false in production." | `APP_DEBUG=true` in `backend.env` | Set it to `false`, `config:cache`, reload PHP-FPM |
| 502 from nginx | PHP-FPM is down, or (parity stack) the `app` container was recreated and nginx cached the old address | `systemctl restart php8.3-fpm`; on parity `docker compose restart web` |
| Scheduler heartbeat stale | cron stopped, or `schedule:run` fails | `systemctl restart cron`; read `schedule.log` |
| Queue depth climbing | A worker unit stopped or is stuck on a slow delivery | Restart the unit; never redirect analytics work to the notification worker |
| Backup check fails | `backup.sh` did not run, the secondary mount is missing, or the dump account lost privileges | `tail /var/log/imreport-backup.log`; run `backup.sh` by hand |
| Disk filling | Old backups, logs, or export files | Prune per retention; `app:prune-operational-data --dry-run` shows what would go |
| Migration failed on MariaDB with "Table already exists" | A previous migration failed part-way (no transactional DDL) | Restore the pre-migration dump; on parity `docker compose down -v` |
| Migration refuses: two users differ only by e-mail case | `normalize_user_login_identifiers` guard | Merge or rename one of the accounts before migrating |
| Deploy aborted with "Liveness check failed: expected 200 from /up" | The nginx vhost lacks the `/up` location, or PHP-FPM did not reload | Install `deploy/nginx.conf`; the script already rolled back |
| Deploy aborted at frontend verification | Lint, unit tests or the bundle budget failed | Fix on a branch; nothing was switched |
| Users still see the old version after a deploy | The service worker installs the new shell on the next visit | Reload once; the cache name changes with every build |
| "database is locked" (SQLite, development only) | Several writers on the dev database | Retry; irrelevant on MariaDB |

## 6. Developer environment

| Symptom | Likely cause | Fix |
|---|---|---|
| `npm run test:e2e` cannot bind 5173 or 8000 | Dev servers or a stale `node` or `php` process are listening | Stop them; on Windows `Get-NetTCPConnection -LocalPort 5173` to find the owner |
| Playwright "Invalid hook call" everywhere | A Vite config was loaded from outside the repository (two React copies) | Run the untouched `npm run dev` and point the backend at another database with env vars |
| Backend tests fail after a fresh clone | No `APP_KEY` or no `.env` | `cp .env.example .env && php artisan key:generate` |
| `php -d upload_max_filesize` has no effect on `artisan serve` | Options do not reach the spawned workers | Use `PHP_INI_SCAN_DIR` with an extra `.ini` |
| CI e2e fails only on the Linux-font overflow sweep | Wider fallback fonts on `ubuntu-latest` | Reproduce with the Playwright Docker image; add `flex-wrap` or stack the header |
| Pint fails in CI but not locally | Different Pint version or a file written with CRLF | `vendor/bin/pint` locally; commit the result |

## 7. Getting more information

- The health view (`/admin/system-health`) for a live snapshot.
- `laravel.log` filtered by `release=` for the current build.
- The browser console and network tab for the failing request; the API
  answers `{ message }` and, for validation, `{ errors }`.
- [reference/ERROR-CODES](reference/ERROR-CODES.md) for every message the
  platform can return.
