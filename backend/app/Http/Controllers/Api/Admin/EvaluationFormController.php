<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Api\Concerns\SerializesAdminResources;
use App\Http\Controllers\Controller;
use App\Models\EvaluationForm;
use App\Models\EvaluationFormField;
use App\Services\Academic\EvaluationFormService;
use App\Services\Admin\AdminAuditService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * The evaluation form editor (V2 Phase 4). Two tiers, mirroring the clinical
 * template editor exactly: CONTENT edits (labels, help text, order, option
 * wording, activating a non-core field) apply to the published version in
 * place; STRUCTURAL edits (add/remove fields, change key or type) go through
 * a draft that publishes as a new version, so historical evaluations keep
 * rendering against the version they were answered on.
 */
class EvaluationFormController extends Controller
{
    use SerializesAdminResources;

    public function __construct(
        private readonly EvaluationFormService $forms,
        private readonly AdminAuditService $auditService,
    ) {}

    public function index(): JsonResponse
    {
        Gate::authorize('viewAny', EvaluationForm::class);

        return response()->json([
            'data' => EvaluationForm::query()
                ->with('fields')
                ->orderBy('key')
                ->orderByDesc('version')
                ->get()
                ->map(fn (EvaluationForm $form) => $this->serializeEvaluationForm($form)),
        ]);
    }

    /**
     * Content edits, applied in place. Field entries are matched by key;
     * type, key, and the field set itself cannot change here.
     */
    public function updateContent(Request $request, EvaluationForm $evaluationForm): JsonResponse
    {
        Gate::authorize('editContent', $evaluationForm);

        $validated = $request->validate([
            'name' => ['sometimes', 'string', 'max:255'],
            'fields' => ['sometimes', 'array'],
            'fields.*.key' => ['required_with:fields', 'string'],
            'fields.*.label' => ['sometimes', 'string', 'max:255'],
            'fields.*.helpText' => ['sometimes', 'nullable', 'string', 'max:255'],
            'fields.*.section' => ['sometimes', 'string', 'max:120'],
            'fields.*.sortOrder' => ['sometimes', 'integer'],
            'fields.*.options' => ['sometimes', 'nullable', 'array'],
            'fields.*.active' => ['sometimes', 'boolean'],
        ]);

        $before = $this->serializeEvaluationForm($evaluationForm);

        DB::transaction(function () use ($evaluationForm, $validated): void {
            if (array_key_exists('name', $validated)) {
                $evaluationForm->forceFill(['name' => $validated['name']])->save();
            }

            $fieldsByKey = $evaluationForm->fields()->get()->keyBy('key');

            foreach ($validated['fields'] ?? [] as $entry) {
                /** @var EvaluationFormField|null $field */
                $field = $fieldsByKey[$entry['key']] ?? null;

                if ($field === null) {
                    throw ValidationException::withMessages([
                        'fields' => ["Unknown field '{$entry['key']}'. Adding fields is a structural edit."],
                    ]);
                }

                if (array_key_exists('active', $entry) && ! $entry['active'] && $field->is_core) {
                    throw ValidationException::withMessages([
                        'fields' => ["The core field '{$field->key}' cannot be deactivated."],
                    ]);
                }

                $updates = [];
                foreach ([
                    'label' => 'label',
                    'helpText' => 'help_text',
                    'section' => 'section',
                    'sortOrder' => 'sort_order',
                    'active' => 'active',
                ] as $camel => $snake) {
                    if (array_key_exists($camel, $entry)) {
                        $updates[$snake] = $entry[$camel];
                    }
                }

                // Option WORDING only: the value set (and thus stored answers)
                // must survive a content edit untouched.
                if (array_key_exists('options', $entry)) {
                    $updates['options'] = $this->mergeOptionWording($field, $entry['options']);
                }

                if ($updates !== []) {
                    $field->forceFill($updates)->save();
                }
            }
        });

        $evaluationForm->refresh()->load('fields');
        $after = $this->serializeEvaluationForm($evaluationForm);

        $this->auditService->record($request->user(), 'update_content', 'evaluation_form', $evaluationForm->id, $before, $after, $request);

        return response()->json($after);
    }

    /** Start (or resume) the structural draft for a form key. */
    public function storeDraft(Request $request, string $key): JsonResponse
    {
        Gate::authorize('editStructure', EvaluationForm::class);

        $draft = $this->forms->createDraftFrom($this->forms->published($key));

        $this->auditService->record($request->user(), 'create_draft', 'evaluation_form', $draft->id, null, [
            'key' => $draft->key,
            'version' => $draft->version,
        ], $request);

        return response()->json($this->serializeEvaluationForm($draft), 201);
    }

    /**
     * Replace a DRAFT's field set (add/remove/change type or key). Core-field
     * protection is enforced both here (is_core flags are pinned) and at
     * publish time (assertCoreFieldsIntact).
     */
    public function updateStructure(Request $request, EvaluationForm $evaluationForm): JsonResponse
    {
        Gate::authorize('editStructure', $evaluationForm);

        if ($evaluationForm->status !== 'draft') {
            throw ValidationException::withMessages([
                'form' => ['Structural edits only apply to a draft. Create a draft first.'],
            ]);
        }

        $validated = $request->validate([
            'fields' => ['required', 'array', 'min:1'],
            'fields.*.key' => ['required', 'string', 'max:64', 'regex:/^[a-z][a-z0-9_]*$/'],
            'fields.*.section' => ['required', 'string', 'max:120'],
            'fields.*.label' => ['required', 'string', 'max:255'],
            'fields.*.helpText' => ['sometimes', 'nullable', 'string', 'max:255'],
            'fields.*.type' => ['required', 'string', Rule::in(EvaluationForm::FIELD_TYPES)],
            'fields.*.options' => ['sometimes', 'nullable', 'array'],
            'fields.*.required' => ['sometimes', 'boolean'],
            'fields.*.sortOrder' => ['sometimes', 'integer'],
            'fields.*.active' => ['sometimes', 'boolean'],
        ]);

        $keys = array_column($validated['fields'], 'key');

        if (count($keys) !== count(array_unique($keys))) {
            throw ValidationException::withMessages([
                'fields' => ['Field keys must be unique.'],
            ]);
        }

        foreach ($validated['fields'] as $entry) {
            // These keys are claimed by the submit endpoint's own header
            // payload: a field named after one would clobber the controller's
            // validation rules for it.
            if (in_array($entry['key'], EvaluationForm::RESERVED_FIELD_KEYS, true)) {
                throw ValidationException::withMessages([
                    'fields' => ["'{$entry['key']}' is a reserved key and cannot be used as a field key."],
                ]);
            }

            // 'comment' lives on the evaluation header's text column, so any
            // other type would hand it a non-string value.
            if ($entry['key'] === 'comment' && $entry['type'] !== 'text') {
                throw ValidationException::withMessages([
                    'fields' => ["The 'comment' field must keep the text type."],
                ]);
            }

            // A select field with no choices could never be answered (and a
            // multi-select would silently drop every submitted member).
            if (in_array($entry['type'], ['single_select', 'multi_select'], true)
                && ($entry['options']['choices'] ?? []) === []) {
                throw ValidationException::withMessages([
                    'fields' => ["The select field '{$entry['key']}' needs at least one choice."],
                ]);
            }
        }

        $before = $this->serializeEvaluationForm($evaluationForm);

        DB::transaction(function () use ($evaluationForm, $validated): void {
            // is_core is pinned from the existing draft fields: structure
            // edits can never mint or strip core status.
            $coreByKey = $evaluationForm->fields()->get()->keyBy('key')->map(fn ($field) => $field->is_core);

            $evaluationForm->fields()->delete();

            foreach ($validated['fields'] as $index => $entry) {
                EvaluationFormField::query()->create([
                    'form_id' => $evaluationForm->id,
                    'key' => $entry['key'],
                    'section' => $entry['section'],
                    'label' => $entry['label'],
                    'help_text' => $entry['helpText'] ?? null,
                    'type' => $entry['type'],
                    'options' => $entry['options'] ?? null,
                    'required' => $entry['required'] ?? false,
                    'sort_order' => $entry['sortOrder'] ?? ($index + 1) * 10,
                    'active' => $entry['active'] ?? true,
                    'is_core' => (bool) ($coreByKey[$entry['key']] ?? false),
                ]);
            }
        });

        // Fail fast if a core field went missing, instead of at publish time.
        $this->forms->assertCoreFieldsIntact($evaluationForm->refresh());

        $evaluationForm->load('fields');
        $after = $this->serializeEvaluationForm($evaluationForm);

        $this->auditService->record($request->user(), 'update_structure', 'evaluation_form', $evaluationForm->id, $before, $after, $request);

        return response()->json($after);
    }

    public function publish(Request $request, EvaluationForm $evaluationForm): JsonResponse
    {
        Gate::authorize('editStructure', $evaluationForm);

        $this->forms->publish($evaluationForm);
        $evaluationForm->refresh()->load('fields');

        $this->auditService->record($request->user(), 'publish', 'evaluation_form', $evaluationForm->id, null, [
            'key' => $evaluationForm->key,
            'version' => $evaluationForm->version,
        ], $request);

        return response()->json($this->serializeEvaluationForm($evaluationForm));
    }

    /**
     * Merge new choice labels over the existing choices WITHOUT letting the
     * value set change: values present in the payload update their label;
     * unknown values are ignored; missing values keep their current entry.
     *
     * @param  array<string, mixed>|null  $incoming
     * @return array<string, mixed>|null
     */
    private function mergeOptionWording(EvaluationFormField $field, ?array $incoming): ?array
    {
        $current = $field->options;

        if ($current === null || ! isset($current['choices'])) {
            // Non-choice options (min/max bounds) are structural, not wording.
            return $current;
        }

        $incomingLabels = [];
        foreach ($incoming['choices'] ?? [] as $choice) {
            if (isset($choice['value'], $choice['label'])) {
                $incomingLabels[(string) $choice['value']] = (string) $choice['label'];
            }
        }

        $current['choices'] = array_map(
            fn (array $choice) => [
                ...$choice,
                'label' => $incomingLabels[(string) $choice['value']] ?? $choice['label'] ?? (string) $choice['value'],
            ],
            $current['choices'],
        );

        return $current;
    }
}
