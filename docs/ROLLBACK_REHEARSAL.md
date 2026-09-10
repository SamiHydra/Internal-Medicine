# Rollback rehearsal

The deployment script claims it restores the previous release when a deploy
goes wrong. This is the record of that claim being tested, the defect the test
found, and the result after the fix.

Date: 2026-09-07. Harness: `scripts/chaos/rollback-rehearsal.sh`.
Evidence: `artifacts/chaos/rollback-verified/` (transcripts of all three
deployments, the call log and the report quoted below).

## 1. What was rehearsed, and what was not

**Rehearsed, for real:** the whole control flow of `deploy/deploy.sh` as it
stands in the working tree, on Linux, with a real git repository, real release
directories, the real symlink switch, the real ERR trap and the real ordering:
build, verify, pre-migration backup, maintenance mode, migrate, seed reference
data, cache, switch, reload, strict readiness, leave maintenance, auth-wall
probe, `/up` probe, queue restart, prune old releases.

**Stubbed:** the tools the script shells out to (`php`, `composer`, `npm`,
`curl`, `sudo`/`systemctl`, `gunzip`, and the backup script). Each stub records
its invocation and returns the outcome the scenario requires. No database is
touched and no migration runs.

**Therefore:** this proves the rollback *mechanism*, not a full application
deployment. Installing the real thing once on the hospital host is still a
required step (`docs/PRODUCTION_LAUNCH_CHECKLIST.md`).

**Isolation:** a throwaway `debian:bookworm-slim` container with the repository
mounted read only and a scratch `/work` as `APP_ROOT`. Nothing on the developer
machine, and nothing in the parity stack, is written to.

## 2. The controlled failure

No migration is corrupted and no data is damaged. The injected fault is the
one an operator most plausibly meets: **the new release is switched in, and the
post-switch liveness probe does not answer 200.** The stubbed `curl` returns
503 for `/up` while a marker file exists, which is exactly what a release that
boots but cannot serve would look like to the script.

The second deployment also carries a new commit, so a genuinely different
release directory is built and activated before the probe fails.

## 3. Result

| Item | Value |
|---|---|
| Rehearsal run | 2026-09-07, container `debian:bookworm-slim` on Linux 6.18 (WSL2) |
| Release before | `20260907125921-40cc1aa65253` |
| Failed release | the same second's build of `53197f056de9` (the commit adding `REHEARSAL_MARKER`) |
| Release after | `20260907125921-40cc1aa65253` (the previous one) |
| Rollback trigger | `Liveness check failed: expected 200 from /up, got 503. Is the /up location present in the active nginx vhost?` |
| Rollback message to the operator | `Deployment failed. Restoring the previous application release.` followed by the database warning |
| Exit code | 1 (non-zero, so a wrapper or cron notices) |
| Rollback duration | 239 ms for the whole failed deployment including build, failure and rollback (the stubs make the build instant; on the host the rollback itself is a symlink swap plus an FPM reload, and the build time is what it is) |
| Previous release restored | YES |
| Failed release's marker file present in the restored release | NO |
| Maintenance mode left | YES (`php artisan up` ran on the previous release) |
| `/up` after rollback | 200 |
| Auth wall after rollback | 401 |
| Shared database marker | intact |
| Shared storage marker | intact |
| Failed release directory | kept on disk (2 release directories), so it can be inspected |
| Pre-migration backups taken | 2 (one per deployment attempt), verified with `gunzip -t` before migrating |
| PHP-FPM reloads recorded | 3 (activate, rollback, next deploy) |
| Queue restarts recorded | 2 (only on releases that passed their checks) |
| Deployment after the failure | SUCCEEDED, release `20260907125924-53197f056de9`, `/up` 200 |

Verdict: **PASS.** The failed release was refused, the previous one came back,
the application was left serving and out of maintenance mode, shared data was
untouched, and the next deployment worked normally.

## 4. The defect this rehearsal found

**A first installation of the platform could never succeed.**

`deploy.sh` derived the previous release with:

```bash
PREVIOUS_RELEASE="$(readlink -f "${CURRENT_LINK}" 2>/dev/null || true)"
```

`readlink -f` canonicalises a path whose final component does not exist and
still exits 0. On a host with no `current` symlink yet (the very first deploy)
`PREVIOUS_RELEASE` was therefore set to `/opt/imreport/current`, the script
believed a previous release existed, and at "Entering maintenance mode" it ran
`cd /opt/imreport/current/backend`, which does not exist. Under `set -e` that
aborted the deployment and fired the rollback path, every time.

Observed in the first rehearsal run:

```
==> Entering maintenance mode
/work/source/deploy/deploy.sh: line 168: cd: /work/current/backend: No such file or directory
Deployment failed. Restoring the previous application release.
```

This was never caught before because `deploy.sh --dry-run` only checks
prerequisites, and the earlier fresh-install verification ran the individual
artisan commands by hand rather than the script.

**Fix** (`deploy/deploy.sh`): treat the previous release as empty unless the
link exists *and* points at a directory that actually holds a release.

```bash
PREVIOUS_RELEASE=""
if [ -L "${CURRENT_LINK}" ] || [ -e "${CURRENT_LINK}" ]; then
  PREVIOUS_RELEASE="$(readlink -f "${CURRENT_LINK}" 2>/dev/null || true)"
  if [ ! -d "${PREVIOUS_RELEASE}/backend" ]; then
    echo "Ignoring ${CURRENT_LINK}: it does not point at a usable release." >&2
    PREVIOUS_RELEASE=""
  fi
fi
```

After the fix the first deployment succeeds (it skips maintenance mode, as it
should, because there is nothing to take down) and the rollback path still
behaves correctly on the second one. Both are asserted by the rehearsal, which
is why the rehearsal is kept as a script rather than a one-off.

## 5. Second observation (rehearsal artefact, not a product defect)

`RELEASE_ID` is `<UTC seconds>-<git revision>`. Because the stubs make a whole
deployment take milliseconds, the rehearsal's three deployments of one revision
originally collided on the same release directory and the third failed with
`ln: failed to create symbolic link .../backend/.env: File exists`. Real
deployments are minutes apart, and two deployments of the same commit within
one second is not a scenario worth engineering for; the rehearsal now spaces
its deployments by a second. Recorded here so the next reader does not mistake
it for a defect.

## 6. Repeating it

```bash
scripts/chaos/rollback-rehearsal.sh                    # writes artifacts/chaos/rollback-<stamp>/
cat artifacts/chaos/rollback-*/state/report.txt        # the table above
cat artifacts/chaos/rollback-*/state/deploy-2.log      # the failed deployment transcript
cat artifacts/chaos/rollback-*/state/calls.log         # every tool the script invoked, in order
```

Re-run it whenever `deploy/deploy.sh` changes; `docs/PARITY_ENVIRONMENT.md`
lists that as a required follow-up.

## 7. What still needs the real host

- One real `deploy.sh --dry-run` until it reports no missing prerequisite.
- One real first installation, including `app:create-superadmin` and
  `app:launch-readiness --strict`.
- One real rollback: deploy, then point `current` back at the previous release
  and reload PHP-FPM by hand (`deploy/README.md`, "Manual code rollback"),
  confirming the application serves the older bundle afterwards.
- A database rollback is deliberately **not** part of the script: migrations
  are forward-only and recovery is by restoring the pre-migration dump the
  script takes and verifies before every migration (`docs/OPERATIONS.md`).
