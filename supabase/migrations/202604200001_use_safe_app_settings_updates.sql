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
  v_workflow_controls jsonb;
  v_weekly_deadline jsonb;
  v_locking_rules jsonb;
  v_insight_thresholds jsonb;
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

  v_workflow_controls := jsonb_build_object('deadline_enforced', v_deadline_enforced);
  v_weekly_deadline := jsonb_build_object('day', v_weekday, 'time', v_time);
  v_locking_rules := jsonb_build_object('auto_lock_hours_after_deadline', v_auto_lock);
  v_insight_thresholds := jsonb_build_object('rise_percent', v_rise, 'drop_percent', v_drop);

  insert into public.app_settings (setting_key, value_json, updated_by)
  values ('workflow_controls', v_workflow_controls, v_actor_id)
  on conflict (setting_key) do nothing;

  update public.app_settings
  set value_json = v_workflow_controls,
      updated_by = v_actor_id,
      updated_at = timezone('utc', now())
  where setting_key = 'workflow_controls';

  insert into public.app_settings (setting_key, value_json, updated_by)
  values ('weekly_deadline', v_weekly_deadline, v_actor_id)
  on conflict (setting_key) do nothing;

  update public.app_settings
  set value_json = v_weekly_deadline,
      updated_by = v_actor_id,
      updated_at = timezone('utc', now())
  where setting_key = 'weekly_deadline';

  insert into public.app_settings (setting_key, value_json, updated_by)
  values ('locking_rules', v_locking_rules, v_actor_id)
  on conflict (setting_key) do nothing;

  update public.app_settings
  set value_json = v_locking_rules,
      updated_by = v_actor_id,
      updated_at = timezone('utc', now())
  where setting_key = 'locking_rules';

  insert into public.app_settings (setting_key, value_json, updated_by)
  values ('insight_thresholds', v_insight_thresholds, v_actor_id)
  on conflict (setting_key) do nothing;

  update public.app_settings
  set value_json = v_insight_thresholds,
      updated_by = v_actor_id,
      updated_at = timezone('utc', now())
  where setting_key = 'insight_thresholds';

  insert into public.app_settings (setting_key, value_json, updated_by)
  values ('critical_non_zero_fields', v_critical, v_actor_id)
  on conflict (setting_key) do nothing;

  update public.app_settings
  set value_json = v_critical,
      updated_by = v_actor_id,
      updated_at = timezone('utc', now())
  where setting_key = 'critical_non_zero_fields';
end;
$$;

revoke all on function public.update_app_settings(boolean, text, text, integer, integer, integer, jsonb) from public;
grant execute on function public.update_app_settings(boolean, text, text, integer, integer, integer, jsonb) to authenticated;
