# User acceptance test plan

Structured acceptance testing for the first weeks the platform is available to
real hospital users. The aim is to discover usability problems, not to prove
the software works: the automated gates already do that. Testers are told what
to achieve, never which button to press; where they hesitate, get lost or ask
for help is the finding.

Status date: 2026-09-09. To be run on the hospital server (or the parity
stack for a dry run) with disposable `QA_UAT_` accounts and data, after
`docs/PRODUCTION_LAUNCH_CHECKLIST.md` is complete.

## 1. How to run a session

- One tester, one facilitator, 30 to 45 minutes, the tester's own device
  (phone or ward computer) where possible.
- The facilitator reads the task aloud, starts a timer, and writes down every
  hesitation, wrong turn, question, and error message seen. No hints unless
  the tester is stuck for more than two minutes; note when a hint was given.
- After each task: "Was that clear? What would you change?" One line per task.
- After the session: the tester rates overall confidence 1 to 5 and names the
  one thing that would make daily use easier.
- Findings go into the table in section 8 and, if they are defects, into the
  issue tracker with the session id.

Record for every task: completed alone / completed with a hint / not
completed; time taken; errors shown; tester's words.

## 2. Preparation (facilitator)

- Disposable accounts, one per role, named `QA_UAT_<role>` with the production
  password policy (12 characters). Nurse account assigned to a ward that
  exists but carries no real reports (create a `QA_UAT` department if needed).
- A resident and a consultant placed on the same ward for the test week, so
  the evaluation forms have an eligible subject.
- A student representative with an active rep assignment and at least one
  scheduled teaching activity today.
- One submitted report on the nurse's ward from last week (so "find previous
  reports" and "locked state" have something to show); lock one older report.
- Notifications enabled; e-mail transport live so password reset can be tried.
- The maintenance page checked green before the session.

## 3. Nurse

| # | Task (read aloud) | What success looks like | Watch for |
|---|---|---|---|
| N1 | "Sign in and find this week's report for your ward." | The current week's form for the right ward is open | which link they use; whether the week label is understood |
| N2 | "Enter Monday and Tuesday's figures and make sure they are kept without sending them." | Draft saved; the status line confirms it | whether autosave is trusted; whether "Save draft" is found |
| N3 | "You made a mistake in Tuesday. Correct it." | Corrected value saved | whether the change is visible as saved |
| N4 | "Finish the week and send it to the department." | Report submitted; success message understood | whether a submitted report is expected to be editable |
| N5 | "Find the report you sent two weeks ago." | Opens the older report | where they look (Home, My Reports, Activity) |
| N6 | "One of the older reports cannot be changed. Explain why, in your own words." | Recognises the locked state and who can change it | wording of the read-only state |
| N7 | "Switch off the wifi on your phone, change one figure, then switch it back on." (facilitator toggles) | Change queued, then synced; the tester can say what happened | whether the offline wording is understood |
| N8 | "You have a message from the administrator. Find it." | Opens notifications | discoverability of the bell |

## 4. Administrator

| # | Task | Success | Watch for |
|---|---|---|---|
| A1 | "A new nurse has asked for access. Let her in and give her the correct ward." | Request approved, assignment created | where approval lives; whether the department picker is clear |
| A2 | "Find the report the nurse sent for last week and check it." | Opens it from the submissions board | the board's status colours and week chips |
| A3 | "Freeze that report so nobody can change it, then decide you were wrong and allow changes again." | Locked then unlocked | whether the effect on the nurse is understood |
| A4 | "The mortality figure needs follow-up. Create the task for the ward and attach the note you were given." | Action item with evidence | the sheet, file upload, status vocabulary |
| A5 | "Give the head of department last month's figures as a spreadsheet." | Export requested, downloaded when ready | whether "pending" is understood; where the file appears |
| A6 | "Something changed on a report yesterday. Find out who changed what." | Audit log filtered to the report | filters, wording of the trail |
| A7 | "Go to the academic side and come back." | Workspace switch understood | whether the two sides are confused |
| A8 | "Change the weekly deadline to Tuesday 10:00." | Setting saved; the effect on the board understood | validation messages |
| A9 | Maintenance account only: "Check whether the system is healthy and when the last backup ran." | Reads the system health page | whether the words match the operations handbook |

## 5. Resident

| # | Task | Success | Watch for |
|---|---|---|---|
| R1 | "Evaluate the consultant you worked with today." | Evaluation submitted | choosing the subject, the rating control, required fields |
| R2 | "Find what you submitted last month." | History page | filters, dates |
| R3 | "Look at your own performance and explain what the numbers mean." | Interprets the performance page | any number the tester cannot explain is a finding |
| R4 | "Try to evaluate someone you did not work with today." | Understands why that person is not offered | the eligibility wording |

## 6. Consultant

| # | Task | Success | Watch for |
|---|---|---|---|
| C1 | "Evaluate the resident on your ward for today." | Submitted | same as R1 |
| C2 | "Record who attended teaching this morning." | Attendance saved | the student list, the held/not-held control |
| C3 | "Find the evaluations you gave last month." | History | as R2 |
| C4 | "Ask to move to another section." | Transfer request filed; the tester can say who decides | the wording of "next month boundary" |
| C5 | Head of section only: "Someone has asked to join your section. Decide." | Approved or rejected | where the request appears |

## 7. Student representative

| # | Task | Success | Watch for |
|---|---|---|---|
| S1 | "Record whether today's teaching took place." | Held / not held recorded with a reason when not held | the reason field |
| S2 | "Explain what else you can do here." | Says: nothing else; that is correct | any expectation of more |
| S3 | "Try to open the reports or the evaluation pages." (facilitator gives a URL) | Lands back on the log with no error page | the redirect experience |

## 8. Findings table (fill in)

| Session | Role | Task | Outcome (alone / hint / failed) | Time | Observation | Severity (blocker / major / minor / cosmetic) | Ticket |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

## 9. Exit criteria for UAT

- Every task above completed by at least two testers per role.
- No blocker findings open; every major finding either fixed or accepted in
  writing by the department.
- Testers' median confidence at least 4 of 5.
- The facilitator's notes are attached to the go-live decision record.
