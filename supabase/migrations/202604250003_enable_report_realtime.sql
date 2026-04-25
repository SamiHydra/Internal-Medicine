do $$
begin
  begin
    alter publication supabase_realtime add table public.reports;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;

  begin
    alter publication supabase_realtime add table public.report_field_values;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;

  begin
    alter publication supabase_realtime add table public.calculated_metrics;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;
end
$$;
