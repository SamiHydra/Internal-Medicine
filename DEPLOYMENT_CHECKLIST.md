# Deployment Checklist: St Paul's Internal Medicine Reporting Platform

**Status date:** 2026-09-06 (after remediation of QA-001 to QA-028)
**Companion documents:** `PRODUCTION_READINESS_AUDIT.md` (original findings, unchanged), `POST_REMEDIATION_AUDIT.md` (what was done per finding), `FINAL_DEPLOYMENT_READINESS.md` (gate results and verdict)

Legend: `[x]` verified in this session, `[ ]` to do on the production host, `[!]` needs a decision or a manual step by the repository owner.

---

## BLOCKERS BEFORE DEPLOYMENT

None of the four original blockers remain:

- QA-001 (`npm run verify` red): fixed, `npm run verify` passes.
- QA-002 (`db:seed` crash): fixed, seed and browser gates run.
- QA-003 (role change kept clinical access): fixed at the transition guard, policies, controllers, payloads and SPA route; verified by tests, API and browser.
- QA-004 (`composer audit` advisories): fixed, audit clean.

## REQUIRED BEFORE GO-LIVE (host-side steps that cannot be done from the repository)

- [x] Branch protection on `main` is applied and verified (required checks Frontend, Backend SQLite, Backend MariaDB, Deployment shell scripts, Isolated Playwright gate; no force pushes or deletion). Re-apply after changes with the command in `.github/BRANCH_PROTECTION.md`.
- [ ] Install the updated PHP-FPM pool (`deploy/php-fpm.conf`, now with 12M/20M upload limits) and reload PHP-FPM; `app:launch-readiness` warns until the pool carries them (QA-005).
- [ ] Install the updated nginx vhost (`deploy/nginx.conf`, now routing `/up` to Laravel) and reload nginx; `deploy.sh` fails its liveness probe until this is done (QA-020).
- [ ] Install the updated `deploy/backup.sh` on the 02:00 cron and run it once by hand; readiness shows `Storage backup fresher than 26h` as WARN until the first archive exists (QA-015).
- [ ] Decide `PASSWORD_BREACH_CHECK` (default `false`; set `true` only if the server can reach `api.pwnedpasswords.com`) (QA-014).

## DATABASE

- [x] Production engine is MariaDB 11.4 (enforced by `app:launch-readiness`); the full backend suite runs green on MariaDB 11.4 / PHP 8.3 in the Docker test lane (see `FINAL_DEPLOYMENT_READINESS.md`).
- [x] All 77 migrations are additive or data-repointing; none drops user data. `down()` methods are best effort only, so restoration is by backup, not rollback.
- [x] First install: `deploy.sh` now runs `php artisan app:seed-reference-data` after `migrate --force` (idempotent, never installs demo accounts); `app:create-superadmin` refuses to run before it (QA-007). Verified from an empty database.
- [x] Dev-only seeders (`Dev*Seeder`) self-guard against `APP_ENV=production`.
- [x] Migration naming rule (QA-021): new files must sort after `2026_10_04_000010_...`; enforced by `MigrationNamingTest`, no existing file was renamed.
- [ ] `2026_09_27_000005_normalize_user_login_identifiers` throws if two users differ only by email case. Run `SELECT lower(email), count(*) FROM users GROUP BY 1 HAVING count(*) > 1` on the production dump before migrating.

## ENVIRONMENT VARIABLES

`/opt/imreport/shared/backend.env` (see `deploy/README.md` step 7 and `backend/.env.example`):

- [ ] `APP_ENV=production`, `APP_DEBUG=false` (the app refuses to boot with debug on in production), `APP_KEY` generated on the host.
- [ ] `APP_URL=https://<internal hostname>`, `FRONTEND_URL` same origin.
- [ ] `DB_CONNECTION=mariadb` plus least-privilege credentials.
- [ ] `SESSION_SECURE_COOKIE=true`, `SESSION_ENCRYPT=true`, `SESSION_SAME_SITE=lax`.
- [ ] `SANCTUM_STATEFUL_DOMAINS=<hostname>` and `CORS_ALLOWED_ORIGINS=https://<hostname>` (no localhost entries).
- [ ] `TRUSTED_PROXIES=*` because nginx terminates TLS.
- [ ] `QUEUE_CONNECTION=database`, `QUEUE_WORKER_MODE=daemon`, `QUEUE_WORKER_SERVICES=imreport-queue.service,imreport-queue-notifications.service`.
- [ ] `MAIL_MAILER` set to a real transport and `SMS_DRIVER=http` with endpoint and token, otherwise reminders and password resets are only written to the log. `app:launch-readiness --strict` warns on both.
- [ ] `BACKUP_DIR`, `SECONDARY_BACKUP_DIR`, `BACKUP_RESTORE_VERIFIED_AT`, `ERROR_MONITORING_CHANNEL`, `MIN_FREE_DISK_GB`.
- [ ] `PASSWORD_BREACH_CHECK=false` unless egress to `api.pwnedpasswords.com` exists; `PASSWORD_BREACH_CHECK_TIMEOUT=5`.
- [ ] `REPORT_WINDOW_LIVE_START` unset in production (the local fixture value must not be copied).
- [x] The stale `.env.production` with decommissioned Supabase credentials was deleted from the working tree (QA-022). `.env.docker` contains a placeholder `APP_KEY` that must never be reused.

Frontend build variables:

- [x] `VITE_API_BASE_URL` is set by `deploy.sh` to `APP_URL`; the browser must be opened on exactly that origin.
- [x] `VITE_RELEASE_SHA` set by `deploy.sh`; `VITE_RUM_SAMPLE_RATE` defaults to a 10 percent sample.
- [x] Reverb variables stay empty; realtime is intentionally disabled and the SPA polls.

## FRONTEND BUILD

- [x] `npm run build` succeeds (entry bundle 59 KB gzip; `npm run perf:budget` passes).
- [x] `npm run lint` passes.
- [x] `npm run test:run` passes (146 tests) and `npm run verify` passes, so `deploy.sh` no longer aborts (QA-001).
- [x] `package.json` declares `engines.node >= 22.12.0`, matching the `deploy.sh` check (QA-023).
- [ ] Node.js 22.12 or newer on the server (`deploy.sh --dry-run` checks this).

## BACKEND

- [x] `php artisan test`: 396 tests, 395 passed, 1 skipped (the MariaDB concurrency test skips on SQLite), 0 failed.
- [x] `composer audit --no-dev`: no advisories (QA-004).
- [x] `composer install` resolves against the `php: 8.3.0` platform pin; the Docker stack builds and tests on PHP 8.3.
- [x] `APP_DEBUG=true` in production throws at boot.
- [x] Config, route and view caches are built by `deploy.sh`; `TRUSTED_PROXIES` is read from the cached config.
- [ ] PHP-FPM pool file `deploy/php-fpm.conf` installed with the upload limits (QA-005); `app:launch-readiness` reports `PHP upload limits cover the 10 MB file rule`.
- [ ] OPcache enabled on the host (readiness warns if not).

## STORAGE

- [x] Uploads (action-item evidence, import files, export files) live on the `local` disk under `shared/storage/app`, never in the web root; downloads stream through policy-checked controllers.
- [x] Uploads up to 10 MB are accepted once the pool limits are installed; larger files and server-limit failures return plain-language 422/413 messages (verified at 3, 9 and 11 MB).
- [x] Every authenticated route renders without horizontal scrolling at 320, 360, 375, 390, 430, 768 and 1280 px (`tests/e2e/mobile-overflow-sweep.spec.ts`, part of the Playwright gate).
- [x] `shared/storage/app` is archived by `deploy/backup.sh` next to every dump (QA-015).
- [ ] Verify `www-data` can write `shared/storage` and `bootstrap/cache` after the first deploy.

## QUEUES / CRON

- [ ] Install and enable both systemd units: `imreport-queue.service` (analytics,default) and `imreport-queue-notifications.service` (notifications,default). Without a worker, Excel and CSV exports stay "pending" forever.
- [ ] Install `/etc/cron.d/imreport` with the per-minute `schedule:run` line and the 02:00 `backup.sh` line.
- [x] The scheduler heartbeat, worker units and backup freshness (database and storage archive) are checked by `app:launch-readiness --strict`.
- [x] Scheduled commands verified via `schedule:list` (19 entries).

## SECURITY

- [x] 150+ authorization probes from the original audit still hold, and the role-change bypass (QA-003) is closed: a nurse cannot change role while reporting assignments are active, and a converted account has no clinical read or write path (API and browser verified).
- [x] Locked reports cannot be edited by anyone until unlocked (QA-027).
- [x] Reports cannot be filed for weeks that have not started (QA-009).
- [x] Workspace revision credential is bound to the sign-in session and revoked on logout (QA-016).
- [x] Public auth routes throttle in separate buckets: login 10/min, forgot and reset 5/min, registration 10/min (QA-024).
- [x] Security headers present on API responses (`nosniff`, `DENY`, `Referrer-Policy`, `Permissions-Policy`, CSP); nginx config carries the document CSP and HSTS.
- [x] Session cookie is HttpOnly and SameSite=Lax; `Secure` is on by default when `APP_ENV=production`.
- [x] No secrets in git. Tracked env files are templates only.
- [x] Branch protection on `main` is active (QA-013).

## BACKUPS

- [x] `deploy/backup.sh`: consistent `mysqldump --single-transaction`, gzip, storage archive of `shared/storage/app`, 30-day rotation, mandatory off-box copy of both files, integrity tests; `deploy.sh` refuses to migrate without a fresh, decompressible dump.
- [ ] Create `/etc/mysql/imreport-backup.cnf` with a dump-only MariaDB account.
- [ ] Mount the secondary backup location before the first `backup.sh` run (the script exits non-zero if it is missing).
- [ ] Run `backup.sh` once by hand after installing it and confirm both `imreport-<stamp>.sql.gz` and `imreport-storage-<stamp>.tar.gz` exist in both locations.
- [ ] Perform the restore drill described in `docs/OPERATIONS.md` (database and files) and set `BACKUP_RESTORE_VERIFIED_AT`; strict readiness fails after 90 days without it.

## CI/CD

- [x] Every job's local equivalent is green after remediation except one Playwright timing budget: frontend (lint, unit tests, build, budget), backend SQLite (composer audit, tests), backend MariaDB (Docker lane), deployment scripts (`bash -n`; ShellCheck runs in CI). The Playwright gate passes every functional, security and responsive spec; the development-server early-navigation budget in `performance.spec.ts` fails in the full local run and passes alone (see `FINAL_DEPLOYMENT_READINESS.md`, Playwright Results).
- [x] Remote CI observed on pull request #3 (run 34048693882): Frontend, Backend SQLite, Backend MariaDB, Mobile Lighthouse budgets (now also the production-bundle interaction budgets) and Deployment shell scripts green; the Isolated Playwright gate failed only on the Linux-font overflow sweep, fixed in `87d0aef`. The re-run result is recorded in `FINAL_DEPLOYMENT_READINESS.md`.
- [x] Workflow triggers on pull requests and pushes to `main`; there is no automatic deploy job, so a red pipeline cannot deploy anything by itself.
- [x] Branch protection requires the five blocking jobs.

## DEPLOYMENT COMMANDS

```bash
# 0. One-time prerequisites (deploy/README.md steps 1-9): accounts, directories,
#    backend.env, PHP-FPM pool, nginx vhost, queue units, cron, backup credentials.

# 1. Dry run until it reports no missing prerequisite
sudo -u imreport /opt/imreport/source/deploy/deploy.sh --dry-run

# 2. Deploy (locks, verifies, backs up, migrates in maintenance mode,
#    seeds reference data on a fresh database, switches atomically,
#    checks the auth wall and /up)
sudo -u imreport /opt/imreport/source/deploy/deploy.sh

# 3. FIRST INSTALL ONLY: create the maintenance account
cd /opt/imreport/current/backend
php artisan app:create-superadmin --email=<email> --username=<username> --full-name="<name>"

# 4. Confirm
php artisan app:launch-readiness --strict
curl -fsS https://<hostname>/up -o /dev/null -w '%{http_code}\n'   # 200
```

## POST-DEPLOYMENT SMOKE TESTS

1. `https://<hostname>/up` answers 200 and `https://<hostname>/api/workspace` answers 401 anonymously.
2. Sign in as the maintenance account; the console shows no errors on the login page or the dashboard.
3. Create an administrator through Users & Access, sign in as them, create a nurse and assign a department; sign in as the nurse, save a draft and submit the current week; the submission appears in Submissions and the audit log.
4. Attempt to change the nurse's role while the assignment is active: the request is refused with the "retire the assignment first" message.
5. Upload a 3 MB evidence file on an action item (accepted) and an 11 MB file (refused with "Files up to 10 MB are allowed.").
6. Open Settings and save an impossible deadline time such as `25:99`: refused.
7. Sign in as a resident on a phone (or a 390 px viewport) and open Home and Submit evaluation: no horizontal scrolling.
8. Sign out; the login page loads with no console error.
9. Check `/var/backups/imreport` the morning after the first night: a dump and a storage archive exist, and `app:launch-readiness --strict` is green.

## ROLLBACK PROCEDURE

Unchanged from the original checklist: `deploy.sh` keeps the previous releases and switches the `current` link atomically; to roll back code, point `current` at the previous release directory and reload PHP-FPM (`deploy/README.md`, "Manual code rollback"). Database rollback is by restoring the pre-migration dump that `deploy.sh` takes before migrating, together with the storage archive from the same run (`docs/OPERATIONS.md`, "Real restore").
