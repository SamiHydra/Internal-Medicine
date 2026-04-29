insert into public.roles (role_key, label, description)
values
  ('superadmin', 'Superadmin', 'Single protected administrator who can provision and manage admin accounts'),
  ('admin', 'Admin 1', 'Full platform administration permissions'),
  ('doctor_admin', 'Dr. Mesay', 'Clinical director with full platform permissions'),
  ('nurse', 'Nurse', 'Weekly reporting and approved assignment access')
on conflict (role_key) do update
set label = excluded.label,
    description = excluded.description;

insert into public.report_templates (slug, family, name, description, active_days, metadata)
values
  (
    'inpatient_weekly',
    'inpatient',
    'Inpatient Weekly Report',
    'Shared weekly operational template for inpatient wards.',
    array['monday','tuesday','wednesday','thursday','friday','saturday','sunday'],
    jsonb_build_object('ui_family', 'inpatient', 'supports_metrics', array['bor_percent','btr','alos'])
  ),
  (
    'outpatient_weekly',
    'outpatient',
    'ART',
    'Weekly outpatient ART clinic activity and access reporting.',
    array['monday','tuesday','wednesday','thursday','friday'],
    jsonb_build_object('ui_family', 'outpatient')
  ),
  (
    'eeg_weekly',
    'procedure',
    'EEG',
    'Weekly operational reporting for electroencephalography services.',
    array['monday','tuesday','wednesday','thursday','friday'],
    jsonb_build_object('ui_family', 'procedure')
  ),
  (
    'echocardiography_weekly',
    'procedure',
    'Echocardiography Lab',
    'Weekly diagnostic throughput and turnaround reporting for echo services.',
    array['monday','tuesday','wednesday','thursday','friday'],
    jsonb_build_object('ui_family', 'procedure')
  ),
  (
    'endoscopy_weekly',
    'procedure',
    'Endoscopy Lab',
    'Weekly reporting for endoscopy throughput and procedure mix.',
    array['monday','tuesday','wednesday','thursday','friday'],
    jsonb_build_object('ui_family', 'procedure')
  ),
  (
    'hematology_procedures_weekly',
    'procedure',
    'Hematology Procedures',
    'Weekly procedure volume and waiting time reporting for hematology services.',
    array['monday','tuesday','wednesday','thursday','friday'],
    jsonb_build_object('ui_family', 'procedure')
  ),
  (
    'bronchoscopy_weekly',
    'procedure',
    'Bronchoscopy Lab',
    'Weekly bronchoscopy volume and waiting time reporting.',
    array['monday','tuesday','wednesday','thursday','friday'],
    jsonb_build_object('ui_family', 'procedure')
  ),
  (
    'renal_procedures_weekly',
    'procedure',
    'Renal Procedures',
    'Weekly renal diagnostic and intervention throughput reporting.',
    array['monday','tuesday','wednesday','thursday','friday','saturday','sunday'],
    jsonb_build_object('ui_family', 'procedure')
  ),
  (
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

insert into public.departments (slug, family, template_id, name, description, accent_color, bed_count)
select
  seed.slug,
  seed.family::public.report_family,
  template.id,
  seed.name,
  seed.description,
  seed.accent_color,
  seed.bed_count
from (
  values
    ('gi_neuro_inpatient', 'inpatient', 'inpatient_weekly', 'GI/Neurology', 'Inpatient GI and neurology ward reporting.', '#1b7f8f', 26),
    ('cardiac_inpatient', 'inpatient', 'inpatient_weekly', 'Cardiac', 'Cardiac inpatient ward.', '#155e75', 22),
    ('nephrology_inpatient', 'inpatient', 'inpatient_weekly', 'Nephrology', 'Nephrology inpatient ward.', '#0f766e', 20),
    ('chest_inpatient', 'inpatient', 'inpatient_weekly', 'Chest', 'Chest inpatient ward.', '#0284c7', 18),
    ('hematology_inpatient', 'inpatient', 'inpatient_weekly', 'Hematology', 'Hematology inpatient ward.', '#0f5f74', 16),
    ('oncology_inpatient', 'inpatient', 'inpatient_weekly', 'Oncology', 'Oncology inpatient ward.', '#0f4c81', 24),
    ('hdu_inpatient', 'inpatient', 'inpatient_weekly', 'HDU', 'High dependency unit reporting.', '#164e63', 12),
    ('transition_inpatient', 'inpatient', 'inpatient_weekly', 'Transition', 'Inpatient transition service reporting.', '#0e7490', null),
    ('outpatient_main', 'outpatient', 'outpatient_weekly', 'ART', 'Outpatient ART clinic reporting.', '#0f8ea8', null),
    ('gi_outpatient', 'outpatient', 'outpatient_weekly', 'GI', 'GI outpatient clinic.', '#0d9488', null),
    ('neuro_outpatient', 'outpatient', 'outpatient_weekly', 'Neuro', 'Neurology outpatient clinic.', '#2563eb', null),
    ('cardiac_outpatient', 'outpatient', 'outpatient_weekly', 'Cardiac', 'Cardiac outpatient clinic.', '#0f766e', null),
    ('nephrology_outpatient', 'outpatient', 'outpatient_weekly', 'Nephrology', 'Nephrology outpatient clinic.', '#0f8ea8', null),
    ('chest_outpatient', 'outpatient', 'outpatient_weekly', 'Chest', 'Chest outpatient clinic.', '#1d4ed8', null),
    ('hematology_outpatient', 'outpatient', 'outpatient_weekly', 'Hematology', 'Hematology outpatient clinic.', '#075985', null),
    ('oncology_outpatient', 'outpatient', 'outpatient_weekly', 'Oncology', 'Oncology outpatient clinic.', '#155e75', null),
    ('endocrine_outpatient', 'outpatient', 'outpatient_weekly', 'Endocrine', 'Endocrine outpatient clinic.', '#0f766e', null),
    ('opd_28', 'outpatient', 'outpatient_weekly', 'OPD 28', 'OPD 28 clinic reporting.', '#0e7490', null),
    ('rheumatology_outpatient', 'outpatient', 'outpatient_weekly', 'Rheumatology', 'Rheumatology clinic reporting.', '#0284c7', null),
    ('id_outpatient', 'outpatient', 'outpatient_weekly', 'ID', 'Infectious disease clinic.', '#1d4ed8', null),
    ('eeg_lab', 'procedure', 'eeg_weekly', 'Electroencephalography (EEG)', 'EEG weekly operational report.', '#0f8ea8', null),
    ('echocardiography_lab', 'procedure', 'echocardiography_weekly', 'Echocardiography Lab', 'Echocardiography service report.', '#0f766e', null),
    ('endoscopy_lab', 'procedure', 'endoscopy_weekly', 'Endoscopy Lab', 'Endoscopy service report.', '#155e75', null),
    ('hematology_procedures', 'procedure', 'hematology_procedures_weekly', 'Hematology Procedures', 'Hematology procedure service report.', '#1d4ed8', null),
    ('bronchoscopy_lab', 'procedure', 'bronchoscopy_weekly', 'Bronchoscopy Lab', 'Bronchoscopy service report.', '#0284c7', null),
    ('renal_procedures', 'procedure', 'renal_procedures_weekly', 'Renal Procedures', 'Renal procedure service report.', '#0f766e', null),
    ('dialysis_unit', 'procedure', 'dialysis_weekly', 'Dialysis', 'Dialysis procedure service report.', '#0f766e', null)
) as seed(slug, family, template_slug, name, description, accent_color, bed_count)
join public.report_templates template on template.slug = seed.template_slug
on conflict (slug) do update
set family = excluded.family,
    template_id = excluded.template_id,
    name = excluded.name,
    description = excluded.description,
    accent_color = excluded.accent_color,
    bed_count = excluded.bed_count,
    updated_at = timezone('utc', now());

insert into public.app_settings (setting_key, value_json)
values
  ('workflow_controls', '{"deadline_enforced":true}'::jsonb),
  ('weekly_deadline', '{"day":"monday","time":"10:00"}'::jsonb),
  ('locking_rules', '{"auto_lock_hours_after_deadline":36}'::jsonb),
  ('insight_thresholds', '{"rise_percent":10,"drop_percent":10}'::jsonb),
  ('critical_non_zero_fields', '["new_deaths","new_pressure_ulcer","total_hai","hai_clabsi","hai_cauti","hai_vap"]'::jsonb)
on conflict (setting_key) do nothing;

update public.app_settings
set value_json = '{"deadline_enforced":true}'::jsonb,
    updated_at = timezone('utc', now())
where setting_key = 'workflow_controls';

update public.app_settings
set value_json = '{"day":"monday","time":"10:00"}'::jsonb,
    updated_at = timezone('utc', now())
where setting_key = 'weekly_deadline';

update public.app_settings
set value_json = '{"auto_lock_hours_after_deadline":36}'::jsonb,
    updated_at = timezone('utc', now())
where setting_key = 'locking_rules';

update public.app_settings
set value_json = '{"rise_percent":10,"drop_percent":10}'::jsonb,
    updated_at = timezone('utc', now())
where setting_key = 'insight_thresholds';

update public.app_settings
set value_json = '["new_deaths","new_pressure_ulcer","total_hai","hai_clabsi","hai_cauti","hai_vap"]'::jsonb,
    updated_at = timezone('utc', now())
where setting_key = 'critical_non_zero_fields';

insert into public.reporting_periods (week_start, week_end, deadline_at, month_label, quarter_label, year_num)
select
  week_start::date,
  (week_start::date + 6),
  ((week_start::date + 7)::timestamp + time '10:00') at time zone 'UTC',
  to_char(week_start::date, 'Mon YYYY'),
  format('Q%s %s', extract(quarter from week_start::date), extract(year from week_start::date)),
  extract(year from week_start::date)::integer
from generate_series(
  date_trunc('week', current_date)::date - interval '26 weeks',
  date_trunc('week', current_date)::date + interval '26 weeks',
  interval '1 week'
) as week_start
on conflict (week_start) do update
set week_end = excluded.week_end,
    deadline_at = excluded.deadline_at,
    month_label = excluded.month_label,
    quarter_label = excluded.quarter_label,
    year_num = excluded.year_num;

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
    ('inpatient_weekly','patient_flow','total_admitted_patients','Total Number of Admitted Patients','integer','sum',10),
    ('inpatient_weekly','patient_flow','new_admitted_patients','Number of Newly Admitted Patients','integer','sum',20),
    ('inpatient_weekly','patient_flow','readmitted_30d','Number of Newly Readmitted Patients within 30 days of discharge','integer','sum',30),
    ('inpatient_weekly','quality_safety','new_deaths','Number of New Deaths','integer','sum',40),
    ('inpatient_weekly','quality_safety','new_pressure_ulcer','Number of Patients Who Developed New Pressure Ulcer','integer','sum',50),
    ('inpatient_weekly','quality_safety','total_pressure_ulcer','Total Number of Patients With Pressure Ulcer','integer','sum',60),
    ('inpatient_weekly','quality_safety','total_hai','Total Number of Patients With Hospital-acquired infections (AIs)','integer','sum',70),
    ('inpatient_weekly','quality_safety','hai_clabsi','Central line-associated bloodstream Infection','integer','sum',80),
    ('inpatient_weekly','quality_safety','hai_cauti','Catheter-Associated Urinary tract infection','integer','sum',90),
    ('inpatient_weekly','quality_safety','hai_pneumonia','Pneumonia','integer','sum',100),
    ('inpatient_weekly','quality_safety','hai_vap','Ventilator-associated pneumonia (VAP)','integer','sum',110),
    ('inpatient_weekly','quality_safety','hai_cdi','Clostridium difficile infections (CDI)','integer','sum',120),
    ('inpatient_weekly','quality_safety','urinary_catheter','Number of New Patients That Are on Urinary Catheter','integer','sum',130),
    ('inpatient_weekly','patient_flow','transferred_icu','Number of Patients Transferred to ICU','integer','sum',140),
    ('inpatient_weekly','patient_flow','transferred_hdu','Number of Patients Transferred to HDU','integer','sum',150),
    ('inpatient_weekly','patient_flow','transferred_ward','Number of Patients Transferred to Ward','integer','sum',160),
    ('inpatient_weekly','patient_flow','discharged_home','Number of Patients Discharged Home (Rx Completed)','integer','sum',170),
    ('inpatient_weekly','patient_flow','discharged_ama','Number of Patients Discharged Against Medical Advice','integer','sum',180),
    ('inpatient_weekly','capacity','free_beds','Number of Free Beds','integer','sum',190),
    ('inpatient_weekly','capacity','median_los_days','Median Length of Stay (LOS) in Days','decimal','average',200),
    ('inpatient_weekly','capacity','total_patient_days','Total Patient Days','integer','sum',210),
    ('inpatient_weekly','staffing','mdt_round_start_day','MDT Round Start Time (Day-working hours)','time','latest',220),
    ('inpatient_weekly','staffing','mdt_round_start_duty','MDT Round Start Time (Duty hours)','time','latest',230),
    ('inpatient_weekly','staffing','duty_resident','Duty resident','text','latest',240),
    ('inpatient_weekly','staffing','duty_senior_physician','Duty senior physician','text','latest',250),
    ('inpatient_weekly','staffing','nurse_in_charge','Nurse In Charge (NI) Name','text','latest',260),
    ('outpatient_weekly','activity','total_patients_seen','Total Number of Patients Seen','integer','sum',10),
    ('outpatient_weekly','activity','follow_up_patients','Number of Follow-up Patients','integer','sum',20),
    ('outpatient_weekly','activity','new_patients_seen','Number of New Patients Seen','integer','sum',30),
    ('outpatient_weekly','activity','not_seen_same_day','Number of Patients Not Seen on Same Day','integer','sum',40),
    ('outpatient_weekly','access','wait_time_new_days','Average Appointment Wait Time For New Patients','decimal','average',50),
    ('outpatient_weekly','access','wait_time_followup_months','Average Appointment Wait Time For Follow-up Patients','decimal','average',60),
    ('outpatient_weekly','access','failed_to_come','Number of Patients Who Failed to Come For Their Appointment','integer','sum',70),
    ('outpatient_weekly','access','not_seen_appointment','Number of Patients Who Are Not Seen During Their Appointment','integer','sum',80),
    ('outpatient_weekly','staffing','clinic_start_time','Clinic Start Time','time','latest',90),
    ('outpatient_weekly','staffing','senior_physician_availability','Senior physician availability','choice','latest',100),
    ('outpatient_weekly','staffing','nurse_in_charge','Nurse In Charge (NI) Name','text','latest',110),
    ('eeg_weekly','throughput','eeg_done','Total Number of Patients Who have EEG done','integer','sum',10),
    ('eeg_weekly','turnaround','eeg_wait_tests','Average Waiting Time for EEG tests','decimal','average',20),
    ('eeg_weekly','throughput','eeg_report_received','Total Number of Patients Who Received EEG Report','integer','sum',30),
    ('eeg_weekly','turnaround','eeg_wait_reports','Average Waiting Time for EEG Reports','decimal','average',40),
    ('eeg_weekly','throughput','ncs_done','Total Number of Patients Who have Nerve Conduction Study (NCS)','integer','sum',50),
    ('eeg_weekly','throughput','emg_done','Total Number of Patients Who have Electromyography (EMG) testing','integer','sum',60),
    ('eeg_weekly','throughput','ep_done','Total Number of Patients Who have Evoked Potential (EP) testing','integer','sum',70),
    ('eeg_weekly','staffing','reporting_staff','Name of Reporting Nurse or EEG Technician','text','latest',80),
    ('echocardiography_weekly','throughput','echo_done','Total Number of Patients Who have Echocardiography done','integer','sum',10),
    ('echocardiography_weekly','turnaround','echo_wait_tests','Average Waiting Time for Echocardiography tests','decimal','average',20),
    ('echocardiography_weekly','throughput','echo_report_received','Total Number of Patients Who Received Echocardiography Report','integer','sum',30),
    ('echocardiography_weekly','turnaround','echo_wait_reports','Average Waiting Time for Echocardiography Reports','decimal','average',40),
    ('echocardiography_weekly','throughput','stress_echo','Total Number of Patients Who have Stress Echocardiography','integer','sum',50),
    ('echocardiography_weekly','throughput','tee','Total Number of Patients Who have TEE','integer','sum',60),
    ('echocardiography_weekly','throughput','ecg_done','Total Number of Patients Who have ECG done','integer','sum',70),
    ('echocardiography_weekly','throughput','stress_ecg','Total Number of Patients Who have Stress ECG','integer','sum',80),
    ('echocardiography_weekly','throughput','ambulatory_ecg','Total Number of Patients Who have Ambulatory ECG','integer','sum',90),
    ('echocardiography_weekly','throughput','angiography_screening','Total Number of Patients Who have Angiography Screening','integer','sum',100),
    ('echocardiography_weekly','throughput','valvotomy_screening','Total Number of Patients Who have Valvotomy Screening','integer','sum',110),
    ('echocardiography_weekly','staffing','reporting_staff','Name of Reporting Nurse or Nurse-in-Charge (NI)','text','latest',120),
    ('endoscopy_weekly','throughput','upper_gi_elective','Total Number of Patients Who have Elective Upper GI Endoscopy','integer','sum',10),
    ('endoscopy_weekly','turnaround','upper_gi_wait','Average Waiting Time for Elective Upper GI Endoscopy','decimal','average',20),
    ('endoscopy_weekly','throughput','upper_gi_report_received','Total Number of Patients Who Received Upper GI Endoscopy Report (Elective Only)','integer','sum',30),
    ('endoscopy_weekly','turnaround','upper_gi_report_wait','Average Waiting Time for Upper GI Endoscopy Reports (Elective Only)','decimal','average',40),
    ('endoscopy_weekly','throughput','upper_gi_emergency','Total Number of Patients Who have Emergency Upper GI Endoscopy','integer','sum',50),
    ('endoscopy_weekly','throughput','ercp','Total Number of Patients Who have ERCP','integer','sum',60),
    ('endoscopy_weekly','throughput','colonoscopy','Total Number of Patients Who have Colonoscopy','integer','sum',70),
    ('endoscopy_weekly','throughput','proctoscopy','Total Number of Patients Who have Proctoscopy','integer','sum',80),
    ('endoscopy_weekly','throughput','bronchoscopy','Total Number of Patients Who have Bronchoscopy','integer','sum',90),
    ('endoscopy_weekly','throughput','therapeutic_upper_gi','Total Number of Patients Who have Upper GI Endoscopic Therapeutic Procedures','integer','sum',100),
    ('endoscopy_weekly','throughput','esophageal_dilation','Esophageal Dilation','integer','sum',110),
    ('endoscopy_weekly','throughput','variceal_ligation','Variceal Ligation','integer','sum',120),
    ('endoscopy_weekly','throughput','stenting','Stenting','integer','sum',130),
    ('endoscopy_weekly','throughput','liver_biopsy','Total Number of Patients Who have Liver Biopsy','integer','sum',140),
    ('endoscopy_weekly','staffing','reporting_staff','Name of Reporting Nurse or Nurse-in-Charge (NI)','text','latest',150),
    ('hematology_procedures_weekly','throughput','bone_marrow_biopsy','Total Number of Patients Who have Bone Marrow biopsy','integer','sum',10),
    ('hematology_procedures_weekly','turnaround','bone_marrow_wait','Average Waiting Time for Elective Bone Marrow Biopsy','decimal','average',20),
    ('hematology_procedures_weekly','staffing','reporting_staff','Name of Reporting Nurse or Nurse-in-Charge (NI)','text','latest',30),
    ('bronchoscopy_weekly','throughput','bronchoscopy_done','Total Number of Patients Who have Bronchoscopy','integer','sum',10),
    ('bronchoscopy_weekly','turnaround','bronchoscopy_wait','Average Waiting Time for Bronchoscopy','decimal','average',20),
    ('bronchoscopy_weekly','staffing','reporting_staff','Name of Reporting Nurse or Nurse-in-Charge (NI)','text','latest',30),
    ('renal_procedures_weekly','throughput','elective_renal_biopsy','Total Number of Patients Who have Elective Renal Biopsy','integer','sum',10),
    ('renal_procedures_weekly','throughput','central_venous_catheter_insertion','Total Number of patients with Central Venous Catheter insertion','integer','sum',20),
    ('renal_procedures_weekly','turnaround','elective_renal_biopsy_wait','Average Waiting Time for Elective Renal Biopsy','decimal','average',30),
    ('renal_procedures_weekly','staffing','reporting_staff','Name of Reporting Nurse or Nurse-in-Charge (NI)','text','latest',40),
    ('dialysis_weekly','throughput','dialysis_acute','Total Number of Patients Who have Haemodialysis for Acute Renal Failure','integer','sum',10),
    ('dialysis_weekly','throughput','dialysis_chronic','Total Number of Patients Who have Haemodialysis for Chronic Renal Failure','integer','sum',20),
    ('dialysis_weekly','staffing','reporting_staff','Name of Reporting Nurse or Nurse-in-Charge (NI)','text','latest',30)
) as seed(template_slug, section_key, field_key, label, field_kind, aggregate_type, display_order)
join public.report_templates template on template.slug = seed.template_slug
on conflict (template_id, field_key) do update
set section_key = excluded.section_key,
    label = excluded.label,
    field_kind = excluded.field_kind,
    aggregate_type = excluded.aggregate_type,
    display_order = excluded.display_order,
    updated_at = timezone('utc', now());

update public.report_field_definitions definition
set metadata = jsonb_build_object(
  'options',
  jsonb_build_array('Full day', 'Partial day', 'Unavailable')
)
from public.report_templates template
where definition.template_id = template.id
  and template.slug = 'outpatient_weekly'
  and definition.field_key = 'senior_physician_availability';
