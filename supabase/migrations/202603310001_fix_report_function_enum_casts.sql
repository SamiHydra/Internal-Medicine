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
    set status = 'locked'::public.report_status,
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
      'locked'::public.report_status,
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
      'report_locked'::public.notification_type,
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
          and history.status = 'edited_after_submission'::public.report_status
      ) then 'edited_after_submission'::public.report_status
      else 'submitted'::public.report_status
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
      'report_unlocked'::public.notification_type,
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
    where profile.role_key in ('admin', 'doctor_admin')
      and profile.active = true;
  end if;

  perform public.upsert_calculated_metrics(v_report_id);

  return v_report_id;
end;
$$;
