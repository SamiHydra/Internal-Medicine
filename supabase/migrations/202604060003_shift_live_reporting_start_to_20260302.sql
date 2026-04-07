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
