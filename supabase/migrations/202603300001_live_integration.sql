do $$
begin
  alter type public.notification_type add value if not exists 'access_request_reviewed';
exception
  when duplicate_object then null;
end
$$;

alter table public.report_status_history
  add column if not exists changed_by_name text;

alter table public.audit_logs
  add column if not exists changed_by_name text;

update public.report_status_history history
set changed_by_name = profile.full_name
from public.profiles profile
where history.changed_by_name is null
  and profile.id = history.changed_by;

update public.audit_logs audit
set changed_by_name = profile.full_name
from public.profiles profile
where audit.changed_by_name is null
  and profile.id = audit.changed_by;

create or replace function public.deadline_day_offset(p_weekday text)
returns integer
language plpgsql
immutable
as $$
begin
  return case lower(coalesce(p_weekday, 'monday'))
    when 'monday' then 0
    when 'tuesday' then 1
    when 'wednesday' then 2
    when 'thursday' then 3
    when 'friday' then 4
    when 'saturday' then 5
    when 'sunday' then 6
    else 0
  end;
end;
$$;

create or replace function public.report_value_to_text(
  p_value_number numeric,
  p_value_text text,
  p_value_time time,
  p_value_json jsonb
)
returns text
language sql
immutable
as $$
  select
    case
      when p_value_number is not null then p_value_number::text
      when p_value_time is not null then to_char(p_value_time, 'HH24:MI')
      when p_value_text is not null then p_value_text
      when p_value_json is not null then p_value_json::text
      else null
    end;
$$;

create or replace function public.recalculate_reporting_period_deadlines(
  p_weekday text,
  p_time text
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.reporting_periods
  set deadline_at =
    ((week_start + public.deadline_day_offset(p_weekday))::timestamp + p_time::time)
    at time zone 'UTC';
$$;

create or replace function public.sync_profile_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_role_key text;
  v_full_name text;
  v_title text;
begin
  v_role_key := coalesce(new.raw_user_meta_data ->> 'role_key', 'nurse');
  if v_role_key not in ('admin', 'doctor_admin', 'nurse') then
    v_role_key := 'nurse';
  end if;

  v_full_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    split_part(coalesce(new.email, ''), '@', 1)
  );

  v_title := nullif(new.raw_user_meta_data ->> 'title', '');

  insert into public.profiles (
    id,
    role_key,
    email,
    full_name,
    title,
    active
  )
  values (
    new.id,
    v_role_key,
    lower(coalesce(new.email, '')),
    v_full_name,
    coalesce(v_title, 'Applicant Nurse'),
    true
  )
  on conflict (id) do update
  set role_key = excluded.role_key,
      email = excluded.email,
      full_name = excluded.full_name,
      title = coalesce(excluded.title, public.profiles.title),
      active = true,
      updated_at = timezone('utc', now());

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.sync_profile_from_auth_user();

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
after update of email, raw_user_meta_data on auth.users
for each row execute function public.sync_profile_from_auth_user();

create or replace function public.update_app_settings(
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

create or replace function public.submit_access_request(
  p_user_id uuid,
  p_full_name text,
  p_email text,
  p_requested_assignments jsonb,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
  v_assignment jsonb;
  v_department_id uuid;
  v_template_id uuid;
  v_email text := lower(trim(p_email));
  v_inserted_count integer := 0;
begin
  if p_user_id is null then
    raise exception 'A valid user id is required for access requests.';
  end if;

  if coalesce(v_email, '') = '' then
    raise exception 'A valid email is required for access requests.';
  end if;

  if p_requested_assignments is null or jsonb_typeof(p_requested_assignments) <> 'array' then
    raise exception 'Requested assignments must be a JSON array.';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = p_user_id
      and email = v_email
  ) then
    raise exception 'No matching Supabase profile was found for the access request.';
  end if;

  update public.profiles
  set full_name = coalesce(nullif(trim(p_full_name), ''), full_name),
      email = v_email,
      role_key = 'nurse',
      title = coalesce(title, 'Applicant Nurse'),
      active = true,
      updated_at = timezone('utc', now())
  where id = p_user_id;

  insert into public.access_requests (
    user_id,
    email,
    status,
    notes,
    requested_at
  )
  values (
    p_user_id,
    v_email,
    'pending',
    nullif(trim(p_notes), ''),
    timezone('utc', now())
  )
  returning id into v_request_id;

  for v_assignment in
    select value
    from jsonb_array_elements(p_requested_assignments)
  loop
    select d.id, t.id
    into v_department_id, v_template_id
    from public.departments d
    join public.report_templates t
      on t.slug = coalesce(v_assignment ->> 'templateId', t.slug)
    where d.slug = v_assignment ->> 'departmentId'
      and d.template_id = t.id;

    if v_department_id is null or v_template_id is null then
      raise exception 'Invalid department/template selection in access request.';
    end if;

    insert into public.access_request_items (
      access_request_id,
      department_id,
      template_id
    )
    values (
      v_request_id,
      v_department_id,
      v_template_id
    )
    on conflict (access_request_id, department_id, template_id) do nothing;

    v_inserted_count := v_inserted_count + 1;
  end loop;

  if v_inserted_count = 0 then
    raise exception 'At least one requested assignment is required.';
  end if;

  insert into public.notifications (
    recipient_id,
    type,
    title,
    message,
    related_route,
    related_entity
  )
  select
    profile.id,
    'nurse_access_request',
    'Nurse access request',
    format('%s requested additional ward or template access.', (select full_name from public.profiles where id = p_user_id)),
    '/admin/users',
    format('access_request:%s', v_request_id)
  from public.profiles profile
  where profile.role_key in ('admin', 'doctor_admin')
    and profile.active = true;

  return v_request_id;
end;
$$;

create or replace function public.review_access_request(
  p_request_id uuid,
  p_decision text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_name text;
  v_request public.access_requests%rowtype;
  v_decision public.access_request_status;
begin
  if v_actor_id is null or not public.is_admin() then
    raise exception 'Admin privileges are required to review access requests.';
  end if;

  select full_name
  into v_actor_name
  from public.profiles
  where id = v_actor_id;

  select *
  into v_request
  from public.access_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Access request not found.';
  end if;

  if lower(coalesce(p_decision, '')) not in ('approved', 'rejected') then
    raise exception 'Access request review must be approved or rejected.';
  end if;

  v_decision := lower(p_decision)::public.access_request_status;

  update public.access_requests
  set status = v_decision,
      reviewed_at = timezone('utc', now()),
      reviewed_by = v_actor_id
  where id = p_request_id;

  if v_decision = 'approved' then
    insert into public.report_assignments (
      nurse_id,
      department_id,
      template_id,
      active,
      approved_at,
      approved_by
    )
    select
      v_request.user_id,
      item.department_id,
      item.template_id,
      true,
      timezone('utc', now()),
      v_actor_id
    from public.access_request_items item
    where item.access_request_id = p_request_id
    on conflict (nurse_id, department_id, template_id) do update
    set active = true,
        approved_at = excluded.approved_at,
        approved_by = excluded.approved_by,
        updated_at = timezone('utc', now());

    insert into public.notifications (
      recipient_id,
      type,
      title,
      message,
      related_route,
      related_entity
    )
    values (
      v_request.user_id,
      'access_request_reviewed',
      'Access approved',
      format('%s approved your requested reporting access.', coalesce(v_actor_name, 'An administrator')),
      '/nurse/reports',
      format('access_request:%s', p_request_id)
    );
  else
    insert into public.notifications (
      recipient_id,
      type,
      title,
      message,
      related_route,
      related_entity
    )
    values (
      v_request.user_id,
      'access_request_reviewed',
      'Access request reviewed',
      format('%s reviewed your access request. Please contact administration for follow-up.', coalesce(v_actor_name, 'An administrator')),
      '/register',
      format('access_request:%s', p_request_id)
    );
  end if;

  return p_request_id;
end;
$$;

create or replace function public.set_report_lock_state(
  p_report_id uuid,
  p_locked boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_name text;
  v_report public.reports%rowtype;
  v_assignment public.report_assignments%rowtype;
  v_department_name text;
  v_now timestamptz := timezone('utc', now());
  v_next_status public.report_status;
begin
  if v_actor_id is null or not public.is_admin() then
    raise exception 'Admin privileges are required to change report locks.';
  end if;

  select full_name into v_actor_name from public.profiles where id = v_actor_id;

  select *
  into v_report
  from public.reports
  where id = p_report_id
  for update;

  if not found then
    raise exception 'Report not found.';
  end if;

  select *
  into v_assignment
  from public.report_assignments
  where id = v_report.assignment_id;

  select name into v_department_name from public.departments where id = v_report.department_id;

  if p_locked then
    if v_report.locked_at is not null then
      return p_report_id;
    end if;

    update public.reports
    set status = 'locked',
        locked_at = v_now,
        updated_at = v_now,
        updated_by = v_actor_id
    where id = p_report_id;

    insert into public.report_status_history (
      report_id,
      status,
      changed_by,
      changed_by_name,
      note,
      changed_at
    )
    values (
      p_report_id,
      'locked',
      v_actor_id,
      v_actor_name,
      'Report locked after review.',
      v_now
    );

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
      v_assignment.nurse_id,
      'report_locked',
      'Report locked',
      format('%s has been locked for review.', coalesce(v_department_name, 'This report')),
      format('/reports/%s/%s', v_assignment.id, v_report.reporting_period_id),
      'report_lock',
      p_report_id
    );
  else
    if v_report.locked_at is null then
      return p_report_id;
    end if;

    v_next_status := case
      when exists (
        select 1
        from public.report_status_history history
        where history.report_id = p_report_id
          and history.status = 'edited_after_submission'
      ) then 'edited_after_submission'
      else 'submitted'
    end;

    update public.reports
    set status = v_next_status,
        locked_at = null,
        updated_at = v_now,
        updated_by = v_actor_id
    where id = p_report_id;

    insert into public.report_status_history (
      report_id,
      status,
      changed_by,
      changed_by_name,
      note,
      changed_at
    )
    values (
      p_report_id,
      v_next_status,
      v_actor_id,
      v_actor_name,
      'Report unlocked for correction.',
      v_now
    );

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
      v_assignment.nurse_id,
      'report_unlocked',
      'Report unlocked',
      format('%s has been unlocked for correction.', coalesce(v_department_name, 'This report')),
      format('/reports/%s/%s', v_assignment.id, v_report.reporting_period_id),
      'report_unlock',
      p_report_id
    );
  end if;

  return p_report_id;
end;
$$;

create or replace function public.save_report(
  p_assignment_id uuid,
  p_reporting_period_id uuid,
  p_values jsonb,
  p_submit boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_name text;
  v_actor_role text;
  v_assignment public.report_assignments%rowtype;
  v_report public.reports%rowtype;
  v_report_id uuid;
  v_created_report boolean := false;
  v_had_submission boolean := false;
  v_now timestamptz := timezone('utc', now());
  v_template public.report_templates%rowtype;
  v_department_name text;
  v_related_route text;
  v_field_item record;
  v_day_item record;
  v_field_definition public.report_field_definitions%rowtype;
  v_existing_value public.report_field_values%rowtype;
  v_new_number numeric;
  v_new_text text;
  v_new_time time;
  v_new_json jsonb;
  v_new_value_text text;
  v_old_value_text text;
  v_has_changes boolean := false;
  v_next_status public.report_status;
begin
  if v_actor_id is null then
    raise exception 'A signed-in user is required to save reports.';
  end if;

  select full_name, role_key
  into v_actor_name, v_actor_role
  from public.profiles
  where id = v_actor_id;

  if v_actor_name is null then
    raise exception 'No profile exists for the signed-in user.';
  end if;

  select *
  into v_assignment
  from public.report_assignments
  where id = p_assignment_id;

  if not found then
    raise exception 'Report assignment not found.';
  end if;

  if v_actor_role not in ('admin', 'doctor_admin')
    and (v_assignment.nurse_id <> v_actor_id or not v_assignment.active) then
    raise exception 'You are not allowed to edit this assignment.';
  end if;

  select *
  into v_template
  from public.report_templates
  where id = v_assignment.template_id;

  if not found then
    raise exception 'Report template not found.';
  end if;

  select name into v_department_name from public.departments where id = v_assignment.department_id;

  select *
  into v_report
  from public.reports
  where assignment_id = p_assignment_id
    and reporting_period_id = p_reporting_period_id
  for update;

  if found and v_report.locked_at is not null then
    raise exception 'Locked reports are read-only.';
  end if;

  if not found then
    insert into public.reports (
      assignment_id,
      department_id,
      template_id,
      reporting_period_id,
      status,
      submitted_at,
      created_by,
      updated_by
    )
    values (
      p_assignment_id,
      v_assignment.department_id,
      v_assignment.template_id,
      p_reporting_period_id,
      case when p_submit then 'submitted' else 'draft' end,
      case when p_submit then v_now else null end,
      v_actor_id,
      v_actor_id
    )
    returning * into v_report;

    v_created_report := true;
  end if;

  v_report_id := v_report.id;
  v_had_submission := v_report.submitted_at is not null;
  v_related_route := format('/reports/%s/%s', p_assignment_id, p_reporting_period_id);

  for v_field_item in
    select key, value
    from jsonb_each(coalesce(p_values, '{}'::jsonb))
  loop
    select *
    into v_field_definition
    from public.report_field_definitions
    where template_id = v_assignment.template_id
      and field_key = v_field_item.key;

    if not found then
      raise exception 'Unknown field key % for this report template.', v_field_item.key;
    end if;

    for v_day_item in
      select key, value
      from jsonb_each(coalesce(v_field_item.value -> 'dailyValues', '{}'::jsonb))
    loop
      if not (v_day_item.key = any(v_template.active_days)) then
        raise exception 'Day % is not valid for this template.', v_day_item.key;
      end if;

      v_new_number := null;
      v_new_text := null;
      v_new_time := null;
      v_new_json := null;

      select *
      into v_existing_value
      from public.report_field_values
      where report_id = v_report_id
        and field_definition_id = v_field_definition.id
        and day_name = v_day_item.key;

      v_old_value_text := public.report_value_to_text(
        v_existing_value.value_number,
        v_existing_value.value_text,
        v_existing_value.value_time,
        v_existing_value.value_json
      );

      if v_day_item.value <> 'null'::jsonb then
        case v_field_definition.field_kind
          when 'integer' then
            v_new_number := trim(both '"' from v_day_item.value::text)::numeric;
            if v_new_number < 0 or trunc(v_new_number) <> v_new_number then
              raise exception 'Field % expects a non-negative whole number.', v_field_definition.field_key;
            end if;
          when 'decimal' then
            v_new_number := trim(both '"' from v_day_item.value::text)::numeric;
            if v_new_number < 0 then
              raise exception 'Field % expects a non-negative decimal value.', v_field_definition.field_key;
            end if;
          when 'time' then
            v_new_text := trim(both '"' from v_day_item.value::text);
            if v_new_text !~ '^\d{2}:\d{2}$' then
              raise exception 'Field % expects HH:MM time values.', v_field_definition.field_key;
            end if;
            v_new_time := v_new_text::time;
            v_new_text := null;
          when 'choice' then
            v_new_text := trim(both '"' from v_day_item.value::text);
            if not exists (
              select 1
              from jsonb_array_elements_text(coalesce(v_field_definition.metadata -> 'options', '[]'::jsonb)) option_value
              where option_value = v_new_text
            ) then
              raise exception 'Field % expects one of the configured choice options.', v_field_definition.field_key;
            end if;
          when 'text' then
            v_new_text := trim(both '"' from v_day_item.value::text);
          else
            raise exception 'Unsupported field type %.', v_field_definition.field_kind;
        end case;
      end if;

      v_new_value_text := public.report_value_to_text(
        v_new_number,
        v_new_text,
        v_new_time,
        v_new_json
      );

      if v_old_value_text is distinct from v_new_value_text then
        v_has_changes := true;

        if v_had_submission then
          insert into public.audit_logs (
            report_id,
            field_definition_id,
            field_key,
            day_name,
            old_value,
            new_value,
            changed_by,
            changed_by_name,
            changed_at,
            department_id,
            template_id
          )
          values (
            v_report_id,
            v_field_definition.id,
            v_field_definition.field_key,
            v_day_item.key,
            v_old_value_text,
            v_new_value_text,
            v_actor_id,
            v_actor_name,
            v_now,
            v_assignment.department_id,
            v_assignment.template_id
          );
        end if;
      end if;

      if v_new_value_text is null then
        if v_existing_value.id is not null then
          delete from public.report_field_values
          where id = v_existing_value.id;
        end if;
      else
        insert into public.report_field_values (
          report_id,
          field_definition_id,
          day_name,
          value_number,
          value_text,
          value_time,
          value_json
        )
        values (
          v_report_id,
          v_field_definition.id,
          v_day_item.key,
          v_new_number,
          v_new_text,
          v_new_time,
          v_new_json
        )
        on conflict (report_id, field_definition_id, day_name) do update
        set value_number = excluded.value_number,
            value_text = excluded.value_text,
            value_time = excluded.value_time,
            value_json = excluded.value_json,
            updated_at = timezone('utc', now());
      end if;
    end loop;
  end loop;

  if v_had_submission then
    if v_has_changes then
      v_next_status := 'edited_after_submission';
    elsif v_report.status = 'edited_after_submission' then
      v_next_status := 'edited_after_submission';
    else
      v_next_status := 'submitted';
    end if;
  elsif p_submit then
    v_next_status := 'submitted';
  else
    v_next_status := 'draft';
  end if;

  update public.reports
  set status = v_next_status,
      submitted_at = case
        when v_had_submission then v_report.submitted_at
        when p_submit then v_now
        else null
      end,
      updated_at = v_now,
      updated_by = v_actor_id
  where id = v_report_id;

  if v_created_report then
    insert into public.report_status_history (
      report_id,
      status,
      changed_by,
      changed_by_name,
      note,
      changed_at
    )
    values (
      v_report_id,
      'draft',
      v_actor_id,
      v_actor_name,
      'Draft created from the web form.',
      v_now
    );
  end if;

  if not v_had_submission and p_submit then
    insert into public.report_status_history (
      report_id,
      status,
      changed_by,
      changed_by_name,
      note,
      changed_at
    )
    values (
      v_report_id,
      'submitted',
      v_actor_id,
      v_actor_name,
      'Weekly report submitted.',
      v_now
    );

    insert into public.notifications (
      recipient_id,
      type,
      title,
      message,
      related_route,
      related_entity,
      related_id
    )
    select
      profile.id,
      'new_report_submitted',
      'New report submitted',
      format('%s submitted %s.', coalesce(v_department_name, 'A department'), v_template.name),
      v_related_route,
      'report_submission',
      v_report_id
    from public.profiles profile
    where profile.role_key in ('admin', 'doctor_admin')
      and profile.active = true;
  elsif v_had_submission and v_has_changes then
    insert into public.report_status_history (
      report_id,
      status,
      changed_by,
      changed_by_name,
      note,
      changed_at
    )
    values (
      v_report_id,
      'edited_after_submission',
      v_actor_id,
      v_actor_name,
      'Submitted report changed while still unlocked.',
      v_now
    );

    insert into public.notifications (
      recipient_id,
      type,
      title,
      message,
      related_route,
      related_entity,
      related_id
    )
    select
      profile.id,
      'submitted_report_edited',
      'Submitted report edited',
      format('%s was updated after submission by %s.', coalesce(v_department_name, 'A department'), v_actor_name),
      v_related_route,
      'report_edit',
      v_report_id
    from public.profiles profile
    where profile.role_key in ('admin', 'doctor_admin')
      and profile.active = true;
  end if;

  perform public.upsert_calculated_metrics(v_report_id);

  return v_report_id;
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
begin
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
      on period.deadline_at < timezone('utc', now())
    left join public.reports report
      on report.assignment_id = assignment.id
     and report.reporting_period_id = period.id
    where assignment.active = true
      and (
        report.id is null
        or (report.status = 'draft' and report.locked_at is null)
      )
  loop
    v_event_key := format('overdue:%s:%s', v_item.assignment_id, v_item.reporting_period_id);
    v_route := format('/reports/%s/%s', v_item.assignment_id, v_item.reporting_period_id);

    if not exists (
      select 1
      from public.notifications
      where recipient_id = v_item.nurse_id
        and type = 'overdue_report'
        and related_entity = v_event_key
    ) then
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
    end if;

    for v_admin in
      select id
      from public.profiles
      where role_key in ('admin', 'doctor_admin')
        and active = true
    loop
      if not exists (
        select 1
        from public.notifications
        where recipient_id = v_admin.id
          and type = 'overdue_report'
          and related_entity = v_event_key
      ) then
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
      end if;
    end loop;
  end loop;
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
    on conflict (report_id) do update
    set bor_percent = null,
        btr = null,
        alos = null,
        metric_payload = '{}'::jsonb,
        updated_at = timezone('utc', now());
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

create or replace view public.v_submission_board
with (security_invoker = true) as
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

create or replace view public.v_department_metric_weekly
with (security_invoker = true) as
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

create or replace view public.v_dashboard_weekly_summary
with (security_invoker = true) as
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

revoke all on function public.update_app_settings(text, text, integer, integer, integer, jsonb) from public;
grant execute on function public.update_app_settings(text, text, integer, integer, integer, jsonb) to authenticated;

revoke all on function public.submit_access_request(uuid, text, text, jsonb, text) from public;
grant execute on function public.submit_access_request(uuid, text, text, jsonb, text) to anon, authenticated;

revoke all on function public.review_access_request(uuid, text) from public;
grant execute on function public.review_access_request(uuid, text) to authenticated;

revoke all on function public.set_report_lock_state(uuid, boolean) from public;
grant execute on function public.set_report_lock_state(uuid, boolean) to authenticated;

revoke all on function public.save_report(uuid, uuid, jsonb, boolean) from public;
grant execute on function public.save_report(uuid, uuid, jsonb, boolean) to authenticated;

revoke all on function public.sync_overdue_notifications() from public;
grant execute on function public.sync_overdue_notifications() to authenticated;
