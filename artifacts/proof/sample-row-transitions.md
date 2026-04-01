# Sample Row Transitions

These are schema-accurate examples built from the exact SQL in [202603300001_live_integration.sql](C:/Users/Hasse/OneDrive/Desktop/Mesay/supabase/migrations/202603300001_live_integration.sql) and the table definitions in [202603290001_initial_schema.sql](C:/Users/Hasse/OneDrive/Desktop/Mesay/supabase/migrations/202603290001_initial_schema.sql). They are **not** captured from a live hosted database.

Shared sample IDs used below:

- Nurse `hana.abera@mesayhospital.demo`: `11111111-1111-1111-1111-111111111111`
- Admin `admin1@mesayhospital.demo`: `22222222-2222-2222-2222-222222222222`
- Department `outpatient_main`: `33333333-3333-3333-3333-333333333333`
- Template `outpatient_weekly`: `44444444-4444-4444-4444-444444444444`
- Assignment: `55555555-5555-5555-5555-555555555555`
- Reporting period: `66666666-6666-6666-6666-666666666666`
- Request: `77777777-7777-7777-7777-777777777777`
- Report: `88888888-8888-8888-8888-888888888888`

## Access Request Approval

Before:

```sql
access_requests
id                                    | user_id                               | email                         | status  | notes              | requested_at         | reviewed_at | reviewed_by
77777777-7777-7777-7777-777777777777  | 11111111-1111-1111-1111-111111111111  | hana.abera@mesayhospital.demo | pending | Need OPD reporting | 2026-03-30T07:10:00Z | null        | null

access_request_items
id                                    | access_request_id                     | department_id                           | template_id
aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaa1  | 77777777-7777-7777-7777-777777777777  | 33333333-3333-3333-3333-333333333333    | 44444444-4444-4444-4444-444444444444

report_assignments
-- no row yet for nurse 1111... + department 3333... + template 4444...
```

After `review_access_request(..., 'approved')`:

```sql
access_requests
id                                    | status    | reviewed_at           | reviewed_by
77777777-7777-7777-7777-777777777777  | approved  | 2026-03-30T07:15:00Z | 22222222-2222-2222-2222-222222222222

report_assignments
id                                    | nurse_id                               | department_id                           | template_id                             | active | approved_at           | approved_by
55555555-5555-5555-5555-555555555555  | 11111111-1111-1111-1111-111111111111   | 33333333-3333-3333-3333-333333333333    | 44444444-4444-4444-4444-444444444444    | true   | 2026-03-30T07:15:00Z | 22222222-2222-2222-2222-222222222222

notifications
id                                    | recipient_id                           | type                     | title            | related_route  | related_entity
99999999-9999-9999-9999-999999999991  | 11111111-1111-1111-1111-111111111111   | access_request_reviewed  | Access approved  | /nurse/reports | access_request:77777777-7777-7777-7777-777777777777
```

## Report Draft Save

Before:

```sql
reports
-- no row for assignment 5555... + period 6666...

report_field_values
-- no rows for future report 8888...
```

After `save_report(..., p_submit = false)` with two daily fields:

```sql
reports
id                                    | assignment_id                          | reporting_period_id                      | status | submitted_at | locked_at | created_by                              | updated_by
88888888-8888-8888-8888-888888888888  | 55555555-5555-5555-5555-555555555555   | 66666666-6666-6666-6666-666666666666     | draft  | null         | null      | 11111111-1111-1111-1111-111111111111    | 11111111-1111-1111-1111-111111111111

report_field_values
id                                    | report_id                              | field_definition_id                      | day_name | value_number | value_text | value_time
bbbbbbb1-bbbb-bbbb-bbbb-bbbbbbbbbbb1  | 88888888-8888-8888-8888-888888888888   | ccccccc1-cccc-cccc-cccc-ccccccccccc1     | monday   | 43           | null       | null
bbbbbbb2-bbbb-bbbb-bbbb-bbbbbbbbbbb2  | 88888888-8888-8888-8888-888888888888   | ccccccc2-cccc-cccc-cccc-ccccccccccc2     | monday   | null         | null       | 08:15:00

report_status_history
id                                    | report_id                              | status | changed_by                             | changed_by_name | note
ddddddd1-dddd-dddd-dddd-ddddddddddd1  | 88888888-8888-8888-8888-888888888888   | draft  | 11111111-1111-1111-1111-111111111111   | Hana Abera      | Draft created from the web form.
```

## Report Submit

After `save_report(..., p_submit = true)` on that same report:

```sql
reports
id                                    | status     | submitted_at          | locked_at
88888888-8888-8888-8888-888888888888  | submitted  | 2026-03-30T07:30:00Z | null

report_status_history
id                                    | report_id                              | status     | changed_by_name | note
ddddddd2-dddd-dddd-dddd-ddddddddddd2  | 88888888-8888-8888-8888-888888888888   | submitted  | Hana Abera      | Weekly report submitted.

notifications
id                                    | recipient_id                           | type                  | title                | related_route
99999999-9999-9999-9999-999999999992  | 22222222-2222-2222-2222-222222222222   | new_report_submitted  | New report submitted | /reports/55555555-5555-5555-5555-555555555555/66666666-6666-6666-6666-666666666666
```

## Edited After Submission

Before edit:

```sql
report_field_values
report_id                              | field_definition_id                      | day_name | value_number
88888888-8888-8888-8888-888888888888   | ccccccc1-cccc-cccc-cccc-ccccccccccc1     | monday   | 43
```

After changing that field to `45` and calling `save_report(..., p_submit = false)`:

```sql
reports
id                                    | status
88888888-8888-8888-8888-888888888888  | edited_after_submission

report_field_values
report_id                              | field_definition_id                      | day_name | value_number
88888888-8888-8888-8888-888888888888   | ccccccc1-cccc-cccc-cccc-ccccccccccc1     | monday   | 45

audit_logs
id                                    | report_id                              | field_key           | day_name | old_value | new_value | changed_by                             | changed_by_name | department_id                           | template_id
eeeeeee1-eeee-eeee-eeee-eeeeeeeeeee1  | 88888888-8888-8888-8888-888888888888   | total_patients_seen | monday   | 43        | 45        | 11111111-1111-1111-1111-111111111111   | Hana Abera      | 33333333-3333-3333-3333-333333333333    | 44444444-4444-4444-4444-444444444444

report_status_history
id                                    | report_id                              | status                    | note
ddddddd3-dddd-dddd-dddd-ddddddddddd3  | 88888888-8888-8888-8888-888888888888   | edited_after_submission   | Submitted report changed while still unlocked.

notifications
id                                    | recipient_id                           | type                     | title                  | related_entity
99999999-9999-9999-9999-999999999993  | 22222222-2222-2222-2222-222222222222   | submitted_report_edited  | Submitted report edited | report_edit
```

## Lock And Unlock Cycle

After `set_report_lock_state(..., true)`:

```sql
reports
id                                    | status | locked_at
88888888-8888-8888-8888-888888888888  | locked | 2026-03-30T07:45:00Z

report_status_history
id                                    | status | changed_by_name | note
ddddddd4-dddd-dddd-dddd-ddddddddddd4  | locked | Aster Bekele    | Report locked after review.

notifications
id                                    | recipient_id                           | type           | title         | related_entity
99999999-9999-9999-9999-999999999994  | 11111111-1111-1111-1111-111111111111   | report_locked  | Report locked | report_lock
```

After `set_report_lock_state(..., false)`:

```sql
reports
id                                    | status                    | locked_at
88888888-8888-8888-8888-888888888888  | edited_after_submission   | null

report_status_history
id                                    | status                    | changed_by_name | note
ddddddd5-dddd-dddd-dddd-ddddddddddd5  | edited_after_submission   | Aster Bekele    | Report unlocked for correction.

notifications
id                                    | recipient_id                           | type             | title           | related_entity
99999999-9999-9999-9999-999999999995  | 11111111-1111-1111-1111-111111111111   | report_unlocked  | Report unlocked | report_unlock
```

## Notification Examples From Each Event

```sql
-- access request submit -> to admins
recipient_id                           | type                    | title
22222222-2222-2222-2222-222222222222   | nurse_access_request    | Nurse access request

-- access request review -> to nurse
11111111-1111-1111-1111-111111111111   | access_request_reviewed | Access approved

-- first submit -> to admins
22222222-2222-2222-2222-222222222222   | new_report_submitted    | New report submitted

-- edit after submit -> to admins
22222222-2222-2222-2222-222222222222   | submitted_report_edited | Submitted report edited

-- lock -> to nurse
11111111-1111-1111-1111-111111111111   | report_locked           | Report locked

-- unlock -> to nurse
11111111-1111-1111-1111-111111111111   | report_unlocked         | Report unlocked

-- overdue sync -> to nurse or admins
11111111-1111-1111-1111-111111111111   | overdue_report          | Overdue report
```
