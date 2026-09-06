# Branch protection for `main`

`main` is deployed to the hospital server by `deploy/deploy.sh`, so nothing may
land on it unless the CI gates in `ci.yml` passed. GitHub branch protection is a
repository setting, not a file, so it has to be applied once by a repository
admin. The settings are kept here so they are reviewable and reproducible.

Apply (or re-apply after a change) with the GitHub CLI:

```
gh api -X PUT repos/SamiHydra/Internal-Medicine/branches/main/protection \
  --input .github/branch-protection.json
```

Verify:

```
gh api repos/SamiHydra/Internal-Medicine/branches/main/protection \
  --jq '{contexts: .required_status_checks.contexts, force: .allow_force_pushes.enabled, delete: .allow_deletions.enabled}'
```

What it enforces:

- The five blocking CI jobs must be green before a merge: `Frontend`,
  `Backend SQLite`, `Backend MariaDB`, `Deployment shell scripts` and
  `Isolated Playwright gate`. `Mobile Lighthouse budgets` stays advisory.
- Force pushes and branch deletion are refused.
- `enforce_admins` is off so the repository owner can still land an emergency
  fix when CI itself is broken; that bypass is visible in the audit log.
- Pull-request review is not required because the department has a single
  maintainer. Turn it on (`required_pull_request_reviews`) once a second
  reviewer exists.
