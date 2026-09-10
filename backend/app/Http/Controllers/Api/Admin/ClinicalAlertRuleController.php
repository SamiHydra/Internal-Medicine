<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\ClinicalAlertRule;
use App\Models\ReportFieldDefinition;
use App\Models\ReportTemplate;
use App\Services\Admin\AdminAuditService;
use App\Services\Admin\AppSettingsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class ClinicalAlertRuleController extends Controller
{
    public function __construct(
        private readonly AdminAuditService $auditService,
        private readonly AppSettingsService $settings,
    ) {}

    public function index(): JsonResponse
    {
        Gate::authorize('viewAny', ClinicalAlertRule::class);
        $rules = ClinicalAlertRule::query()
            ->with(['template:id,slug,name', 'fieldDefinition:id,label,field_kind,active'])
            ->orderByDesc('active')
            ->orderBy('name')
            ->get();
        $templates = ReportTemplate::query()
            ->where('active', true)
            ->with(['fieldDefinitions' => fn ($query) => $query
                ->where('active', true)
                ->whereIn('field_kind', ['integer', 'decimal'])
                ->orderBy('display_order')])
            ->orderBy('name')
            ->get(['id', 'slug', 'name']);

        return response()->json([
            'data' => $rules->map(fn (ClinicalAlertRule $rule): array => $this->serialize($rule))->values(),
            'options' => $templates->map(fn (ReportTemplate $template): array => [
                'id' => $template->id,
                'slug' => $template->slug,
                'name' => $template->name,
                'fields' => $template->fieldDefinitions->map(fn (ReportFieldDefinition $field): array => [
                    'id' => $field->id,
                    'fieldKey' => $field->field_key,
                    'label' => $field->label,
                ])->values(),
            ])->values(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        Gate::authorize('create', ClinicalAlertRule::class);
        $validated = $this->validatePayload($request);
        $field = ReportFieldDefinition::query()
            ->where('template_id', $validated['template_id'])
            ->where('active', true)
            ->whereIn('field_kind', ['integer', 'decimal'])
            ->find($validated['field_definition_id']);
        if (! $field) {
            throw ValidationException::withMessages(['field_definition_id' => 'Choose an active numeric field from the selected report template.']);
        }
        if (ClinicalAlertRule::query()->where('field_definition_id', $field->id)->exists()) {
            throw ValidationException::withMessages(['field_definition_id' => 'This template field already has a clinical alert rule.']);
        }

        $rule = DB::transaction(function () use ($request, $validated, $field): ClinicalAlertRule {
            $rule = ClinicalAlertRule::query()->create([
                ...$this->attributes($validated, $field),
                'created_by' => $request->user()->id,
                'updated_by' => $request->user()->id,
            ]);
            $this->auditService->record($request->user(), 'create', 'clinical_alert_rule', $rule->id, null, $rule->toArray(), $request);

            return $rule;
        });
        $this->settings->forgetCache();

        return response()->json($this->serialize($rule->load(['template', 'fieldDefinition'])), 201);
    }

    public function update(Request $request, ClinicalAlertRule $clinicalAlertRule): JsonResponse
    {
        Gate::authorize('update', $clinicalAlertRule);
        $validated = $this->validatePayload($request, true);

        $rule = DB::transaction(function () use ($request, $clinicalAlertRule, $validated): ClinicalAlertRule {
            $rule = ClinicalAlertRule::query()->lockForUpdate()->findOrFail($clinicalAlertRule->id);
            $old = $rule->toArray();
            $field = null;
            if (isset($validated['field_definition_id']) || isset($validated['template_id'])) {
                $templateId = $validated['template_id'] ?? $rule->template_id;
                $fieldId = $validated['field_definition_id'] ?? $rule->field_definition_id;
                $field = ReportFieldDefinition::query()
                    ->where('template_id', $templateId)
                    ->where('active', true)
                    ->whereIn('field_kind', ['integer', 'decimal'])
                    ->find($fieldId);
                if (! $field) {
                    throw ValidationException::withMessages(['field_definition_id' => 'Choose an active numeric field from the selected report template.']);
                }
                if (ClinicalAlertRule::query()->where('field_definition_id', $field->id)->where('id', '!=', $rule->id)->exists()) {
                    throw ValidationException::withMessages(['field_definition_id' => 'This template field already has a clinical alert rule.']);
                }
            }
            $attributes = $field ? [
                ...$validated,
                'template_id' => $field->template_id,
                'field_definition_id' => $field->id,
                'field_key' => $field->field_key,
                'name' => $field->label,
            ] : $validated;
            $rule->fill($attributes);
            $rule->version++;
            $rule->updated_by = $request->user()->id;
            $rule->save();
            $this->auditService->record($request->user(), 'update', 'clinical_alert_rule', $rule->id, $old, $rule->toArray(), $request);

            return $rule;
        });
        $this->settings->forgetCache();

        return response()->json($this->serialize($rule->load(['template', 'fieldDefinition'])));
    }

    public function destroy(Request $request, ClinicalAlertRule $clinicalAlertRule): JsonResponse
    {
        Gate::authorize('delete', $clinicalAlertRule);
        DB::transaction(function () use ($request, $clinicalAlertRule): void {
            $old = $clinicalAlertRule->toArray();
            $clinicalAlertRule->forceFill([
                'active' => false,
                'effective_until' => now(),
                'version' => $clinicalAlertRule->version + 1,
                'updated_by' => $request->user()->id,
            ])->save();
            $this->auditService->record($request->user(), 'deactivate', 'clinical_alert_rule', $clinicalAlertRule->id, $old, $clinicalAlertRule->toArray(), $request);
        });
        $this->settings->forgetCache();

        return response()->json([], 204);
    }

    /** @return array<string, mixed> */
    private function validatePayload(Request $request, bool $partial = false): array
    {
        return $request->validate([
            'template_id' => [$partial ? 'sometimes' : 'required', 'uuid', 'exists:report_templates,id'],
            'field_definition_id' => [$partial ? 'sometimes' : 'required', 'uuid', 'exists:report_field_definitions,id'],
            'operator' => [$partial ? 'sometimes' : 'required', Rule::in(ClinicalAlertRule::OPERATORS)],
            'threshold' => [$partial ? 'sometimes' : 'required', 'numeric', 'min:0', 'max:9999999999'],
            'severity' => [$partial ? 'sometimes' : 'required', Rule::in(['low', 'medium', 'high'])],
            'deadline_hours' => [$partial ? 'sometimes' : 'required', 'integer', 'min:1', 'max:8760'],
            'responsible_role' => ['sometimes', 'nullable', Rule::in(['admin', 'superadmin'])],
            'notification_roles' => [$partial ? 'sometimes' : 'required', 'array', 'min:1'],
            'notification_roles.*' => [Rule::in(['admin', 'superadmin'])],
            'active' => ['sometimes', 'boolean'],
            'effective_from' => ['sometimes', 'nullable', 'date'],
            'effective_until' => ['sometimes', 'nullable', 'date', 'after:effective_from'],
        ]);
    }

    /** @param array<string, mixed> $validated @return array<string, mixed> */
    private function attributes(array $validated, ReportFieldDefinition $field): array
    {
        return [
            ...$validated,
            'template_id' => $field->template_id,
            'field_definition_id' => $field->id,
            'field_key' => $field->field_key,
            'name' => $field->label,
            'responsible_role' => $validated['responsible_role'] ?? 'admin',
            'notification_roles' => array_values(array_unique($validated['notification_roles'] ?? ['admin', 'superadmin'])),
            'active' => $validated['active'] ?? true,
            'effective_from' => $validated['effective_from'] ?? now(),
        ];
    }

    /** @return array<string, mixed> */
    private function serialize(ClinicalAlertRule $rule): array
    {
        return [
            'id' => $rule->id,
            'templateId' => $rule->template_id,
            'templateName' => $rule->template?->name,
            'fieldDefinitionId' => $rule->field_definition_id,
            'fieldKey' => $rule->field_key,
            'fieldLabel' => $rule->fieldDefinition?->label ?? $rule->name,
            'operator' => $rule->operator,
            'threshold' => $rule->threshold,
            'severity' => $rule->severity,
            'deadlineHours' => $rule->deadline_hours,
            'responsibleRole' => $rule->responsible_role,
            'notificationRoles' => $rule->notification_roles ?? [],
            'active' => $rule->active,
            'version' => $rule->version,
            'effectiveFrom' => $rule->effective_from?->toJSON(),
            'effectiveUntil' => $rule->effective_until?->toJSON(),
            'updatedAt' => $rule->updated_at?->toJSON(),
        ];
    }
}
