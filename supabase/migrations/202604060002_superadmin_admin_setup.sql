insert into public.roles (role_key, label, description)
values (
  'superadmin',
  'Superadmin',
  'Single protected administrator who can provision and manage admin accounts'
)
on conflict (role_key) do update
set label = excluded.label,
    description = excluded.description;

alter table public.profiles
  add column if not exists username text;

create unique index if not exists idx_profiles_username_unique
on public.profiles (lower(username))
where username is not null;

create unique index if not exists idx_profiles_single_superadmin
on public.profiles (role_key)
where role_key = 'superadmin';

create or replace function public.is_admin_role(p_role_key text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_role_key, '') in ('superadmin', 'admin', 'doctor_admin');
$$;

create or replace function public.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role() = 'superadmin';
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin_role(public.current_role());
$$;

drop policy if exists "profiles self or admin update" on public.profiles;
drop policy if exists "profiles self update safe" on public.profiles;
drop policy if exists "profiles admin manage nurses" on public.profiles;
drop policy if exists "profiles superadmin manage all" on public.profiles;

create policy "profiles self update safe"
on public.profiles for update
using (id = auth.uid())
with check (
  id = auth.uid()
  and role_key = (select profile.role_key from public.profiles profile where profile.id = auth.uid())
  and active = (select profile.active from public.profiles profile where profile.id = auth.uid())
);

create policy "profiles admin manage nurses"
on public.profiles for update
using (public.is_admin() and role_key = 'nurse')
with check (public.is_admin() and role_key = 'nurse');

create policy "profiles superadmin manage all"
on public.profiles for update
using (public.is_superadmin())
with check (public.is_superadmin());

create or replace function public.resolve_sign_in_email(p_identifier text)
returns text
language sql
security definer
set search_path = public
as $$
  select profile.email
  from public.profiles profile
  where lower(profile.email) = lower(trim(p_identifier))
     or lower(coalesce(profile.username, '')) = lower(trim(p_identifier))
  order by
    case when lower(profile.email) = lower(trim(p_identifier)) then 0 else 1 end,
    profile.created_at asc
  limit 1;
$$;

create or replace function public.sync_profile_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_full_name text;
  v_title text;
  v_username text;
begin
  v_full_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    split_part(coalesce(new.email, ''), '@', 1)
  );

  v_title := nullif(new.raw_user_meta_data ->> 'title', '');
  v_username := nullif(lower(trim(new.raw_user_meta_data ->> 'username')), '');

  if v_username is not null and v_username !~ '^[a-z0-9._-]{3,32}$' then
    v_username := null;
  end if;

  insert into public.profiles (
    id,
    role_key,
    email,
    username,
    full_name,
    title,
    active
  )
  values (
    new.id,
    'nurse',
    lower(coalesce(new.email, '')),
    v_username,
    v_full_name,
    coalesce(v_title, 'Applicant Nurse'),
    true
  )
  on conflict (id) do update
  set email = excluded.email,
      username = coalesce(excluded.username, public.profiles.username),
      full_name = excluded.full_name,
      title = coalesce(excluded.title, public.profiles.title),
      updated_at = timezone('utc', now());

  return new;
end;
$$;

create or replace function public.claim_superadmin(
  p_username text,
  p_full_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_username text := nullif(lower(trim(p_username)), '');
  v_full_name text := nullif(trim(coalesce(p_full_name, '')), '');
begin
  if v_actor_id is null then
    raise exception 'A signed-in administrator is required.';
  end if;

  if not public.is_admin_role(public.current_role()) then
    raise exception 'Admin access is required to claim the superadmin account.';
  end if;

  if coalesce(v_username, '') = '' or v_username !~ '^[a-z0-9._-]{3,32}$' then
    raise exception 'Use a username with 3 to 32 letters, numbers, dots, underscores, or hyphens.';
  end if;

  if exists (
    select 1
    from public.profiles profile
    where profile.role_key = 'superadmin'
      and profile.id <> v_actor_id
  ) then
    raise exception 'A superadmin account is already configured.';
  end if;

  update public.profiles
  set username = v_username,
      full_name = coalesce(v_full_name, full_name),
      role_key = 'superadmin',
      title = 'Super Administrator',
      active = true,
      updated_at = timezone('utc', now())
  where id = v_actor_id;

  if not found then
    raise exception 'The current profile could not be promoted.';
  end if;

  return v_actor_id;
end;
$$;

create or replace function public.provision_admin_account(
  p_user_id uuid,
  p_email text,
  p_username text,
  p_full_name text,
  p_role_key text default 'admin',
  p_title text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role_key text := lower(trim(coalesce(p_role_key, 'admin')));
  v_email text := lower(trim(coalesce(p_email, '')));
  v_username text := lower(trim(coalesce(p_username, '')));
  v_full_name text := nullif(trim(coalesce(p_full_name, '')), '');
  v_title text := nullif(trim(coalesce(p_title, '')), '');
begin
  if not public.is_superadmin() then
    raise exception 'Only the superadmin can provision admin accounts.';
  end if;

  if p_user_id is null then
    raise exception 'A valid auth user id is required.';
  end if;

  if v_role_key not in ('admin', 'doctor_admin') then
    raise exception 'Only admin or doctor_admin accounts can be created here.';
  end if;

  if v_email = '' then
    raise exception 'A valid email is required.';
  end if;

  if v_username = '' or v_username !~ '^[a-z0-9._-]{3,32}$' then
    raise exception 'Use a username with 3 to 32 letters, numbers, dots, underscores, or hyphens.';
  end if;

  if v_full_name is null then
    raise exception 'A valid full name is required.';
  end if;

  if not exists (
    select 1
    from public.profiles profile
    where profile.id = p_user_id
  ) then
    raise exception 'The auth user profile does not exist yet.';
  end if;

  update public.profiles
  set email = v_email,
      username = v_username,
      full_name = v_full_name,
      role_key = v_role_key,
      title = coalesce(
        v_title,
        case
          when v_role_key = 'doctor_admin' then 'Clinical Director'
          else 'Administrator'
        end
      ),
      active = true,
      updated_at = timezone('utc', now())
  where id = p_user_id;

  return p_user_id;
end;
$$;

create or replace function public.set_profile_active_state(
  p_user_id uuid,
  p_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_target public.profiles%rowtype;
begin
  if v_actor_id is null or not public.is_admin() then
    raise exception 'Admin privileges are required to update user access.';
  end if;

  select *
  into v_target
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'User profile not found.';
  end if;

  if v_target.role_key = 'superadmin' then
    raise exception 'The protected superadmin account cannot be deactivated here.';
  end if;

  if public.is_admin_role(v_target.role_key) and not public.is_superadmin() then
    raise exception 'Only the superadmin can activate or deactivate admin accounts.';
  end if;

  update public.profiles
  set active = p_active,
      updated_at = timezone('utc', now())
  where id = p_user_id;

  return p_user_id;
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
      role_key = case
        when public.is_admin_role(role_key) then role_key
        else 'nurse'
      end,
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
  where public.is_admin_role(profile.role_key)
    and profile.active = true;

  return v_request_id;
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

  if not public.is_admin_role(v_actor_role)
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
      case
        when p_submit then 'submitted'::public.report_status
        else 'draft'::public.report_status
      end,
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
      v_next_status := 'edited_after_submission'::public.report_status;
    elsif v_report.status = 'edited_after_submission'::public.report_status then
      v_next_status := 'edited_after_submission'::public.report_status;
    else
      v_next_status := 'submitted'::public.report_status;
    end if;
  elsif p_submit then
    v_next_status := 'submitted'::public.report_status;
  else
    v_next_status := 'draft'::public.report_status;
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
      'draft'::public.report_status,
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
      'submitted'::public.report_status,
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
      'new_report_submitted'::public.notification_type,
      'New report submitted',
      format('%s submitted %s.', coalesce(v_department_name, 'A department'), v_template.name),
      v_related_route,
      'report_submission',
      v_report_id
    from public.profiles profile
    where public.is_admin_role(profile.role_key)
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
      'edited_after_submission'::public.report_status,
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
      'submitted_report_edited'::public.notification_type,
      'Submitted report edited',
      format('%s was updated after submission by %s.', coalesce(v_department_name, 'A department'), v_actor_name),
      v_related_route,
      'report_edit',
      v_report_id
    from public.profiles profile
    where public.is_admin_role(profile.role_key)
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
  v_current_period_start date;
  v_live_start date := date '2026-03-30';
begin
  select period.week_start
  into v_current_period_start
  from public.reporting_periods period
  where period.week_start <= current_date
  order by period.week_start desc
  limit 1;

  delete from public.notifications
  where type = 'overdue_report';

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

revoke all on function public.resolve_sign_in_email(text) from public;
grant execute on function public.resolve_sign_in_email(text) to anon, authenticated;

revoke all on function public.claim_superadmin(text, text) from public;
grant execute on function public.claim_superadmin(text, text) to authenticated;

revoke all on function public.provision_admin_account(uuid, text, text, text, text, text) from public;
grant execute on function public.provision_admin_account(uuid, text, text, text, text, text) to authenticated;

revoke all on function public.set_profile_active_state(uuid, boolean) from public;
grant execute on function public.set_profile_active_state(uuid, boolean) to authenticated;

revoke all on function public.submit_access_request(uuid, text, text, jsonb, text) from public;
grant execute on function public.submit_access_request(uuid, text, text, jsonb, text) to anon, authenticated;

revoke all on function public.save_report(uuid, uuid, jsonb, boolean) from public;
grant execute on function public.save_report(uuid, uuid, jsonb, boolean) to authenticated;

revoke all on function public.sync_overdue_notifications() from public;
grant execute on function public.sync_overdue_notifications() to authenticated;
