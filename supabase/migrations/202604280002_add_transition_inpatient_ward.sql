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
  'transition_inpatient',
  'inpatient'::public.report_family,
  template.id,
  'Transition',
  'Inpatient transition service reporting.',
  '#0e7490',
  null,
  true
from public.report_templates template
where template.slug = 'inpatient_weekly'
on conflict (slug) do update
set family = excluded.family,
    template_id = excluded.template_id,
    name = excluded.name,
    description = excluded.description,
    accent_color = excluded.accent_color,
    bed_count = excluded.bed_count,
    active = true,
    updated_at = timezone('utc', now());
