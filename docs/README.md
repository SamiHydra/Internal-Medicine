# St Paul's Internal Medicine Platform: documentation index

The platform is the clinical weekly-reporting and academic-evaluation system
used by the Internal Medicine department of St Paul's Hospital. This folder is
the manual set for everyone who uses, runs, or changes it. Each document is
written to be read on its own; cross-references point to the one place a
detail is explained fully.

Status: describes the code on branch `hardening/pre-server` as of 2026-09-10.
When behaviour changes, update the document that owns the rule and add a line
to [reference/CHANGELOG.md](reference/CHANGELOG.md).

## Start here

| If you are | Read first | Then |
|---|---|---|
| New to the project | [01-SYSTEM-OVERVIEW](01-SYSTEM-OVERVIEW.md) | [02-BUSINESS-RULES](02-BUSINESS-RULES.md), [reference/GLOSSARY](reference/GLOSSARY.md) |
| A nurse, doctor, or student representative | [manuals/USER-MANUAL](manuals/USER-MANUAL.md) | the manual for your role (below) |
| A department administrator | [manuals/ADMIN-MANUAL](manuals/ADMIN-MANUAL.md) | [09-OPERATIONS-MANUAL](09-OPERATIONS-MANUAL.md) |
| The Maintenance account holder | [manuals/MAINTENANCE-MANUAL](manuals/MAINTENANCE-MANUAL.md) | [11-MONITORING-AND-OBSERVABILITY](11-MONITORING-AND-OBSERVABILITY.md) |
| Hospital IT | [manuals/IT-OPERATOR-MANUAL](manuals/IT-OPERATOR-MANUAL.md) | [07-INSTALLATION-AND-DEPLOYMENT](07-INSTALLATION-AND-DEPLOYMENT.md), [10-BACKUP-AND-DISASTER-RECOVERY](10-BACKUP-AND-DISASTER-RECOVERY.md) |
| A developer | [14-DEVELOPER-GUIDE](14-DEVELOPER-GUIDE.md) | [03-ARCHITECTURE](03-ARCHITECTURE.md), [05-API-REFERENCE](05-API-REFERENCE.md), [12-TESTING-AND-QA](12-TESTING-AND-QA.md) |
| Releasing a version | [15-RELEASE-AND-ROLLBACK](15-RELEASE-AND-ROLLBACK.md) | [08-CONFIGURATION-GUIDE](08-CONFIGURATION-GUIDE.md) |

## Core guides

| # | Document | What it answers |
|---|---|---|
| 01 | [System overview](01-SYSTEM-OVERVIEW.md) | What the platform is, who uses it, the two workspaces, the module map |
| 02 | [Business rules](02-BUSINESS-RULES.md) | Every rule the software enforces: reporting weeks, report lifecycle, locking, evaluations, sessions, transfers, accounts |
| 03 | [Architecture](03-ARCHITECTURE.md) | How the SPA, API, database, queues and scheduler fit together, and why |
| 04 | [Database design](04-DATABASE-DESIGN.md) | Tables by domain, key columns, invariants, indexes, migration rules |
| 05 | [API reference](05-API-REFERENCE.md) | Every endpoint, its permission, payload conventions, error shapes |
| 06 | [Security and authorization](06-SECURITY-AND-AUTHORIZATION.md) | Authentication, the four authorization layers, the permission matrix, headers, secrets |
| 07 | [Installation and deployment](07-INSTALLATION-AND-DEPLOYMENT.md) | Local setup, first production install, the deploy script, the parity stack |
| 08 | [Configuration guide](08-CONFIGURATION-GUIDE.md) | Environment variables by purpose, the in-app settings, what must change for production |
| 09 | [Operations manual](09-OPERATIONS-MANUAL.md) | Daily and weekly running of the server: health, services, logs, queues, scheduler |
| 10 | [Backup and disaster recovery](10-BACKUP-AND-DISASTER-RECOVERY.md) | Nightly backups, restore drills, real restores, recovery objectives |
| 11 | [Monitoring and observability](11-MONITORING-AND-OBSERVABILITY.md) | Signals, the health view, thresholds, alert routing, what is never logged |
| 12 | [Testing and QA](12-TESTING-AND-QA.md) | Test layers, commands, gates, harnesses, fixtures, CI |
| 13 | [Troubleshooting](13-TROUBLESHOOTING.md) | Symptom to cause to fix, for users, admins, and operators |
| 14 | [Developer guide](14-DEVELOPER-GUIDE.md) | Repository layout, conventions, how to add a feature, gotchas |
| 15 | [Release and rollback](15-RELEASE-AND-ROLLBACK.md) | Release identity, the deploy pipeline, rollback of code and data, post-release checks |

## Manuals by role

| Manual | Audience |
|---|---|
| [User manual](manuals/USER-MANUAL.md) | Everyone: signing in, passwords, notifications, offline behaviour, getting help |
| [Nurse manual](manuals/NURSE-MANUAL.md) | Filing the weekly ward report |
| [Resident manual](manuals/RESIDENT-MANUAL.md) | Evaluating consultants, morning sessions, own performance |
| [Consultant manual](manuals/CONSULTANT-MANUAL.md) | Evaluating residents and students, teaching attendance, transfers |
| [Student representative manual](manuals/STUDENT-REP-MANUAL.md) | Logging whether teaching happened |
| [Administrator manual](manuals/ADMIN-MANUAL.md) | Users and access, submissions, locking, action items, imports, exports, templates, settings, the academic side |
| [Maintenance manual](manuals/MAINTENANCE-MANUAL.md) | The protected owner account: creating administrators, structural edits, system health |
| [IT operator manual](manuals/IT-OPERATOR-MANUAL.md) | Host-level duties: services, cron, TLS, firewall, backups, updates |

## Workflows (end to end)

| Workflow | Covers |
|---|---|
| [Clinical reporting](workflows/CLINICAL-REPORTING.md) | Assignment, weekly period, draft, submit, edit, lock, unlock, analytics |
| [Academic evaluations](workflows/ACADEMIC-EVALUATIONS.md) | Eligibility, the two evaluation directions, student evaluations, scoring, form versions |
| [Action items](workflows/ACTION-ITEMS.md) | Alert rules, creation, assignment, evidence, resolution, closure, escalation |
| [Morning sessions](workflows/MORNING-SESSIONS.md) | Opening, roster, recording, correction, reminders |
| [Transfers and rotations](workflows/TRANSFERS-AND-ROTATIONS.md) | Section transfer requests, rotation calendars, the planner, the duty roster |
| [Offline sync](workflows/OFFLINE-SYNC.md) | The queued save, replay, conflicts, what the nurse sees |

## Reference

| Reference | Contents |
|---|---|
| [Roles and permissions](reference/ROLES-AND-PERMISSIONS.md) | The six roles, the 38 permissions, the full matrix, what each role can reach |
| [Status transitions](reference/STATUS-TRANSITIONS.md) | Every state machine: reports, action items, transfers, sessions, forms, exports, requests |
| [Environment variables](reference/ENVIRONMENT-VARIABLES.md) | Every variable, default, and production value |
| [Error codes](reference/ERROR-CODES.md) | HTTP statuses, application messages, conflict reasons, what the user sees |
| [Glossary](reference/GLOSSARY.md) | The vocabulary used across the platform and these documents |
| [Changelog](reference/CHANGELOG.md) | What changed, by release and by phase |

## Deep-dive and historical documents

These remain in place and are the authoritative long-form sources where the
guides above summarise:

- `ARCHITECTURE.md`: the original component-level architecture reference (frontend, backend, data model, design system). Parts pre-date the academic expansion; the guides above are current.
- `TECHNICAL_OVERVIEW.md`: a plain-language engineering narrative.
- `OFFLINE_SYNC_MODEL.md`, `OBSERVABILITY.md`, `RELIABILITY_TARGETS.md`, `OPERATIONS.md`, `PARITY_ENVIRONMENT.md`, `PRODUCTION_LAUNCH_CHECKLIST.md`, `ROLLBACK_REHEARSAL.md`, `DATA_RETENTION_POLICY_TEMPLATE.md`, `UAT_PLAN.md`, `LOAD_TESTING.md`, `TEST_COVERAGE_MATRIX.md`: the operational and hardening sources.
- `decisions/`: recorded decisions (Redis optional, deadline spike, data retention question).
- `history/` and `migration/`: past audits and the Supabase-to-Laravel migration notes.
- Repository root: `BUSINESS_LOGIC_REGRESSION_REPORT.md`, `BUSINESS_LOGIC_CHANGE_REVIEW.md`, `DEPLOYMENT_CHECKLIST.md`, `FINAL_DEPLOYMENT_READINESS.md`, `PRE_SERVER_HARDENING_REPORT.md` and the audit reports that led to the current release.
