<?php

namespace App\Http\Controllers\Api\Concerns;

use App\Models\AccessRequest;
use App\Models\ActionItem;
use App\Models\AdminAccessRequest;
use App\Models\AdminAuditLog;
use App\Models\AppSetting;
use App\Models\AuditLog;
use App\Models\Department;
use App\Models\Evaluation;
use App\Models\EvaluationForm;
use App\Models\EvaluationFormField;
use App\Models\ReportAssignment;
use App\Models\ReportFieldDefinition;
use App\Models\ReportingPeriod;
use App\Models\ReportTemplate;
use App\Models\User;
use App\Support\Academic\EvaluationScoring;
use Illuminate\Database\Eloquent\Model;

trait SerializesAdminResources
{
    /**
     * @return array<string, mixed>
     */
    protected function serializeUser(User $user, bool $withAssignments = true): array
    {
        if ($withAssignments) {
            $user->loadMissing(['assignments.department', 'assignments.template']);
        }

        return [
            'id' => $user->id,
            'fullName' => $user->full_name,
            'email' => $user->email,
            'username' => $user->username,
            'role' => $user->role_key,
            'title' => $user->title,
            'active' => (bool) $user->active,
            'phone' => $user->phone,
            'passwordChangeRequired' => (bool) $user->password_change_required,
            'lastLoginAt' => $user->last_login_at?->toJSON(),
            'createdAt' => $user->created_at?->toJSON(),
            'updatedAt' => $user->updated_at?->toJSON(),
            'assignments' => $withAssignments
                ? $user->assignments->map(fn (ReportAssignment $assignment) => $this->serializeAssignment($assignment))->values()
                : [],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    protected function serializeAssignment(ReportAssignment $assignment): array
    {
        $assignment->loadMissing(['nurse', 'department', 'template', 'approver']);

        return [
            'id' => $assignment->id,
            'nurseId' => $assignment->nurse_id,
            'nurseName' => $assignment->nurse?->full_name,
            'departmentId' => $assignment->department_id,
            'departmentSlug' => $assignment->department?->slug,
            'departmentName' => $assignment->department?->name,
            'templateId' => $assignment->template_id,
            'templateSlug' => $assignment->template?->slug,
            'templateName' => $assignment->template?->name,
            'approvedAt' => $assignment->approved_at?->toJSON(),
            'approvedBy' => $assignment->approved_by,
            'approvedByName' => $assignment->approver?->full_name,
            'active' => (bool) $assignment->active,
            'createdAt' => $assignment->created_at?->toJSON(),
            'updatedAt' => $assignment->updated_at?->toJSON(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    protected function serializeDepartment(Department $department): array
    {
        $department->loadMissing('template');

        return [
            'id' => $department->id,
            'slug' => $department->slug,
            'family' => $department->family,
            'templateId' => $department->template_id,
            'templateSlug' => $department->template?->slug,
            'name' => $department->name,
            'description' => $department->description,
            'accentColor' => $department->accent_color,
            'bedCount' => $department->bed_count,
            'active' => (bool) $department->active,
            'createdAt' => $department->created_at?->toJSON(),
            'updatedAt' => $department->updated_at?->toJSON(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    protected function serializeTemplate(ReportTemplate $template, bool $withFields = true): array
    {
        if ($withFields) {
            $template->loadMissing(['fieldDefinitions' => fn ($query) => $query->orderBy('display_order')]);
        }

        return [
            'id' => $template->id,
            'slug' => $template->slug,
            'family' => $template->family,
            'name' => $template->name,
            'description' => $template->description,
            'activeDays' => $template->active_days,
            'metadata' => $template->metadata,
            'active' => (bool) $template->active,
            'createdAt' => $template->created_at?->toJSON(),
            'updatedAt' => $template->updated_at?->toJSON(),
            'fields' => $withFields
                ? $template->fieldDefinitions->map(fn (ReportFieldDefinition $field) => $this->serializeFieldDefinition($field))->values()
                : [],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    protected function serializeFieldDefinition(ReportFieldDefinition $field): array
    {
        return [
            'id' => $field->id,
            'templateId' => $field->template_id,
            'sectionKey' => $field->section_key,
            'fieldKey' => $field->field_key,
            'label' => $field->label,
            'fieldKind' => $field->field_kind,
            'aggregateType' => $field->aggregate_type,
            'displayOrder' => $field->display_order,
            'active' => (bool) ($field->active ?? true),
            'metadata' => $field->metadata,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    protected function serializeAdminAccessRequest(AdminAccessRequest $adminRequest): array
    {
        $adminRequest->loadMissing(['reviewer', 'createdUser']);

        return [
            'id' => $adminRequest->id,
            'fullName' => $adminRequest->full_name,
            'email' => $adminRequest->email,
            'requestedRole' => $adminRequest->requested_role,
            'status' => $adminRequest->status,
            'notes' => $adminRequest->notes,
            'requestedAt' => $adminRequest->requested_at?->toJSON(),
            'reviewedAt' => $adminRequest->reviewed_at?->toJSON(),
            'reviewedBy' => $adminRequest->reviewed_by,
            'reviewedByName' => $adminRequest->reviewer?->full_name,
            'createdUserId' => $adminRequest->created_user_id,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    protected function serializeAccessRequest(AccessRequest $accessRequest): array
    {
        $accessRequest->loadMissing(['user', 'reviewer', 'items.department', 'items.template']);

        return [
            'id' => $accessRequest->id,
            'userId' => $accessRequest->user_id,
            'userName' => $accessRequest->user?->full_name ?? $accessRequest->email,
            'email' => $accessRequest->email,
            'status' => $accessRequest->status,
            'notes' => $accessRequest->notes,
            'requestedAt' => $accessRequest->requested_at?->toJSON(),
            'reviewedAt' => $accessRequest->reviewed_at?->toJSON(),
            'reviewedBy' => $accessRequest->reviewed_by,
            'reviewedByName' => $accessRequest->reviewer?->full_name,
            'requestedAssignments' => $accessRequest->items->map(fn ($item) => [
                'departmentId' => $item->department_id,
                'departmentSlug' => $item->department?->slug,
                'departmentName' => $item->department?->name,
                'templateId' => $item->template_id,
                'templateSlug' => $item->template?->slug,
                'templateName' => $item->template?->name,
            ])->values(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    protected function serializeConsultantEvaluation(Evaluation $evaluation): array
    {
        $evaluation->loadMissing(['author', 'subject', 'ward', 'answers']);

        return [
            'id' => $evaluation->id,
            'authorId' => $evaluation->author_id,
            'authorName' => $evaluation->author?->full_name,
            'subjectId' => $evaluation->subject_user_id,
            'subjectName' => $evaluation->subject?->full_name,
            'wardId' => $evaluation->ward_id,
            'wardName' => $evaluation->ward?->name,
            'placementType' => $evaluation->placement_type,
            'evaluationDate' => $evaluation->evaluation_date?->toJSON(),
            'seniorPresent' => (bool) $evaluation->answer('senior_present'),
            'seniorJoinedAt' => $this->formatClockTime($evaluation->answer('senior_joined_at')),
            'presenceMinutes' => $evaluation->answer('presence_minutes'),
            'allPatientsReviewed' => (bool) $evaluation->answer('all_patients_reviewed'),
            'mgmtPlanDocumented' => (bool) $evaluation->answer('mgmt_plan_documented'),
            'vteAssessed' => (bool) $evaluation->answer('vte_assessed'),
            'dischargeDiscussed' => (bool) $evaluation->answer('discharge_discussed'),
            'medReviewDone' => (bool) $evaluation->answer('med_review_done'),
            'criticalLabsReviewed' => (bool) $evaluation->answer('critical_labs_reviewed'),
            'pctPatientsSeen' => $evaluation->answer('pct_patients_seen'),
            'roundDelayed' => (bool) $evaluation->answer('round_delayed'),
            'mdtParticipants' => $evaluation->answer('mdt_participants') ?? [],
            'systemIssues' => $evaluation->answer('system_issues') ?? [],
            'comment' => $evaluation->comment,
            'qualityScore' => round(EvaluationScoring::score($evaluation, 'consultant'), 1),
            'createdAt' => $evaluation->created_at?->toJSON(),
            'updatedAt' => $evaluation->updated_at?->toJSON(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    protected function serializeResidentEvaluation(Evaluation $evaluation): array
    {
        $evaluation->loadMissing(['author', 'subject', 'ward', 'answers']);

        return [
            'id' => $evaluation->id,
            'authorId' => $evaluation->author_id,
            // Externally-sourced rows have no author account; show the paper
            // evaluator's name instead.
            'authorName' => $evaluation->author?->full_name ?? $evaluation->external_evaluator_name,
            'external' => $evaluation->author_id === null,
            'externalEvaluatorName' => $evaluation->external_evaluator_name,
            'externalEvaluatorDepartment' => $evaluation->external_evaluator_department,
            'subjectId' => $evaluation->subject_user_id,
            'subjectName' => $evaluation->subject?->full_name,
            'wardId' => $evaluation->ward_id,
            'wardName' => $evaluation->ward?->name,
            'placementType' => $evaluation->placement_type,
            'evaluationDate' => $evaluation->evaluation_date?->toJSON(),
            'onTime' => (bool) $evaluation->answer('on_time'),
            'prepared' => (bool) $evaluation->answer('prepared'),
            'presentationClear' => (bool) $evaluation->answer('presentation_clear'),
            'clinicalReasoning' => (bool) $evaluation->answer('clinical_reasoning'),
            'managementPlan' => (bool) $evaluation->answer('management_plan'),
            'documentationTimely' => (bool) $evaluation->answer('documentation_timely'),
            'communication' => (bool) $evaluation->answer('communication'),
            'professional' => (bool) $evaluation->answer('professional'),
            'responsiveFeedback' => (bool) $evaluation->answer('responsive_feedback'),
            'followThrough' => (bool) $evaluation->answer('follow_through'),
            'overallRating' => $evaluation->answer('overall_rating'),
            'concerns' => $evaluation->answer('concerns') ?? [],
            'comment' => $evaluation->comment,
            'performanceScore' => round(EvaluationScoring::score($evaluation, 'resident'), 1),
            'createdAt' => $evaluation->created_at?->toJSON(),
            'updatedAt' => $evaluation->updated_at?->toJSON(),
        ];
    }

    /**
     * A student evaluation (student_weekly / student_final): generic answer
     * map keyed by camelCase field key, since the form is admin-editable.
     *
     * @return array<string, mixed>
     */
    protected function serializeStudentEvaluation(Evaluation $evaluation): array
    {
        $evaluation->loadMissing(['author', 'ward', 'answers', 'form.fields']);
        $student = \App\Models\Student::query()->with('batch')->find($evaluation->subject_student_id);

        $answers = [];
        foreach ($evaluation->form?->fields ?? [] as $field) {
            if ($field->key === 'comment') {
                continue;
            }
            $answers[\Illuminate\Support\Str::camel($field->key)] = $evaluation->answer($field->key);
        }

        return [
            'id' => $evaluation->id,
            'formKey' => $evaluation->form_key,
            'authorId' => $evaluation->author_id,
            'authorName' => $evaluation->author?->full_name,
            'subjectStudentId' => $evaluation->subject_student_id,
            'subjectName' => $student?->full_name,
            'batchLabel' => $student?->batch?->label,
            'wardId' => $evaluation->ward_id,
            'wardName' => $evaluation->ward?->name,
            'weekStartsOn' => $evaluation->week_starts_on?->toDateString(),
            'evaluationDate' => $evaluation->evaluation_date?->toJSON(),
            'answers' => $answers,
            'comment' => $evaluation->comment,
            'createdAt' => $evaluation->created_at?->toJSON(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    protected function serializeEvaluationForm(EvaluationForm $form): array
    {
        $form->loadMissing('fields');

        return [
            'id' => $form->id,
            'key' => $form->key,
            'name' => $form->name,
            'target' => $form->target,
            'version' => $form->version,
            'status' => $form->status,
            'publishedAt' => $form->published_at?->toJSON(),
            'fields' => $form->fields->map(fn (EvaluationFormField $field) => [
                'id' => $field->id,
                'section' => $field->section,
                'key' => $field->key,
                'label' => $field->label,
                'helpText' => $field->help_text,
                'type' => $field->type,
                'options' => $field->options,
                'required' => (bool) $field->required,
                'sortOrder' => $field->sort_order,
                'active' => (bool) $field->active,
                'isCore' => (bool) $field->is_core,
            ])->values(),
        ];
    }

    /**
     * Normalize a time column to HH:MM (the DB may return "08:15" or "08:15:00").
     */
    protected function formatClockTime(?string $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        return substr($value, 0, 5);
    }

    /**
     * @return array<string, mixed>
     */
    protected function serializeAuditLog(AuditLog $auditLog): array
    {
        $auditLog->loadMissing(['fieldDefinition', 'changedBy', 'department', 'template']);

        return [
            'id' => $auditLog->id,
            'reportId' => $auditLog->report_id,
            'fieldDefinitionId' => $auditLog->field_definition_id,
            'fieldKey' => $auditLog->field_key,
            'fieldLabel' => $auditLog->fieldDefinition?->label ?? $auditLog->field_key,
            'dayName' => $auditLog->day_name,
            'oldValue' => $auditLog->old_value,
            'newValue' => $auditLog->new_value,
            'changedBy' => $auditLog->changed_by,
            'changedByName' => $auditLog->changed_by_name ?? $auditLog->changedBy?->full_name,
            'changedAt' => $auditLog->changed_at?->toJSON(),
            'departmentId' => $auditLog->department_id,
            'departmentSlug' => $auditLog->department?->slug,
            'templateId' => $auditLog->template_id,
            'templateSlug' => $auditLog->template?->slug,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    protected function serializeAdminAuditLog(AdminAuditLog $auditLog): array
    {
        return [
            'id' => $auditLog->id,
            'userId' => $auditLog->user_id,
            'userName' => $auditLog->user_name,
            'action' => $auditLog->action,
            'entityType' => $auditLog->entity_type,
            'entityId' => $auditLog->entity_id,
            'oldValues' => $auditLog->old_values,
            'newValues' => $auditLog->new_values,
            'ipAddress' => $auditLog->ip_address,
            'userAgent' => $auditLog->user_agent,
            'createdAt' => $auditLog->created_at?->toJSON(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    protected function serializeAppSetting(AppSetting $setting): array
    {
        return [
            'settingKey' => $setting->setting_key,
            'value' => $setting->value_json,
            'updatedBy' => $setting->updated_by,
            'updatedAt' => $setting->updated_at?->toJSON(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    protected function serializeActionItem(ActionItem $item): array
    {
        $item->loadMissing(['department', 'assignee', 'creator', 'resolver']);

        return [
            'id' => $item->id,
            'reportId' => $item->report_id,
            'departmentId' => $item->department_id,
            'departmentName' => $item->department?->name,
            'source' => $item->source,
            'title' => $item->title,
            'description' => $item->description,
            'severity' => $item->severity,
            'status' => $item->status,
            'assignedTo' => $item->assigned_to,
            'assignedToName' => $item->assignee?->full_name,
            'createdBy' => $item->created_by,
            'createdByName' => $item->creator?->full_name,
            'resolvedBy' => $item->resolved_by,
            'resolvedByName' => $item->resolver?->full_name,
            'resolutionNote' => $item->resolution_note,
            'resolvedAt' => $item->resolved_at?->toJSON(),
            'createdAt' => $item->created_at?->toJSON(),
            'updatedAt' => $item->updated_at?->toJSON(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    protected function serializeReportingPeriod(ReportingPeriod $period): array
    {
        return [
            'id' => $period->id,
            'weekStart' => $period->week_start?->toDateString(),
            'weekEnd' => $period->week_end?->toDateString(),
            'deadlineAt' => $period->deadline_at?->toJSON(),
            'monthLabel' => $period->month_label,
            'quarterLabel' => $period->quarter_label,
            'year' => $period->year_num,
        ];
    }
}
