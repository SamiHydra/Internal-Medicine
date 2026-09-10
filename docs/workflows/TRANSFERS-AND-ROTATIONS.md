# Workflow: transfers and rotations

How the academic structure is kept truthful: sections and wards, the monthly
duty roster, rotation calendars and the planner, and section transfers.
Rules are numbered as in [../02-BUSINESS-RULES.md](../02-BUSINESS-RULES.md)
sections 6 and 10.

## 1. The structure

Administrators maintain, under the academic **Structure** page:

| Object | Fields | Notes |
|---|---|---|
| Ward | name, active | the academic ward record; clinical departments may reference one |
| Section | name, head consultant, active | the head must be an active consultant; the head decides transfers into the section |
| Duty type | name, active, allowed combinations | kinds of duty a person can hold in a month |

Deleting a referenced ward or section is refused; deactivate instead.

## 2. The duty roster

**Duty & coverage** shows a month grid of people against wards or services
with a duty type. Saving the month or a single day writes duty assignments
through the roster service, which refuses overlapping assignments for the same
person, type and month (rule 6.3) and saves a batch atomically: an invalid row
rolls the whole save back.

The roster service is the single answer to "who was placed where on this
date": evaluation eligibility, the morning roster, the duty grid and the
planner all read through it (rule 6.1).

## 3. Rotation calendars and the planner

```text
create calendar (label, starts on, block kind) ──▶ blocks generated
   calendar_month: month-aligned blocks from the start date (first may be partial)
   fixed_weeks:    back-to-back blocks of N weeks, no gaps (Year 3)
activate the calendar (one active at a time)
open the planner ──▶ assign each resident (or a training-year group) a ward per block
save plan ──▶ duty assignments written per block, atomically
```

The academic year start moves every year with the national programme, so
nothing is hard-coded (rule 10.3). Year 1 and Year 2 residents rotate by
calendar month; Year 3 runs fixed-week blocks. Individual and group plans
can be mixed; a partial invalid plan rolls back.

## 4. Section transfers

```text
consultant: Submit ──▶ POST /academic/transfer-requests (to section, reason)  status pending
            may cancel while pending
head of the DESTINATION section (or an admin): approve or reject
   approve ──▶ status approved, effective_on = next rotation boundary (admin may set an earlier date, never past)
scheduler 00:15 (academic:apply-section-transfers): when effective_on arrives
   ──▶ user's section updated, old ward-service assignment closed, status applied
```

The consultant sees their requests under their profile; the head sees
requests into their section on the review panel; administrators see all under
**Transfers**. Approving twice, or approving and rejecting, is refused: the
decision is recorded once with the decider and time (rules 10.1, 10.2).

## 5. Effects elsewhere

- The roster reflects the new section only from the effective date, so
  mid-block rosters stay stable.
- Evaluation eligibility follows the roster, so a transferred consultant
  becomes evaluable by residents on the new ward from that date.
- Morning session rosters follow the same rule.

## 6. Where each step is proven

| Step | Tests |
|---|---|
| Wards, sections, heads, duty types | `RosterTest`, `SectionTransferTest` |
| Overlap protection and bulk atomicity | `RosterTest`, `RotationPlannerTest`, `MariaDbConcurrencyRegressionTest` (MariaDB lane) |
| Calendar generation, planner | `RosterTest`, `RotationPlannerTest` |
| Transfer request, decision, application | `SectionTransferTest`, `AcademicOperationsTest` |
| Head-of-destination narrowing | `SectionTransferTest`, the authorization matrix |
