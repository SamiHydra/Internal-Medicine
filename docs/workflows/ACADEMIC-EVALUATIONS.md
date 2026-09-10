# Workflow: academic evaluations

How residents, consultants and students are evaluated, how eligibility is
decided, how scores are ranked, and how the instruments themselves are
changed. Rules are numbered as in [../02-BUSINESS-RULES.md](../02-BUSINESS-RULES.md)
section 7.

## 1. The three directions

| Direction | Evaluator | Subject | Form key | Indicators |
|---|---|---|---|---|
| Resident evaluates consultant | resident | a consultant they shared a placement with that day | `consultant_mdt` | six yes/no (all patients reviewed, management plan documented, VTE assessed, discharge discussed, medication review done, critical labs reviewed) plus an overall rating 1 to 5 |
| Consultant evaluates resident | consultant | a resident they shared a placement with that day | `resident_acgme` | ten yes/no (punctuality, preparation, presentation clarity, clinical reasoning, management planning, documentation timeliness, communication, professionalism, feedback responsiveness, follow-through) plus an overall rating |
| Consultant evaluates student | consultant | a student placed with the consultant's ward that week | `student_weekly`, `student_final` | the batch's weekly and final instruments |

Extra typed answers may exist on a form version (rating, percent, integer,
time, text, single or multi select); the indicators and rating above are the
core fields.

## 2. Eligibility

```text
evaluator opens Submit evaluation ──▶ GET /academic/form-options?date=
                                       roster: who shared a placement with me on that date
                                       minus subjects already evaluated by me on that date
                                    ──▶ subject list
```

The roster service answers from duty assignments and rotation blocks; nothing
reads a home-ward field. A subject not offered cannot be submitted: the
server re-derives eligibility and refuses a forged one (rule 7.2). A pairing
gap (for example a month boundary in the rotation plan) shows no subjects for
that date; the evaluator picks another date.

## 3. Submitting

1. Open **Submit evaluation**; pin the evaluation date (defaults to today).
2. Choose the subject; the published form version renders.
3. Answer the indicators and choose the overall rating (mandatory); add any
   extra answers the version asks for.
4. Submit. The server checks eligibility, the one-per-evaluator-subject-form-
   date uniqueness (rule 7.3), validates each answer by its field type,
   snapshots the ward and the form version, and writes the header and answers
   atomically. Submitted evaluations are immutable.

The evaluator's **History** lists their submissions; **My performance** shows
the evaluations they received, summarised.

## 4. Student evaluations

A consultant's **Students** page lists the students placed with them this
week from the batch's subgroup placements. Weekly evaluations are filed
during the placement; the final evaluation at the end of the batch. The same
engine, uniqueness and immutability apply.

## 5. External evaluations

An administrator may enter an evaluation on behalf of an external evaluator
(a visiting consultant, for example) through the academic submissions page.
The row records the administrator as the author of the entry and the external
name; it is audited and never impersonates a user (rule 7.6).

## 6. Scoring and ranking

For each person the analytics compute, over the selected window:

- the mean overall rating (1 to 5), normalised to a percentage;
- the indicator compliance: the share of yes/no indicators marked true;
- the combined score: an equal-weight blend of the two (`RATING_WEIGHT` 0.5);
- issue frequencies per indicator.

A person appears in the ranking only with at least three evaluations
(`MIN_EVALUATIONS_FOR_RANK`). Scoring inputs are identified by field key, so a
content edit of a label never changes a score (rule 7.4). Administrators see
the snapshot, summary, trend and people views on the academic dashboard and
the person detail page; student representatives never do (rule 7.7).

## 7. Changing the instrument

```text
content edit (admin) ──▶ applied in place to the published version, audited
structural edit (Maintenance):
  POST evaluation-forms/{key}/draft  ──▶ a draft copy of the published version
  PUT  evaluation-forms/{id}/structure ──▶ add/remove/rename/retype fields (core fields protected)
  POST evaluation-forms/{id}/publish ──▶ new published version; previous archived
```

Content edits: labels, help text, order, option wording, active flag,
thresholds. Structural edits create a version; historical evaluations keep
rendering against the version they answered. Core scoring fields cannot be
removed or retyped, a guard refuses to publish such a draft, and a database
constraint keeps one published version per key (rule 7.5). Legacy evaluation
rows were copied into the unified tables and verified with
`academic:verify-migration`.

## 8. Related surfaces

- Morning sessions record punctuality separately ([MORNING-SESSIONS.md](MORNING-SESSIONS.md)).
- The rotation plan and the duty roster decide who is eligible
  ([TRANSFERS-AND-ROTATIONS.md](TRANSFERS-AND-ROTATIONS.md)).
- The leadership digest's academic block reports evaluation counts, morning
  punctuality and teaching held versus expected.

## 9. Where each step is proven

| Step | Tests |
|---|---|
| Eligibility and pairing | `RosterTest`, `AcademicEligibilityTest`, `AcademicEvaluationApiTest` |
| Submission, uniqueness, immutability | `AcademicEvaluationApiTest`, `EvaluationFormEngineTest`, e2e `academic-evaluation-submit.spec.ts` |
| Student evaluations | `UndergraduateModuleTest` |
| Form content and structure | `EvaluationFormEngineTest` |
| Analytics and ranking | `AcademicOperationsTest`, `EvaluationFormEngineTest` |
| Representative isolation | `UndergraduateModuleTest`, the authorization matrix |
