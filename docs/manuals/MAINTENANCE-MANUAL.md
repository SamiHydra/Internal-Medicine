# Maintenance manual

For the holder of the single protected owner account (role `superadmin`,
shown as **Maintenance**). You can do everything an administrator can
([Administrator manual](ADMIN-MANUAL.md)) plus four things nobody else can,
and you are the application-side counterpart of Hospital IT
([IT operator manual](IT-OPERATOR-MANUAL.md)).

## 1. The account

- Created once on the server with `php artisan app:create-superadmin`; the
  command refuses if a superadmin exists. The generated password is printed
  once; change it at first sign-in.
- Cannot be deactivated, demoted or deleted through the application by
  anyone, including yourself.
- Keep the credentials in the department's password store; there is no
  self-service recovery beyond the e-mail reset, which needs a working mail
  transport.

## 2. What only Maintenance can do

| Ability | Where | Notes |
|---|---|---|
| Create administrators directly | Users & Access, or `/admin/manual-admin-setup` | The created account must change its password at first sign-in. Administrators can otherwise only arrive through the sign-up queue, which any administrator may approve |
| Deactivate an administrator | Users & Access roster | Administrators cannot touch each other |
| Structural edits to report templates | Templates | rename a field key, change a type, add or remove fields. Content edits are open to administrators |
| Structural edits to evaluation forms | Forms: **Create draft**, edit structure, **Publish** | creates a new version; previous answers keep their version; core scoring fields cannot be removed or retyped and a draft that tries cannot be published |
| System health | `/admin/system-health` | the live health view (section 4) |

## 3. Creating and retiring administrators

1. Users & Access, create user with role Administrator (or approve a pending
   administrator request).
2. Give the temporary password by a separate channel; the account is forced
   to change it.
3. When an administrator leaves, deactivate the account (never delete; the
   audit trails reference it). Their exports expire on their own.

## 4. System health

`/admin/system-health` mirrors `php artisan app:launch-readiness` for someone
not at the console: overall status, the running release, database latency
and pending migrations, queue depth and oldest job per queue, failed jobs
(24 hours and total), scheduler heartbeat age, backup ages (dump, storage
archive, off-box copy), free disk and storage writability, mail and SMS
transport names, hourly error counters (exceptions, server errors, slow
requests, failed jobs, client errors), and the readiness table.

Look at it daily. What each failing line means and what to do is in the
[Operations manual](../09-OPERATIONS-MANUAL.md) section 1. Anything you
cannot fix from the application (a stopped service, a missing backup mount,
a certificate) goes to Hospital IT.

## 5. Structural changes safely

- **Report template field changes**: announce them, make them between
  reporting weeks, and remember that renaming a key changes the meaning of
  historical analytics for that field. Prefer adding a new field and
  soft-disabling the old one.
- **Evaluation form changes**: draft, adjust, publish. Historical evaluations
  render against their own version; rankings use field keys, so keep the
  core keys intact. Verify a published version by submitting a test
  evaluation on the parity stack first if the change is large.
- Every structural change is audited under your name.

## 6. Launch and release duties

- Before go-live: walk `docs/PRODUCTION_LAUNCH_CHECKLIST.md` and the root
  `DEPLOYMENT_CHECKLIST.md` with Hospital IT; run the UAT sessions in
  `docs/UAT_PLAN.md`.
- After every deploy: confirm the health view is green and the release SHA
  matches what was deployed; run the smoke suite with your account for the
  Maintenance checks ([../15-RELEASE-AND-ROLLBACK.md](../15-RELEASE-AND-ROLLBACK.md)).
- Monthly: confirm the restore drill was done and the health view shows a
  recent `BACKUP_RESTORE_VERIFIED_AT`.
- Decisions that need writing down: data retention periods
  (`docs/DATA_RETENTION_POLICY_TEMPLATE.md`), reliability targets, staggered
  deadlines (`docs/decisions/deadline-spike.md`).

## 7. Quick answers

- *An administrator asks for a field type change.* Only you can; consider a
  new field instead.
- *The health view shows failed jobs.* Exports and deliveries are safe to
  retry; ask Hospital IT to run `php artisan queue:retry <id>` or check the
  transport.
- *Someone needs to become an administrator quickly.* Create the account
  yourself; the sign-up queue also works but needs an approval step.
- *Can I hand the Maintenance role to someone else?* Not through the
  application; Hospital IT updates the account's e-mail and resets the
  password on the server, and the audit trail keeps the history.
