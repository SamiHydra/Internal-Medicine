<?php

namespace Database\Seeders;

use App\Models\ReportTemplate;
use Illuminate\Database\Seeder;

class ReportTemplateSeeder extends Seeder
{
    public function run(): void
    {
        $weekdaysAll = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        $weekdaysClinic = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

        $templates = [
            [
                'slug' => 'inpatient_weekly',
                'family' => 'inpatient',
                'name' => 'Inpatient Weekly Report',
                'description' => 'Shared weekly operational template for inpatient wards.',
                'active_days' => $weekdaysAll,
                'metadata' => [
                    'ui_family' => 'inpatient',
                    'supports_metrics' => ['bor_percent', 'btr', 'alos'],
                ],
            ],
            [
                'slug' => 'outpatient_weekly',
                'family' => 'outpatient',
                'name' => 'ART',
                'description' => 'Weekly outpatient ART clinic activity and access reporting.',
                'active_days' => $weekdaysClinic,
                'metadata' => ['ui_family' => 'outpatient'],
            ],
            [
                'slug' => 'eeg_weekly',
                'family' => 'procedure',
                'name' => 'EEG',
                'description' => 'Weekly operational reporting for electroencephalography services.',
                'active_days' => $weekdaysClinic,
                'metadata' => ['ui_family' => 'procedure'],
            ],
            [
                'slug' => 'echocardiography_weekly',
                'family' => 'procedure',
                'name' => 'Echocardiography Lab',
                'description' => 'Weekly diagnostic throughput and turnaround reporting for echo services.',
                'active_days' => $weekdaysClinic,
                'metadata' => ['ui_family' => 'procedure'],
            ],
            [
                'slug' => 'endoscopy_weekly',
                'family' => 'procedure',
                'name' => 'Endoscopy Lab',
                'description' => 'Weekly reporting for endoscopy throughput and procedure mix.',
                'active_days' => $weekdaysClinic,
                'metadata' => ['ui_family' => 'procedure'],
            ],
            [
                'slug' => 'hematology_procedures_weekly',
                'family' => 'procedure',
                'name' => 'Hematology Procedures',
                'description' => 'Weekly procedure volume and waiting time reporting for hematology services.',
                'active_days' => $weekdaysClinic,
                'metadata' => ['ui_family' => 'procedure'],
            ],
            [
                'slug' => 'bronchoscopy_weekly',
                'family' => 'procedure',
                'name' => 'Bronchoscopy Lab',
                'description' => 'Weekly bronchoscopy volume and waiting time reporting.',
                'active_days' => $weekdaysClinic,
                'metadata' => ['ui_family' => 'procedure'],
            ],
            [
                'slug' => 'renal_procedures_weekly',
                'family' => 'procedure',
                'name' => 'Renal Procedures',
                'description' => 'Weekly renal diagnostic and intervention throughput reporting.',
                'active_days' => $weekdaysAll,
                'metadata' => ['ui_family' => 'procedure'],
            ],
            [
                'slug' => 'dialysis_weekly',
                'family' => 'procedure',
                'name' => 'Dialysis',
                'description' => 'Weekly haemodialysis throughput reporting.',
                'active_days' => $weekdaysAll,
                'metadata' => ['ui_family' => 'procedure'],
            ],
        ];

        foreach ($templates as $template) {
            ReportTemplate::query()->updateOrCreate(
                ['slug' => $template['slug']],
                $template,
            );
        }
    }
}
