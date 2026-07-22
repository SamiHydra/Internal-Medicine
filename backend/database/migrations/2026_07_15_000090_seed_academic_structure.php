<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

return new class extends Migration
{
    /**
     * Data migration: the six teaching wards, eight specialty sections, and the
     * duty-type catalog, plus the inpatient department -> ward mapping. All rows
     * are keyed by slug so the migration is idempotent. Admins can rename or
     * extend everything later through the academic structure screens.
     *
     * The exact department -> ward mapping is an open item with the department
     * (V2 guide Section 14.1): HDU is not one of the six teaching wards, so
     * `hdu_inpatient` deliberately stays unmapped.
     */
    public function up(): void
    {
        $now = now();

        $wards = [
            'cardio_endocrine_ward' => 'Cardiology/Endocrinology Ward',
            'pulmonology_ward' => 'Pulmonology Ward',
            'hematology_oncology_ward' => 'Hematology/Oncology Ward',
            'gastro_neurology_ward' => 'Gastroenterology/Neurology Ward',
            'nephrology_ward' => 'Nephrology Ward',
            'transition_ward' => 'Transition Ward',
        ];

        foreach ($wards as $slug => $name) {
            if (! DB::table('wards')->where('slug', $slug)->exists()) {
                DB::table('wards')->insert([
                    'id' => (string) Str::uuid(),
                    'slug' => $slug,
                    'name' => $name,
                    'active' => true,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }
        }

        $wardIds = DB::table('wards')->pluck('id', 'slug');

        // Section slug => [name, ward slug of its ward service].
        // Cardiology + Endocrinology share one ward; so do Gastroenterology + Neurology.
        $sections = [
            'nephrology' => ['Nephrology', 'nephrology_ward'],
            'neurology' => ['Neurology', 'gastro_neurology_ward'],
            'cardiology' => ['Cardiology', 'cardio_endocrine_ward'],
            'endocrinology' => ['Endocrinology', 'cardio_endocrine_ward'],
            'pulmonology' => ['Pulmonology', 'pulmonology_ward'],
            'hematology' => ['Hematology', 'hematology_oncology_ward'],
            'oncology' => ['Oncology', 'hematology_oncology_ward'],
            'gastroenterology' => ['Gastroenterology', 'gastro_neurology_ward'],
        ];

        foreach ($sections as $slug => [$name]) {
            if (! DB::table('sections')->where('slug', $slug)->exists()) {
                DB::table('sections')->insert([
                    'id' => (string) Str::uuid(),
                    'slug' => $slug,
                    'name' => $name,
                    'active' => true,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }
        }

        $sectionIds = DB::table('sections')->pluck('id', 'slug');

        // [slug, name, section slug, ward slug, category, granularity, pairs, pairing_group, roster]
        $dutyTypes = [];

        foreach ($sections as $sectionSlug => [$sectionName, $wardSlug]) {
            $dutyTypes[] = ["{$sectionSlug}_ward_service", "{$sectionName} Ward Service", $sectionSlug, $wardSlug, 'ward_service', 'monthly', true, null, true];
            $dutyTypes[] = ["{$sectionSlug}_on_call", "{$sectionName} On Call", $sectionSlug, null, 'on_call', 'daily', false, null, true];
        }

        // Section-specific extras named by the client.
        $dutyTypes[] = ['transplant_icu_ward', 'Transplant ICU/Ward', 'nephrology', null, 'clinical_duty', 'monthly', true, 'transplant', true];
        $dutyTypes[] = ['dialysis', 'Dialysis', 'nephrology', null, 'clinical_duty', 'monthly', false, null, true];
        $dutyTypes[] = ['emergency_endoscopy', 'Emergency Endoscopy', 'gastroenterology', null, 'clinical_duty', 'daily', false, null, true];
        $dutyTypes[] = ['colonoscopy_duty', 'Colonoscopy Duty', 'gastroenterology', null, 'clinical_duty', 'monthly', false, null, true];

        // Department-wide duties. Transition is day-level: two internists per day,
        // owned by no section.
        $dutyTypes[] = ['transition_ward_duty', 'Transition Ward Duty', null, 'transition_ward', 'clinical_duty', 'daily', true, null, true];
        $dutyTypes[] = ['opd', 'OPD', null, null, 'clinical_duty', 'monthly', true, 'opd', true];
        $dutyTypes[] = ['annual_leave', 'Annual Leave', null, null, 'leave', 'monthly', false, null, false];

        // External rotations: recorded for the roster picture, never paired,
        // never on the morning roster.
        foreach ([
            'icu' => 'ICU',
            'emergency' => 'Emergency',
            'zewditu' => 'Zewditu Memorial Hospital',
            'saint_peter' => 'Saint Peter Specialized Hospital',
            'dermatology' => 'Dermatology',
            'radiology' => 'Radiology',
            'psychiatry' => 'Psychiatry',
        ] as $slug => $name) {
            $dutyTypes[] = [$slug, $name, null, null, 'external', 'monthly', false, null, false];
        }

        foreach ($dutyTypes as [$slug, $name, $sectionSlug, $wardSlug, $category, $granularity, $pairs, $pairingGroup, $roster]) {
            if (DB::table('duty_types')->where('slug', $slug)->exists()) {
                continue;
            }

            DB::table('duty_types')->insert([
                'id' => (string) Str::uuid(),
                'slug' => $slug,
                'name' => $name,
                'section_id' => $sectionSlug ? $sectionIds[$sectionSlug] : null,
                'ward_id' => $wardSlug ? $wardIds[$wardSlug] : null,
                'category' => $category,
                'granularity' => $granularity,
                'pairs_for_evaluation' => $pairs,
                'pairing_group' => $pairingGroup,
                'counts_for_morning_roster' => $roster,
                'active' => true,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }

        // Map the inpatient reporting units to their teaching ward. No-ops when
        // departments are not seeded yet (fresh test databases).
        $departmentWardMap = [
            'gi_neuro_inpatient' => 'gastro_neurology_ward',
            'cardiac_inpatient' => 'cardio_endocrine_ward',
            'nephrology_inpatient' => 'nephrology_ward',
            'chest_inpatient' => 'pulmonology_ward',
            'hematology_inpatient' => 'hematology_oncology_ward',
            'oncology_inpatient' => 'hematology_oncology_ward',
            'transition_inpatient' => 'transition_ward',
        ];

        foreach ($departmentWardMap as $departmentSlug => $wardSlug) {
            DB::table('departments')
                ->where('slug', $departmentSlug)
                ->whereNull('ward_id')
                ->update(['ward_id' => $wardIds[$wardSlug]]);
        }
    }

    public function down(): void
    {
        DB::table('departments')->update(['ward_id' => null]);
        DB::table('duty_types')->delete();
        DB::table('sections')->delete();
        DB::table('wards')->delete();
    }
};
