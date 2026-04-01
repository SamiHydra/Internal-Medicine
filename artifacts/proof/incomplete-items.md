# Incomplete Items And Effort

## Still Incomplete

1. Auto-lock after deadline
Estimate: 0.5 to 1 day
What remains:
Implement a scheduled backend job that reads `app_settings.locking_rules`, finds overdue submitted reports, and calls the lock path or equivalent SQL directly.

2. Dashboard pages using SQL views instead of client-side aggregation
Estimate: 1 to 2 days
What remains:
Replace current `fetchLiveAppState()` + selector-driven dashboard rollups with direct reads from `v_submission_board`, `v_department_metric_weekly`, and `v_dashboard_weekly_summary`.

3. Template management and field-definition CRUD against Supabase
Estimate: 2 to 4 days
What remains:
The UI still uses local template config for management screens. A real admin CRUD flow for `report_templates` and `report_field_definitions` is not built.

4. Access-request and assignment option lists sourced from live reference tables
Estimate: 0.5 to 1 day
What remains:
`access-request-page.tsx` and `user-management-page.tsx` still rely on local config slugs rather than fetching department/template options from Supabase.

5. Admin dashboard synthetic no-show series
Estimate: 0.25 to 0.5 day
What remains:
Replace the placeholder `visits * 0.08` series in the admin dashboard with live `failed_to_come` trend data.

6. Hardening anonymous access requests
Estimate: 0.5 to 1 day
What remains:
`submit_access_request` currently supports pre-login requests and trusts caller-supplied `p_user_id` and `p_email`. It works, but it is not as tightly bound to authenticated identity as the report/admin RPCs.

7. Hosted end-to-end verification
Estimate: 0.5 day once credentials exist
What remains:
Run the app against a real Supabase project and capture login, nurse visibility, admin approval, draft/submit/edit, audit rows, and notifications.
