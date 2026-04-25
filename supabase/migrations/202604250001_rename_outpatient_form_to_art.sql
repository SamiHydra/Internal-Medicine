update public.report_templates
set name = 'ART',
    description = 'Weekly outpatient ART clinic activity and access reporting.',
    updated_at = timezone('utc', now())
where slug = 'outpatient_weekly';

update public.departments
set name = 'ART',
    description = 'Outpatient ART clinic reporting.',
    updated_at = timezone('utc', now())
where slug = 'outpatient_main';
