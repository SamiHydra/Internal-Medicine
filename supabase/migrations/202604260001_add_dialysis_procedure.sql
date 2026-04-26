insert into public.report_templates (
  slug,
  family,
  name,
  description,
  active_days,
  metadata
)
values (
  'dialysis_weekly',
  'procedure',
  'Dialysis',
  'Weekly haemodialysis throughput reporting.',
  array['monday','tuesday','wednesday','thursday','friday','saturday','sunday'],
  jsonb_build_object('ui_family', 'procedure')
)
on conflict (slug) do update
set family = excluded.family,
    name = excluded.name,
    description = excluded.description,
    active_days = excluded.active_days,
    metadata = excluded.metadata,
    updated_at = timezone('utc', now());

insert into public.departments (
  slug,
  family,
  template_id,
  name,
  description,
  accent_color,
  bed_count,
  active
)
select
  'dialysis_unit',
  'procedure'::public.report_family,
  template.id,
  'Dialysis',
  'Dialysis procedure service report.',
  '#0f766e',
  null,
  true
from public.report_templates template
where template.slug = 'dialysis_weekly'
on conflict (slug) do update
set family = excluded.family,
    template_id = excluded.template_id,
    name = excluded.name,
    description = excluded.description,
    accent_color = excluded.accent_color,
    bed_count = excluded.bed_count,
    active = true,
    updated_at = timezone('utc', now());

insert into public.report_field_definitions (
  template_id,
  section_key,
  field_key,
  label,
  field_kind,
  aggregate_type,
  display_order
)
select
  template.id,
  seed.section_key,
  seed.field_key,
  seed.label,
  seed.field_kind::public.field_kind,
  seed.aggregate_type::public.field_aggregate,
  seed.display_order
from (
  values
    ('throughput','dialysis_acute','Total Number of Patients Who have Haemodialysis for Acute Renal Failure','integer','sum',10),
    ('throughput','dialysis_chronic','Total Number of Patients Who have Haemodialysis for Chronic Renal Failure','integer','sum',20),
    ('staffing','reporting_staff','Name of Reporting Nurse or Nurse-in-Charge (NI)','text','latest',30)
) as seed(section_key, field_key, label, field_kind, aggregate_type, display_order)
join public.report_templates template on template.slug = 'dialysis_weekly'
on conflict (template_id, field_key) do update
set section_key = excluded.section_key,
    label = excluded.label,
    field_kind = excluded.field_kind,
    aggregate_type = excluded.aggregate_type,
    display_order = excluded.display_order,
    updated_at = timezone('utc', now());
