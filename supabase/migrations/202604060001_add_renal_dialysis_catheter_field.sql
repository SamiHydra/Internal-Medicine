update public.report_templates
set active_days = array['monday','tuesday','wednesday','thursday','friday','saturday','sunday'],
    updated_at = timezone('utc', now())
where slug = 'renal_procedures_weekly';

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
    ('throughput','elective_renal_biopsy','Total Number of Patients Who have Elective Renal Biopsy','integer','sum',10),
    ('throughput','central_venous_catheter_insertion','Total Number of patients with Central Venous Catheter insertion','integer','sum',20),
    ('turnaround','elective_renal_biopsy_wait','Average Waiting Time for Elective Renal Biopsy','decimal','average',30),
    ('throughput','hd_acute','Total Number of Patients Who have Haemodialysis for Acute Renal Failure','integer','sum',40),
    ('throughput','hd_chronic','Total Number of Patients Who have Haemodialysis for Chronic Renal Failure','integer','sum',50),
    ('staffing','reporting_staff','Name of Reporting Nurse or Nurse-in-Charge (NI)','text','latest',60)
) as seed(section_key, field_key, label, field_kind, aggregate_type, display_order)
join public.report_templates template on template.slug = 'renal_procedures_weekly'
on conflict (template_id, field_key) do update
set section_key = excluded.section_key,
    label = excluded.label,
    field_kind = excluded.field_kind,
    aggregate_type = excluded.aggregate_type,
    display_order = excluded.display_order,
    updated_at = timezone('utc', now());
