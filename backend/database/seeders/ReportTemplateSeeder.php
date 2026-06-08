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
                    'validation_rules' => [
                        [
                            'key' => 'hai_components_lte_total',
                            'type' => 'sum_lte',
                            'severity' => 'error',
                            'left' => ['hai_clabsi', 'hai_cauti', 'hai_pneumonia', 'hai_vap', 'hai_cdi'],
                            'right' => ['total_hai'],
                            'message' => 'HAI subtype counts cannot exceed total HAI.',
                        ],
                        [
                            'key' => 'new_pressure_ulcer_lte_total',
                            'type' => 'sum_lte',
                            'severity' => 'error',
                            'left' => ['new_pressure_ulcer'],
                            'right' => ['total_pressure_ulcer'],
                            'message' => 'New pressure ulcers cannot exceed total pressure ulcers.',
                        ],
                        // Deaths vs admissions is a soft sanity check, not a hard
                        // invariant: "total admitted" is a daily census (summed)
                        // while flows accumulate over the week, so this warns
                        // rather than blocks.
                        [
                            'key' => 'deaths_lte_patients',
                            'type' => 'sum_lte',
                            'severity' => 'warning',
                            'left' => ['new_deaths'],
                            'right' => ['total_admitted_patients'],
                            'message' => 'Deaths exceed the total admitted patients this week — please double-check.',
                        ],
                        [
                            'key' => 'discharges_lte_patients',
                            'type' => 'sum_lte',
                            'severity' => 'warning',
                            'left' => ['discharged_home', 'discharged_ama'],
                            'right' => ['total_admitted_patients'],
                            'message' => 'Discharges exceed the total number of admitted patients — please double-check.',
                        ],
                        [
                            'key' => 'hai_lte_patients',
                            'type' => 'sum_lte',
                            'severity' => 'warning',
                            'left' => ['total_hai'],
                            'right' => ['total_admitted_patients'],
                            'message' => 'Patients with hospital-acquired infections exceed total admitted patients — please double-check.',
                        ],
                    ],
                ],
            ],
            [
                'slug' => 'outpatient_weekly',
                'family' => 'outpatient',
                'name' => 'ART',
                'description' => 'Weekly outpatient ART clinic activity and access reporting.',
                'active_days' => $weekdaysClinic,
                'metadata' => [
                    'ui_family' => 'outpatient',
                    'validation_rules' => [
                        [
                            'key' => 'new_followup_lte_seen',
                            'type' => 'sum_lte',
                            'severity' => 'error',
                            'left' => ['new_patients_seen', 'follow_up_patients'],
                            'right' => ['total_patients_seen'],
                            'message' => 'New and follow-up patients cannot exceed total patients seen.',
                        ],
                        [
                            'key' => 'not_seen_lte_total',
                            'type' => 'sum_lte',
                            'severity' => 'warning',
                            'left' => ['not_seen_same_day'],
                            'right' => ['total_patients_seen'],
                            'message' => 'Patients not seen same day exceed total patients seen — please double-check.',
                        ],
                    ],
                ],
            ],
            [
                'slug' => 'eeg_weekly',
                'family' => 'procedure',
                'name' => 'EEG',
                'description' => 'Weekly operational reporting for electroencephalography services.',
                'active_days' => $weekdaysClinic,
                'metadata' => [
                    'ui_family' => 'procedure',
                    'validation_rules' => [
                        [
                            'key' => 'eeg_reports_lte_done',
                            'type' => 'sum_lte',
                            'severity' => 'error',
                            'left' => ['eeg_report_received'],
                            'right' => ['eeg_done'],
                            'message' => 'EEG reports received cannot exceed EEGs done.',
                        ],
                    ],
                ],
            ],
            [
                'slug' => 'echocardiography_weekly',
                'family' => 'procedure',
                'name' => 'Echocardiography Lab',
                'description' => 'Weekly diagnostic throughput and turnaround reporting for echo services.',
                'active_days' => $weekdaysClinic,
                'metadata' => [
                    'ui_family' => 'procedure',
                    'validation_rules' => [
                        [
                            'key' => 'echo_reports_lte_done',
                            'type' => 'sum_lte',
                            'severity' => 'error',
                            'left' => ['echo_report_received'],
                            'right' => ['echo_done'],
                            'message' => 'Echo reports received cannot exceed echocardiograms done.',
                        ],
                    ],
                ],
            ],
            [
                'slug' => 'endoscopy_weekly',
                'family' => 'procedure',
                'name' => 'Endoscopy Lab',
                'description' => 'Weekly reporting for endoscopy throughput and procedure mix.',
                'active_days' => $weekdaysClinic,
                'metadata' => [
                    'ui_family' => 'procedure',
                    'validation_rules' => [
                        [
                            'key' => 'upper_gi_reports_lte_done',
                            'type' => 'sum_lte',
                            'severity' => 'error',
                            'left' => ['upper_gi_report_received'],
                            'right' => ['upper_gi_elective'],
                            'message' => 'Elective upper GI reports received cannot exceed elective upper GI endoscopies done.',
                        ],
                    ],
                ],
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
