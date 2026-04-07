-- Launch reset: clears user-linked operational data and all auth/profile users.
-- Keeps templates, departments, reporting periods, and app settings rows.
--
-- Run this in Supabase SQL Editor only when you truly want a clean launch reset.

begin;

delete from public.notifications;
delete from public.audit_logs;
delete from public.report_status_history;
delete from public.calculated_metrics;
delete from public.report_field_values;
delete from public.reports;
delete from public.access_request_items;
delete from public.access_requests;
delete from public.report_assignments;

update public.app_settings
set updated_by = null;

delete from auth.users;

commit;
