<?php

namespace Database\Seeders;

use App\Models\Department;
use App\Models\ReportTemplate;
use App\Models\Ward;
use Illuminate\Database\Seeder;

class DepartmentSeeder extends Seeder
{
    /**
     * Inpatient reporting unit -> teaching ward (academic pillar). Mirrors the
     * map in the seed_academic_structure migration, which only applies to
     * databases that already hold departments; fresh installs seed departments
     * after migrating, so the mapping is applied here too. HDU is deliberately
     * unmapped: it is not one of the six teaching wards.
     */
    private const WARD_SLUG_BY_DEPARTMENT = [
        'gi_neuro_inpatient' => 'gastro_neurology_ward',
        'cardiac_inpatient' => 'cardio_endocrine_ward',
        'nephrology_inpatient' => 'nephrology_ward',
        'chest_inpatient' => 'pulmonology_ward',
        'hematology_inpatient' => 'hematology_oncology_ward',
        'oncology_inpatient' => 'hematology_oncology_ward',
        'transition_inpatient' => 'transition_ward',
    ];

    public function run(): void
    {
        $templateIds = ReportTemplate::query()->pluck('id', 'slug');
        $wardIds = Ward::query()->pluck('id', 'slug');

        $departments = [
            ['gi_neuro_inpatient', 'inpatient', 'inpatient_weekly', 'GI/Neurology', 'Inpatient GI and neurology ward reporting.', '#1b7f8f', 26],
            ['cardiac_inpatient', 'inpatient', 'inpatient_weekly', 'Cardiac', 'Cardiac inpatient ward.', '#155e75', 22],
            ['nephrology_inpatient', 'inpatient', 'inpatient_weekly', 'Nephrology', 'Nephrology inpatient ward.', '#0f766e', 20],
            ['chest_inpatient', 'inpatient', 'inpatient_weekly', 'Chest', 'Chest inpatient ward.', '#0284c7', 18],
            ['hematology_inpatient', 'inpatient', 'inpatient_weekly', 'Hematology', 'Hematology inpatient ward.', '#0f5f74', 16],
            ['oncology_inpatient', 'inpatient', 'inpatient_weekly', 'Oncology', 'Oncology inpatient ward.', '#0f4c81', 24],
            ['hdu_inpatient', 'inpatient', 'inpatient_weekly', 'HDU', 'High dependency unit reporting.', '#164e63', 12],
            ['transition_inpatient', 'inpatient', 'inpatient_weekly', 'Transition', 'Inpatient transition service reporting.', '#0e7490', null],
            ['outpatient_main', 'outpatient', 'outpatient_weekly', 'ART', 'Outpatient ART clinic reporting.', '#0f8ea8', null],
            ['gi_outpatient', 'outpatient', 'outpatient_weekly', 'GI', 'GI outpatient clinic.', '#0d9488', null],
            ['neuro_outpatient', 'outpatient', 'outpatient_weekly', 'Neuro', 'Neurology outpatient clinic.', '#2563eb', null],
            ['cardiac_outpatient', 'outpatient', 'outpatient_weekly', 'Cardiac', 'Cardiac outpatient clinic.', '#0f766e', null],
            ['nephrology_outpatient', 'outpatient', 'outpatient_weekly', 'Nephrology', 'Nephrology outpatient clinic.', '#0f8ea8', null],
            ['chest_outpatient', 'outpatient', 'outpatient_weekly', 'Chest', 'Chest outpatient clinic.', '#1d4ed8', null],
            ['hematology_outpatient', 'outpatient', 'outpatient_weekly', 'Hematology', 'Hematology outpatient clinic.', '#075985', null],
            ['oncology_outpatient', 'outpatient', 'outpatient_weekly', 'Oncology', 'Oncology outpatient clinic.', '#155e75', null],
            ['endocrine_outpatient', 'outpatient', 'outpatient_weekly', 'Endocrine', 'Endocrine outpatient clinic.', '#0f766e', null],
            ['opd_28', 'outpatient', 'outpatient_weekly', 'OPD 28', 'OPD 28 clinic reporting.', '#0e7490', null],
            ['rheumatology_outpatient', 'outpatient', 'outpatient_weekly', 'Rheumatology', 'Rheumatology clinic reporting.', '#0284c7', null],
            ['id_outpatient', 'outpatient', 'outpatient_weekly', 'ID', 'Infectious disease clinic.', '#1d4ed8', null],
            ['eeg_lab', 'procedure', 'eeg_weekly', 'Electroencephalography (EEG)', 'EEG weekly operational report.', '#0f8ea8', null],
            ['echocardiography_lab', 'procedure', 'echocardiography_weekly', 'Echocardiography Lab', 'Echocardiography service report.', '#0f766e', null],
            ['endoscopy_lab', 'procedure', 'endoscopy_weekly', 'Endoscopy Lab', 'Endoscopy service report.', '#155e75', null],
            ['hematology_procedures', 'procedure', 'hematology_procedures_weekly', 'Hematology Procedures', 'Hematology procedure service report.', '#1d4ed8', null],
            ['bronchoscopy_lab', 'procedure', 'bronchoscopy_weekly', 'Bronchoscopy Lab', 'Bronchoscopy service report.', '#0284c7', null],
            ['renal_procedures', 'procedure', 'renal_procedures_weekly', 'Renal Procedures', 'Renal procedure service report.', '#0f766e', null],
            ['dialysis_unit', 'procedure', 'dialysis_weekly', 'Dialysis', 'Dialysis procedure service report.', '#0f766e', null],
        ];

        foreach ($departments as [$slug, $family, $templateSlug, $name, $description, $accentColor, $bedCount]) {
            $wardSlug = self::WARD_SLUG_BY_DEPARTMENT[$slug] ?? null;

            Department::query()->updateOrCreate(
                ['slug' => $slug],
                [
                    'family' => $family,
                    'template_id' => $templateIds[$templateSlug],
                    'name' => $name,
                    'description' => $description,
                    'accent_color' => $accentColor,
                    'bed_count' => $bedCount,
                    'ward_id' => $wardSlug !== null ? ($wardIds[$wardSlug] ?? null) : null,
                ],
            );
        }
    }
}
