update public.report_field_definitions definition
set label = 'Number of New Patients That Are on Urinary Catheter',
    updated_at = timezone('utc', now())
from public.report_templates template
where definition.template_id = template.id
  and template.slug = 'inpatient_weekly'
  and definition.field_key = 'urinary_catheter';
