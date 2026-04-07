insert into public.app_settings (setting_key, value_json)
values ('workflow_controls', '{"deadline_enforced":true}'::jsonb)
on conflict (setting_key) do update
set value_json = coalesce(public.app_settings.value_json, excluded.value_json),
    updated_at = timezone('utc', now());

create or replace function public.deadline_enforced()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select (value_json ->> 'deadline_enforced')::boolean
     from public.app_settings
     where setting_key = 'workflow_controls'),
    true
  );
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

  if not public.deadline_enforced() then
    if current_status = 'draft' then
      return 'draft';
    end if;

    return 'not_started';
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

drop function if exists public.update_app_settings(text, text, integer, integer, integer, jsonb);

create or replace function public.update_app_settings(
  p_deadline_enforced boolean default null,
  p_weekly_deadline_day text default null,
  p_weekly_deadline_time text default null,
  p_auto_lock_hours_after_deadline integer default null,
  p_notable_rise_threshold_percent integer default null,
  p_notable_drop_threshold_percent integer default null,
  p_critical_non_zero_fields jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_deadline_enforced boolean;
  v_weekday text;
  v_time text;
  v_auto_lock integer;
  v_rise integer;
  v_drop integer;
  v_critical jsonb;
begin
  if v_actor_id is null or not public.is_admin() then
    raise exception 'Admin privileges are required to update settings.';
  end if;

  v_deadline_enforced := coalesce(
    p_deadline_enforced,
    (select (value_json ->> 'deadline_enforced')::boolean
     from public.app_settings
     where setting_key = 'workflow_controls'),
    true
  );

  v_weekday := coalesce(
    lower(p_weekly_deadline_day),
    (select value_json ->> 'day' from public.app_settings where setting_key = 'weekly_deadline'),
    'monday'
  );
  v_time := coalesce(
    p_weekly_deadline_time,
    (select value_json ->> 'time' from public.app_settings where setting_key = 'weekly_deadline'),
    '10:00'
  );
  v_auto_lock := coalesce(
    p_auto_lock_hours_after_deadline,
    ((select value_json ->> 'auto_lock_hours_after_deadline'
      from public.app_settings
      where setting_key = 'locking_rules')::integer),
    36
  );
  v_rise := coalesce(
    p_notable_rise_threshold_percent,
    ((select value_json ->> 'rise_percent'
      from public.app_settings
      where setting_key = 'insight_thresholds')::integer),
    10
  );
  v_drop := coalesce(
    p_notable_drop_threshold_percent,
    ((select value_json ->> 'drop_percent'
      from public.app_settings
      where setting_key = 'insight_thresholds')::integer),
    10
  );
  v_critical := coalesce(
    p_critical_non_zero_fields,
    (select value_json from public.app_settings where setting_key = 'critical_non_zero_fields'),
    '[]'::jsonb
  );

  insert into public.app_settings (setting_key, value_json, updated_by)
  values ('workflow_controls', jsonb_build_object('deadline_enforced', v_deadline_enforced), v_actor_id)
  on conflict (setting_key) do update
  set value_json = excluded.value_json,
      updated_by = excluded.updated_by,
      updated_at = timezone('utc', now());

  insert into public.app_settings (setting_key, value_json, updated_by)
  values ('weekly_deadline', jsonb_build_object('day', v_weekday, 'time', v_time), v_actor_id)
  on conflict (setting_key) do update
  set value_json = excluded.value_json,
      updated_by = excluded.updated_by,
      updated_at = timezone('utc', now());

  insert into public.app_settings (setting_key, value_json, updated_by)
  values (
    'locking_rules',
    jsonb_build_object('auto_lock_hours_after_deadline', v_auto_lock),
    v_actor_id
  )
  on conflict (setting_key) do update
  set value_json = excluded.value_json,
      updated_by = excluded.updated_by,
      updated_at = timezone('utc', now());

  insert into public.app_settings (setting_key, value_json, updated_by)
  values (
    'insight_thresholds',
    jsonb_build_object('rise_percent', v_rise, 'drop_percent', v_drop),
    v_actor_id
  )
  on conflict (setting_key) do update
  set value_json = excluded.value_json,
      updated_by = excluded.updated_by,
      updated_at = timezone('utc', now());

  insert into public.app_settings (setting_key, value_json, updated_by)
  values ('critical_non_zero_fields', v_critical, v_actor_id)
  on conflict (setting_key) do update
  set value_json = excluded.value_json,
      updated_by = excluded.updated_by,
      updated_at = timezone('utc', now());

  perform public.recalculate_reporting_period_deadlines(v_weekday, v_time);
end;
$$;

create or replace function public.sync_overdue_notifications()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
  v_admin record;
  v_event_key text;
  v_route text;
  v_current_period_start date;
  v_live_start date := date '2026-03-02';
begin
  delete from public.notifications
  where type = 'overdue_report';

  if not public.deadline_enforced() then
    return;
  end if;

  select period.week_start
  into v_current_period_start
  from public.reporting_periods period
  where period.week_start <= current_date
  order by period.week_start desc
  limit 1;

  if v_current_period_start is null then
    return;
  end if;

  for v_item in
    select
      assignment.id as assignment_id,
      assignment.nurse_id,
      department.name as department_name,
      period.id as reporting_period_id,
      report.id as report_id
    from public.report_assignments assignment
    join public.departments department
      on department.id = assignment.department_id
    join public.reporting_periods period
      on period.week_start >= v_live_start
     and period.week_start <= v_current_period_start
     and period.deadline_at < timezone('utc', now())
    left join public.reports report
      on report.assignment_id = assignment.id
     and report.reporting_period_id = period.id
    where assignment.active = true
      and (
        report.id is null
        or (report.status = 'draft'::public.report_status and report.locked_at is null)
      )
  loop
    v_event_key := format('overdue:%s:%s', v_item.assignment_id, v_item.reporting_period_id);
    v_route := format('/reports/%s/%s', v_item.assignment_id, v_item.reporting_period_id);

    insert into public.notifications (
      recipient_id,
      type,
      title,
      message,
      related_route,
      related_entity,
      related_id
    )
    values (
      v_item.nurse_id,
      'overdue_report',
      'Overdue report',
      format('%s is overdue and still needs submission.', v_item.department_name),
      v_route,
      v_event_key,
      v_item.report_id
    );

    for v_admin in
      select id
      from public.profiles
      where public.is_admin_role(role_key)
        and active = true
    loop
      insert into public.notifications (
        recipient_id,
        type,
        title,
        message,
        related_route,
        related_entity,
        related_id
      )
      values (
        v_admin.id,
        'overdue_report',
        'Overdue report',
        format('%s missed the reporting deadline.', v_item.department_name),
        v_route,
        v_event_key,
        v_item.report_id
      );
    end loop;
  end loop;
end;
$$;

revoke all on function public.update_app_settings(boolean, text, text, integer, integer, integer, jsonb) from public;
grant execute on function public.update_app_settings(boolean, text, text, integer, integer, integer, jsonb) to authenticated;
