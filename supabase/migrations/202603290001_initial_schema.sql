create extension if not exists pgcrypto;

create type public.report_family as enum ('inpatient', 'outpatient', 'procedure');
create type public.access_request_status as enum ('pending', 'approved', 'rejected');
create type public.report_status as enum (
  'not_started',
  'draft',
  'submitted',
  'edited_after_submission',
  'locked',
  'overdue'
);
create type public.notification_type as enum (
  'new_report_submitted',
  'submitted_report_edited',
  'report_locked',
  'report_unlocked',
  'overdue_report',
  'nurse_access_request'
);
create type public.field_kind as enum ('integer', 'decimal', 'time', 'text', 'choice');
create type public.field_aggregate as enum ('sum', 'average', 'latest', 'none');

create table if not exists public.roles (
  role_key text primary key,
  label text not null,
  description text not null
);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role_key text not null references public.roles (role_key),
  email text not null unique,
  full_name text not null,
  title text,
  active boolean not null default true,
  phone text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.report_templates (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  family public.report_family not null,
  name text not null,
  description text not null,
  active_days text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  family public.report_family not null,
  template_id uuid not null references public.report_templates (id),
  name text not null,
  description text not null,
  accent_color text,
  bed_count integer,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.report_field_definitions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.report_templates (id) on delete cascade,
  section_key text not null,
  field_key text not null,
  label text not null,
  field_kind public.field_kind not null,
  aggregate_type public.field_aggregate not null default 'sum',
  display_order integer not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (template_id, field_key)
);

create table if not exists public.access_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  email text not null,
  status public.access_request_status not null default 'pending',
  notes text,
  requested_at timestamptz not null default timezone('utc', now()),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.access_request_items (
  id uuid primary key default gen_random_uuid(),
  access_request_id uuid not null references public.access_requests (id) on delete cascade,
  department_id uuid not null references public.departments (id) on delete cascade,
  template_id uuid not null references public.report_templates (id) on delete cascade,
  unique (access_request_id, department_id, template_id)
);

create table if not exists public.report_assignments (
  id uuid primary key default gen_random_uuid(),
  nurse_id uuid not null references public.profiles (id) on delete cascade,
  department_id uuid not null references public.departments (id) on delete cascade,
  template_id uuid not null references public.report_templates (id) on delete cascade,
  active boolean not null default true,
  approved_at timestamptz not null default timezone('utc', now()),
  approved_by uuid references public.profiles (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (nurse_id, department_id, template_id)
);

create table if not exists public.reporting_periods (
  id uuid primary key default gen_random_uuid(),
  week_start date not null unique,
  week_end date not null,
  deadline_at timestamptz not null,
  month_label text not null,
  quarter_label text not null,
  year_num integer not null,
  created_at timestamptz not null default timezone('utc', now()),
  check (week_end = week_start + 6)
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.report_assignments (id) on delete cascade,
  department_id uuid not null references public.departments (id) on delete cascade,
  template_id uuid not null references public.report_templates (id) on delete cascade,
  reporting_period_id uuid not null references public.reporting_periods (id) on delete cascade,
  status public.report_status not null default 'draft',
  submitted_at timestamptz,
  locked_at timestamptz,
  created_by uuid not null references public.profiles (id),
  updated_by uuid not null references public.profiles (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (assignment_id, reporting_period_id)
);

create table if not exists public.report_field_values (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports (id) on delete cascade,
  field_definition_id uuid not null references public.report_field_definitions (id) on delete cascade,
  day_name text not null,
  value_number numeric,
  value_text text,
  value_time time,
  value_json jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (report_id, field_definition_id, day_name)
);

create table if not exists public.calculated_metrics (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null unique references public.reports (id) on delete cascade,
  bor_percent numeric,
  btr numeric,
  alos numeric,
  metric_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.report_status_history (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports (id) on delete cascade,
  status public.report_status not null,
  changed_by uuid not null references public.profiles (id),
  note text,
  changed_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports (id) on delete cascade,
  field_definition_id uuid references public.report_field_definitions (id),
  field_key text not null,
  day_name text,
  old_value text,
  new_value text,
  changed_by uuid not null references public.profiles (id),
  changed_at timestamptz not null default timezone('utc', now()),
  department_id uuid not null references public.departments (id),
  template_id uuid not null references public.report_templates (id)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  type public.notification_type not null,
  title text not null,
  message text not null,
  related_route text,
  related_entity text,
  related_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.app_settings (
  setting_key text primary key,
  value_json jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_profiles_role_key on public.profiles (role_key);
create index if not exists idx_departments_family on public.departments (family);
create index if not exists idx_field_definitions_template on public.report_field_definitions (template_id, display_order);
create index if not exists idx_assignments_nurse_active on public.report_assignments (nurse_id, active);
create index if not exists idx_assignments_department on public.report_assignments (department_id);
create index if not exists idx_periods_year_month on public.reporting_periods (year_num, month_label);
create index if not exists idx_reports_period on public.reports (reporting_period_id, template_id);
create index if not exists idx_reports_status on public.reports (status, locked_at, submitted_at);
create index if not exists idx_report_values_report on public.report_field_values (report_id, field_definition_id);
create index if not exists idx_status_history_report on public.report_status_history (report_id, changed_at desc);
create index if not exists idx_audit_logs_report on public.audit_logs (report_id, changed_at desc);
create index if not exists idx_notifications_recipient on public.notifications (recipient_id, read_at, created_at desc);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role_key from public.profiles where id = auth.uid()), '');
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role() in ('admin', 'doctor_admin');
$$;

create or replace function public.derive_submission_status(
  current_status public.report_status,
  current_locked_at timestamptz,
  period_deadline timestamptz
)
returns public.report_status
language plpgsql
stable
as $$
begin
  if current_locked_at is not null or current_status = 'locked' then
    return 'locked';
  end if;

  if current_status = 'edited_after_submission' then
    return 'edited_after_submission';
  end if;

  if current_status = 'submitted' then
    return 'submitted';
  end if;

  if current_status = 'draft' and period_deadline < timezone('utc', now()) then
    return 'overdue';
  end if;

  if current_status = 'draft' then
    return 'draft';
  end if;

  if period_deadline < timezone('utc', now()) then
    return 'overdue';
  end if;

  return 'not_started';
end;
$$;

create or replace function public.upsert_calculated_metrics(p_report_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family public.report_family;
  v_bed_count integer;
  v_total_patient_days numeric := 0;
  v_total_discharge numeric := 0;
begin
  select t.family, d.bed_count
  into v_family, v_bed_count
  from public.reports r
  join public.report_templates t on t.id = r.template_id
  join public.departments d on d.id = r.department_id
  where r.id = p_report_id;

  if v_family is distinct from 'inpatient' then
    insert into public.calculated_metrics (report_id, metric_payload)
    values (p_report_id, '{}'::jsonb)
    on conflict (report_id) do nothing;
    return;
  end if;

  select coalesce(sum(v.value_number), 0)
  into v_total_patient_days
  from public.report_field_values v
  join public.report_field_definitions f on f.id = v.field_definition_id
  where v.report_id = p_report_id
    and f.field_key = 'total_patient_days';

  select coalesce(sum(v.value_number), 0)
  into v_total_discharge
  from public.report_field_values v
  join public.report_field_definitions f on f.id = v.field_definition_id
  where v.report_id = p_report_id
    and f.field_key in ('discharged_home', 'discharged_ama');

  insert into public.calculated_metrics (
    report_id,
    bor_percent,
    btr,
    alos,
    metric_payload
  )
  values (
    p_report_id,
    case when coalesce(v_bed_count, 0) = 0 then null else (v_total_patient_days / (v_bed_count * 30.0)) * 100 end,
    case when coalesce(v_bed_count, 0) = 0 then null else v_total_discharge / v_bed_count end,
    case when coalesce(v_total_discharge, 0) = 0 then null else v_total_patient_days / v_total_discharge end,
    jsonb_build_object(
      'total_patient_days', v_total_patient_days,
      'total_discharge', v_total_discharge
    )
  )
  on conflict (report_id) do update
  set bor_percent = excluded.bor_percent,
      btr = excluded.btr,
      alos = excluded.alos,
      metric_payload = excluded.metric_payload,
      updated_at = timezone('utc', now());
end;
$$;

create or replace view public.v_submission_board as
select
  ra.id as assignment_id,
  ra.nurse_id,
  d.id as department_id,
  d.name as department_name,
  d.family,
  t.id as template_id,
  t.name as template_name,
  rp.id as reporting_period_id,
  rp.week_start,
  rp.week_end,
  rp.deadline_at,
  r.id as report_id,
  public.derive_submission_status(r.status, r.locked_at, rp.deadline_at) as derived_status,
  r.updated_at,
  r.submitted_at,
  r.locked_at
from public.report_assignments ra
join public.departments d on d.id = ra.department_id
join public.report_templates t on t.id = ra.template_id
cross join public.reporting_periods rp
left join public.reports r
  on r.assignment_id = ra.id
 and r.reporting_period_id = rp.id
where ra.active = true;

create or replace view public.v_department_metric_weekly as
select
  r.department_id,
  d.name as department_name,
  d.family,
  r.reporting_period_id,
  sum(case when f.field_key = 'total_admitted_patients' then coalesce(v.value_number, 0) else 0 end) as total_admissions,
  sum(case when f.field_key = 'discharged_home' then coalesce(v.value_number, 0) else 0 end) as total_discharged_home,
  sum(case when f.field_key = 'total_patients_seen' then coalesce(v.value_number, 0) else 0 end) as total_patients_seen,
  sum(case when f.field_key = 'failed_to_come' then coalesce(v.value_number, 0) else 0 end) as total_failed_to_come,
  sum(case when f.field_key = 'total_hai' then coalesce(v.value_number, 0) else 0 end) as total_hai,
  max(cm.bor_percent) as bor_percent,
  max(cm.btr) as btr,
  max(cm.alos) as alos
from public.reports r
join public.departments d on d.id = r.department_id
left join public.report_field_values v on v.report_id = r.id
left join public.report_field_definitions f on f.id = v.field_definition_id
left join public.calculated_metrics cm on cm.report_id = r.id
group by r.department_id, d.name, d.family, r.reporting_period_id;

create or replace view public.v_dashboard_weekly_summary as
select
  rp.id as reporting_period_id,
  d.family,
  count(distinct ra.id) as total_expected_reports,
  count(distinct r.id) filter (where public.derive_submission_status(r.status, r.locked_at, rp.deadline_at) = 'submitted') as submitted_reports,
  count(distinct r.id) filter (where public.derive_submission_status(r.status, r.locked_at, rp.deadline_at) = 'edited_after_submission') as edited_after_submission_reports,
  count(distinct r.id) filter (where public.derive_submission_status(r.status, r.locked_at, rp.deadline_at) = 'locked') as locked_reports,
  count(distinct ra.id) filter (where r.id is null and rp.deadline_at < timezone('utc', now())) as overdue_missing_reports,
  avg(cm.bor_percent) as avg_bor_percent,
  avg(cm.btr) as avg_btr,
  avg(cm.alos) as avg_alos
from public.reporting_periods rp
join public.report_assignments ra on ra.active = true
join public.departments d on d.id = ra.department_id
left join public.reports r
  on r.assignment_id = ra.id
 and r.reporting_period_id = rp.id
left join public.calculated_metrics cm on cm.report_id = r.id
group by rp.id, d.family;

create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

create trigger trg_templates_updated_at
before update on public.report_templates
for each row execute function public.touch_updated_at();

create trigger trg_departments_updated_at
before update on public.departments
for each row execute function public.touch_updated_at();

create trigger trg_field_definitions_updated_at
before update on public.report_field_definitions
for each row execute function public.touch_updated_at();

create trigger trg_access_requests_updated_at
before update on public.access_requests
for each row execute function public.touch_updated_at();

create trigger trg_assignments_updated_at
before update on public.report_assignments
for each row execute function public.touch_updated_at();

create trigger trg_reports_updated_at
before update on public.reports
for each row execute function public.touch_updated_at();

create trigger trg_report_field_values_updated_at
before update on public.report_field_values
for each row execute function public.touch_updated_at();

create trigger trg_calculated_metrics_updated_at
before update on public.calculated_metrics
for each row execute function public.touch_updated_at();

alter table public.roles enable row level security;
alter table public.profiles enable row level security;
alter table public.report_templates enable row level security;
alter table public.departments enable row level security;
alter table public.report_field_definitions enable row level security;
alter table public.access_requests enable row level security;
alter table public.access_request_items enable row level security;
alter table public.report_assignments enable row level security;
alter table public.reporting_periods enable row level security;
alter table public.reports enable row level security;
alter table public.report_field_values enable row level security;
alter table public.calculated_metrics enable row level security;
alter table public.report_status_history enable row level security;
alter table public.audit_logs enable row level security;
alter table public.notifications enable row level security;
alter table public.app_settings enable row level security;

create policy "roles read for authenticated users"
on public.roles for select
using (auth.role() = 'authenticated');

create policy "profiles self or admin select"
on public.profiles for select
using (id = auth.uid() or public.is_admin());

create policy "profiles self or admin update"
on public.profiles for update
using (id = auth.uid() or public.is_admin())
with check (id = auth.uid() or public.is_admin());

create policy "profiles admin insert"
on public.profiles for insert
with check (public.is_admin());

create policy "reference data read for authenticated users"
on public.report_templates for select
using (auth.role() = 'authenticated');

create policy "template admin manage"
on public.report_templates for all
using (public.is_admin())
with check (public.is_admin());

create policy "departments read for authenticated users"
on public.departments for select
using (auth.role() = 'authenticated');

create policy "departments admin manage"
on public.departments for all
using (public.is_admin())
with check (public.is_admin());

create policy "field definitions read for authenticated users"
on public.report_field_definitions for select
using (auth.role() = 'authenticated');

create policy "field definitions admin manage"
on public.report_field_definitions for all
using (public.is_admin())
with check (public.is_admin());

create policy "access requests read self or admin"
on public.access_requests for select
using (user_id = auth.uid() or public.is_admin());

create policy "access requests insert self"
on public.access_requests for insert
with check (user_id = auth.uid());

create policy "access requests admin update"
on public.access_requests for update
using (public.is_admin())
with check (public.is_admin());

create policy "access request items read self or admin"
on public.access_request_items for select
using (
  public.is_admin()
  or exists (
    select 1
    from public.access_requests ar
    where ar.id = access_request_id
      and ar.user_id = auth.uid()
  )
);

create policy "access request items insert self"
on public.access_request_items for insert
with check (
  exists (
    select 1
    from public.access_requests ar
    where ar.id = access_request_id
      and ar.user_id = auth.uid()
  )
);

create policy "assignments read own or admin"
on public.report_assignments for select
using (nurse_id = auth.uid() or public.is_admin());

create policy "assignments admin manage"
on public.report_assignments for all
using (public.is_admin())
with check (public.is_admin());

create policy "periods read for authenticated users"
on public.reporting_periods for select
using (auth.role() = 'authenticated');

create policy "periods admin manage"
on public.reporting_periods for all
using (public.is_admin())
with check (public.is_admin());

create policy "reports read own or admin"
on public.reports for select
using (
  public.is_admin()
  or exists (
    select 1
    from public.report_assignments ra
    where ra.id = assignment_id
      and ra.nurse_id = auth.uid()
      and ra.active = true
  )
);

create policy "reports insert own assignment"
on public.reports for insert
with check (
  public.is_admin()
  or (
    locked_at is null
    and exists (
      select 1
      from public.report_assignments ra
      where ra.id = assignment_id
        and ra.nurse_id = auth.uid()
        and ra.active = true
    )
  )
);

create policy "reports update own unlocked or admin"
on public.reports for update
using (
  public.is_admin()
  or (
    locked_at is null
    and exists (
      select 1
      from public.report_assignments ra
      where ra.id = assignment_id
        and ra.nurse_id = auth.uid()
        and ra.active = true
    )
  )
)
with check (
  public.is_admin()
  or (
    locked_at is null
    and exists (
      select 1
      from public.report_assignments ra
      where ra.id = assignment_id
        and ra.nurse_id = auth.uid()
        and ra.active = true
    )
  )
);

create policy "report field values read own or admin"
on public.report_field_values for select
using (
  public.is_admin()
  or exists (
    select 1
    from public.reports r
    join public.report_assignments ra on ra.id = r.assignment_id
    where r.id = report_id
      and ra.nurse_id = auth.uid()
      and ra.active = true
  )
);

create policy "report field values mutate own unlocked or admin"
on public.report_field_values for all
using (
  public.is_admin()
  or exists (
    select 1
    from public.reports r
    join public.report_assignments ra on ra.id = r.assignment_id
    where r.id = report_id
      and r.locked_at is null
      and ra.nurse_id = auth.uid()
      and ra.active = true
  )
)
with check (
  public.is_admin()
  or exists (
    select 1
    from public.reports r
    join public.report_assignments ra on ra.id = r.assignment_id
    where r.id = report_id
      and r.locked_at is null
      and ra.nurse_id = auth.uid()
      and ra.active = true
  )
);

create policy "metrics read own or admin"
on public.calculated_metrics for select
using (
  public.is_admin()
  or exists (
    select 1
    from public.reports r
    join public.report_assignments ra on ra.id = r.assignment_id
    where r.id = report_id
      and ra.nurse_id = auth.uid()
      and ra.active = true
  )
);

create policy "metrics admin manage"
on public.calculated_metrics for all
using (public.is_admin())
with check (public.is_admin());

create policy "status history read own or admin"
on public.report_status_history for select
using (
  public.is_admin()
  or exists (
    select 1
    from public.reports r
    join public.report_assignments ra on ra.id = r.assignment_id
    where r.id = report_id
      and ra.nurse_id = auth.uid()
      and ra.active = true
  )
);

create policy "status history insert own or admin"
on public.report_status_history for insert
with check (
  public.is_admin()
  or exists (
    select 1
    from public.reports r
    join public.report_assignments ra on ra.id = r.assignment_id
    where r.id = report_id
      and ra.nurse_id = auth.uid()
      and ra.active = true
  )
);

create policy "audit logs admin only"
on public.audit_logs for select
using (public.is_admin());

create policy "audit logs admin insert"
on public.audit_logs for insert
with check (public.is_admin());

create policy "notifications read recipient or admin"
on public.notifications for select
using (recipient_id = auth.uid() or public.is_admin());

create policy "notifications recipient update"
on public.notifications for update
using (recipient_id = auth.uid() or public.is_admin())
with check (recipient_id = auth.uid() or public.is_admin());

create policy "notifications admin insert"
on public.notifications for insert
with check (public.is_admin());

create policy "settings read authenticated"
on public.app_settings for select
using (auth.role() = 'authenticated');

create policy "settings admin manage"
on public.app_settings for all
using (public.is_admin())
with check (public.is_admin());
