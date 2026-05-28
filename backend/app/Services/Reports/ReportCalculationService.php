<?php

namespace App\Services\Reports;

use App\Models\CalculatedMetric;
use App\Models\Report;

class ReportCalculationService
{
    public function upsertForReport(Report $report): CalculatedMetric
    {
        $report->loadMissing(['department', 'template']);

        if ($report->template->family !== 'inpatient') {
            return CalculatedMetric::query()->updateOrCreate(
                ['report_id' => $report->id],
                [
                    'bor_percent' => null,
                    'btr' => null,
                    'alos' => null,
                    'metric_payload' => [],
                ],
            );
        }

        $totals = $report->fieldValues()
            ->join('report_field_definitions', 'report_field_definitions.id', '=', 'report_field_values.field_definition_id')
            ->whereIn('report_field_definitions.field_key', [
                'total_patient_days',
                'discharged_home',
                'discharged_ama',
            ])
            ->selectRaw('report_field_definitions.field_key, sum(report_field_values.value_number) as total')
            ->groupBy('report_field_definitions.field_key')
            ->pluck('total', 'field_key');

        $totalPatientDays = (float) ($totals['total_patient_days'] ?? 0);
        $totalDischarge = (float) ($totals['discharged_home'] ?? 0) + (float) ($totals['discharged_ama'] ?? 0);
        $bedCount = $report->department->bed_count;

        return CalculatedMetric::query()->updateOrCreate(
            ['report_id' => $report->id],
            [
                'bor_percent' => $bedCount ? ($totalPatientDays / ($bedCount * 30.0)) * 100 : null,
                'btr' => $bedCount ? $totalDischarge / $bedCount : null,
                'alos' => $totalDischarge ? $totalPatientDays / $totalDischarge : null,
                'metric_payload' => [
                    'total_patient_days' => $totalPatientDays,
                    'total_discharge' => $totalDischarge,
                ],
            ],
        );
    }
}
