<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

return new class extends Migration
{
    /**
     * Data migration: v1 of the four evaluation forms. consultant_mdt and
     * resident_acgme reproduce today's hardcoded columns ONE FOR ONE, using
     * the current column names as field keys, so every analytics key stays
     * stable across the Phase 4 migration. student_weekly and student_final
     * are new (used from Phase 5). Idempotent: keyed by (key, version).
     */
    public function up(): void
    {
        $now = now();

        $mdtParticipants = [
            ['value' => 'consultant', 'label' => 'Consultant'],
            ['value' => 'fellow', 'label' => 'Fellow'],
            ['value' => 'internist', 'label' => 'Internist'],
            ['value' => 'residents', 'label' => 'Residents'],
            ['value' => 'interns', 'label' => 'Interns'],
            ['value' => 'nurse', 'label' => 'Nurse'],
            ['value' => 'clinical_pharmacy', 'label' => 'Clinical pharmacy'],
        ];

        $systemIssues = [
            ['value' => 'lab_delay', 'label' => 'Lab delay'],
            ['value' => 'imaging_delay', 'label' => 'Imaging delay'],
            ['value' => 'staff_shortage', 'label' => 'Staff shortage'],
            ['value' => 'bed_issue', 'label' => 'Bed issue'],
            ['value' => 'emr_interruption', 'label' => 'EMR interruption'],
            ['value' => 'communication_issue', 'label' => 'Communication issue'],
        ];

        $concerns = [
            ['value' => 'punctuality', 'label' => 'Punctuality'],
            ['value' => 'preparation', 'label' => 'Preparation'],
            ['value' => 'medical_knowledge', 'label' => 'Medical knowledge'],
            ['value' => 'clinical_reasoning', 'label' => 'Clinical reasoning'],
            ['value' => 'documentation', 'label' => 'Documentation'],
            ['value' => 'communication', 'label' => 'Communication'],
            ['value' => 'professionalism', 'label' => 'Professionalism'],
            ['value' => 'follow_through', 'label' => 'Follow-through'],
            ['value' => 'time_management', 'label' => 'Time management'],
        ];

        // [section, key, label, help, type, options, required, core]
        $forms = [
            [
                'key' => 'consultant_mdt',
                'name' => 'MDT round evaluation (of consultant)',
                'target' => 'consultant',
                'fields' => [
                    ['Round details', 'senior_present', 'Senior present', null, 'boolean', null, true, true],
                    ['Round details', 'senior_joined_at', 'Senior joined at', 'HH:MM', 'time', null, false, true],
                    ['Round details', 'presence_minutes', 'Presence (minutes)', '0 to 600', 'integer', ['min' => 0, 'max' => 600], false, true],
                    ['Round details', 'pct_patients_seen', 'Patients seen (%)', null, 'percent', null, false, false],
                    ['Round details', 'round_delayed', 'Round delayed', null, 'boolean', null, true, false],
                    ['Round quality', 'all_patients_reviewed', 'All patients reviewed', null, 'boolean', null, true, false],
                    ['Round quality', 'mgmt_plan_documented', 'Management plan documented', null, 'boolean', null, true, false],
                    ['Round quality', 'vte_assessed', 'VTE risk assessed', null, 'boolean', null, true, false],
                    ['Round quality', 'discharge_discussed', 'Discharge discussed', null, 'boolean', null, true, false],
                    ['Round quality', 'med_review_done', 'Medication review done', null, 'boolean', null, true, false],
                    ['Round quality', 'critical_labs_reviewed', 'Critical labs reviewed', null, 'boolean', null, true, false],
                    ['MDT participants', 'mdt_participants', 'Who joined the round', null, 'multi_select', ['choices' => $mdtParticipants], false, false],
                    ['System issues', 'system_issues', 'Friction encountered', null, 'multi_select', ['choices' => $systemIssues], false, false],
                    ['Notes', 'comment', 'Additional comment', null, 'text', null, false, false],
                ],
            ],
            [
                'key' => 'resident_acgme',
                'name' => 'Resident performance evaluation',
                'target' => 'resident',
                'fields' => [
                    ['Attendance & professionalism', 'on_time', 'Present & on time', null, 'boolean', null, true, false],
                    ['Attendance & professionalism', 'professional', 'Professional conduct', null, 'boolean', null, true, false],
                    ['Preparation & patient care', 'prepared', 'Knew patients; list & overnight events updated', null, 'boolean', null, true, false],
                    ['Preparation & patient care', 'management_plan', 'Appropriate, prioritized plan', null, 'boolean', null, true, false],
                    ['Medical knowledge', 'clinical_reasoning', 'Sound assessment & differential', null, 'boolean', null, true, false],
                    ['Communication', 'presentation_clear', 'Case presentation clear & concise', null, 'boolean', null, true, false],
                    ['Communication', 'communication', 'Effective with team / nursing / patient', null, 'boolean', null, true, false],
                    ['Documentation & systems', 'documentation_timely', 'Notes & orders complete and timely', null, 'boolean', null, true, false],
                    ['Documentation & systems', 'follow_through', 'Completed tasks; chased results & referrals', null, 'boolean', null, true, false],
                    ['Practice-based learning', 'responsive_feedback', 'Receptive to feedback & teaching', null, 'boolean', null, true, false],
                    ['Overall', 'overall_rating', 'Overall rating', '1 to 5', 'rating', ['min' => 1, 'max' => 5], true, true],
                    ['Areas to improve', 'concerns', 'Concerns', null, 'multi_select', ['choices' => $concerns], false, false],
                    ['Notes', 'comment', 'Additional comment', null, 'text', null, false, false],
                ],
            ],
            [
                'key' => 'student_weekly',
                'name' => 'Student weekly ward evaluation',
                'target' => 'student',
                'fields' => [
                    ['Weekly review', 'attendance_reliable', 'Attended reliably this week', null, 'boolean', null, true, false],
                    ['Weekly review', 'participation_active', 'Participated actively in rounds & teaching', null, 'boolean', null, true, false],
                    ['Weekly review', 'clinical_knowledge', 'Clinical knowledge appropriate for level', null, 'boolean', null, true, false],
                    ['Weekly review', 'skills_progress', 'Bedside skills progressing', null, 'boolean', null, true, false],
                    ['Weekly review', 'professional_conduct', 'Professional conduct', null, 'boolean', null, true, false],
                    ['Overall', 'overall_rating', 'Overall rating', '1 to 5', 'rating', ['min' => 1, 'max' => 5], true, false],
                    ['Notes', 'comment', 'Additional comment', null, 'text', null, false, false],
                ],
            ],
            [
                'key' => 'student_final',
                'name' => 'Student final attachment evaluation',
                'target' => 'student',
                'fields' => [
                    ['Final assessment', 'knowledge_competent', 'Knowledge meets attachment objectives', null, 'boolean', null, true, false],
                    ['Final assessment', 'skills_competent', 'Clinical & bedside skills competent', null, 'boolean', null, true, false],
                    ['Final assessment', 'professional_conduct', 'Professional conduct throughout', null, 'boolean', null, true, false],
                    ['Overall', 'overall_rating', 'Overall rating', '1 to 5', 'rating', ['min' => 1, 'max' => 5], true, false],
                    ['Narrative', 'strengths', 'Strengths', null, 'text', null, false, false],
                    ['Narrative', 'areas_to_improve', 'Areas to improve', null, 'text', null, false, false],
                    ['Notes', 'comment', 'Additional comment', null, 'text', null, false, false],
                ],
            ],
        ];

        foreach ($forms as $form) {
            $exists = DB::table('evaluation_forms')
                ->where('key', $form['key'])
                ->where('version', 1)
                ->exists();

            if ($exists) {
                continue;
            }

            $formId = (string) Str::uuid();

            DB::table('evaluation_forms')->insert([
                'id' => $formId,
                'key' => $form['key'],
                'name' => $form['name'],
                'target' => $form['target'],
                'version' => 1,
                'status' => 'published',
                'published_at' => $now,
                'created_at' => $now,
                'updated_at' => $now,
            ]);

            foreach ($form['fields'] as $index => [$section, $key, $label, $help, $type, $options, $required, $core]) {
                DB::table('evaluation_form_fields')->insert([
                    'id' => (string) Str::uuid(),
                    'form_id' => $formId,
                    'section' => $section,
                    'key' => $key,
                    'label' => $label,
                    'help_text' => $help,
                    'type' => $type,
                    'options' => $options === null ? null : json_encode($options),
                    'required' => $required,
                    'sort_order' => ($index + 1) * 10,
                    'active' => true,
                    'is_core' => $core,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }
        }
    }

    public function down(): void
    {
        DB::table('evaluation_forms')->whereIn('key', ['consultant_mdt', 'resident_acgme', 'student_weekly', 'student_final'])->delete();
    }
};
