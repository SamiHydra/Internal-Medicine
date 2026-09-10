# 15. Release and rollback

How a change travels from a branch to the hospital server, how a release is
identified, and how code and data are rolled back. The deploy mechanics are
in [07-INSTALLATION-AND-DEPLOYMENT](07-INSTALLATION-AND-DEPLOYMENT.md); the
recovery procedures in [10-BACKUP-AND-DISASTER-RECOVERY](10-BACKUP-AND-DISASTER-RECOVERY.md).

## 1. Release identity

A release is a git revision. `deploy.sh` names the release directory
`<UTC seconds>-<git revision>` and writes `release.json` (SHA and build
time) into it; the same SHA is baked into the bundle as `VITE_RELEASE_SHA`,
shown in the shell, carried on every log line, in every error report, and in
the smoke suite's optional `SMOKE_EXPECTED_RELEASE` check. There are no
version tags; the SHA and the changelog are the version.

## 2. Before a release

1. The change is on a branch with a pull request against `main`. CI must be
   green on all six jobs; branch protection requires five of them (Frontend,
   Backend SQLite, Backend MariaDB, Deployment shell scripts, Isolated
   Playwright gate).
2. Locally, the same gates: `npm run verify`, `cd backend && php artisan test`,
   `php composer.phar audit --no-dev`, `vendor/bin/pint --test`, and
   `npm run test:e2e` with no dev servers running. For a change that touches
   database behaviour, also the MariaDB lane:
   `docker compose --profile test run --build --rm test`.
3. For a change that touches business rules, the regression harness against
   the dev stack: `npx playwright test --config playwright.regression.config.ts`
   (see [12-TESTING-AND-QA](12-TESTING-AND-QA.md)).
4. For a change that touches `deploy/`, rerun `scripts/chaos/rollback-rehearsal.sh`
   and update the parity twin under `docker/`.
5. Add the change to [reference/CHANGELOG](reference/CHANGELOG.md) and
   update the document that owns the rule.
6. Merge to `main`. Nothing deploys automatically.

## 3. Releasing to the server

```bash
sudo -u imreport /opt/imreport/source/deploy/deploy.sh --dry-run    # prerequisites only
sudo -u imreport /opt/imreport/source/deploy/deploy.sh              # the release
cd /opt/imreport/current/backend && php artisan app:launch-readiness --strict
```

Announce a maintenance minute to the ward if the deadline is near; the
maintenance page is shown for the migration step only.

`deploy.sh` guarantees, in order: exclusive lock, fast-forward of the
checkout, immutable release build, dependency install, migration preview,
full frontend verification, a verified pre-migration backup, maintenance
mode, migration, reference-data seed on a fresh database, cache build, atomic
switch, PHP-FPM reload, auth-wall and `/up` probes, strict readiness, queue
restart, pruning to the last five releases. Any failure after the switch
restores the previous release and exits non-zero.

## 4. After the release: smoke checks

Run the API-level smoke suite from any machine that reaches the host:

```bash
SMOKE_BASE_URL=https://im.hospital.internal \
SMOKE_ADMIN_IDENTIFIER=<maintenance e-mail> SMOKE_ADMIN_PASSWORD=... \
SMOKE_NURSE_IDENTIFIER=<QA_SMOKE_ nurse> SMOKE_NURSE_PASSWORD=... \
SMOKE_ACADEMIC_IDENTIFIER=<resident> SMOKE_ACADEMIC_PASSWORD=... \
SMOKE_REP_IDENTIFIER=<student rep> SMOKE_REP_PASSWORD=... \
SMOKE_ALLOW_WRITE=1 SMOKE_EXPECTED_RELEASE=<short sha> \
npm run test:smoke
```

Fourteen checks in under a minute: liveness, the served build, anonymous API
closed, security headers and secure cookie, Maintenance sign-in and
workspace, both workspaces, health snapshot, nurse sign-in and current week,
nurse refused on admin endpoints, academic account reaches only its surfaces,
student representative reaches only the teaching log, queue and scheduler
moving, sign-out invalidates the session, draft save persists (opt-in write
against the dedicated smoke nurse). Checks that lack their variables report
SKIPPED, never PASS. Check 12 needs the scheduler to have ticked at least
once after the deploy; wait a minute and rerun if it is the only failure.

Then the manual checks from `DEPLOYMENT_CHECKLIST.md`: sign in as
Maintenance with a clean console, create and exercise an administrator and a
nurse on a test ward, confirm a submission reaches Submissions and the audit
log, confirm a role change on an active nurse is refused, an 11 MB evidence
upload is refused, an impossible deadline is refused, and a phone-width
academic page has no horizontal scroll.

## 5. Rolling back code

`deploy.sh` does this automatically when a post-switch check fails. To do it
by hand (a defect noticed after a successful deploy):

```bash
ls -1dt /opt/imreport/releases/*
ln -s /opt/imreport/releases/<GOOD_RELEASE> /opt/imreport/current.rollback
mv -Tf /opt/imreport/current.rollback /opt/imreport/current
sudo systemctl reload php8.3-fpm
cd /opt/imreport/current/backend
php artisan queue:restart
php artisan up
php artisan app:launch-readiness --strict
```

The switch is instantaneous; users' next request runs the older code and the
service worker installs the older shell on their next visit. Five releases
are kept, so the previous four are always available.

## 6. Rolling back data

Migrations are forward-only and every migration must stay compatible with
the previous code release, so a code rollback normally needs no database
change. `migrate:rollback` is never run automatically and should not be run
by hand: `down()` methods are best effort. When a migration itself must be
undone, restore the pre-migration dump `deploy.sh` took and verified (the
stamp is printed in the deploy output and the file sits in
`/var/backups/imreport`), together with the storage archive from the same
run, per [10-BACKUP-AND-DISASTER-RECOVERY](10-BACKUP-AND-DISASTER-RECOVERY.md)
section 5. Entries made after that dump are lost and must be re-filed; say so
to the department before restoring.

## 7. The rollback rehearsal

`scripts/chaos/rollback-rehearsal.sh` runs the real `deploy.sh` control flow
in a throwaway container with stubbed tools, injects a failing post-switch
liveness probe, and asserts that the previous release is restored, maintenance
mode is left, shared data is untouched, and the next deployment succeeds. It
found and fixed the defect that made a first installation impossible
(`docs/ROLLBACK_REHEARSAL.md`). Rerun it whenever `deploy/deploy.sh` changes.
A real rollback on the hospital host is still required once
(`docs/ROLLBACK_REHEARSAL.md` section 7).

## 8. Hotfix path

A hotfix follows the same path with a smaller scope: branch, PR, green CI,
merge, deploy. There is no direct-to-server path; editing files under
`/opt/imreport/current` is never done. If the server must change before CI
can run (an outage), deploy from the branch by pointing the source checkout
at it, then merge afterwards; record it in the changelog.

## 9. Release checklist (copy per release)

- [ ] CI green on the pull request; `main` fast-forwards.
- [ ] Local gates green (verify, backend, audit, pint, e2e; MariaDB lane if schema touched).
- [ ] Changelog and owning documents updated.
- [ ] Maintenance window agreed if a migration is included.
- [ ] `deploy.sh --dry-run` clean, then `deploy.sh`.
- [ ] `app:launch-readiness --strict` green.
- [ ] Smoke suite 14 of 14 (check 12 after a minute).
- [ ] Manual checks from `DEPLOYMENT_CHECKLIST.md`.
- [ ] Release SHA recorded with the date in the changelog.
