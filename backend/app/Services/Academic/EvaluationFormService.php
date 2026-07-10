<?php

namespace App\Services\Academic;

use App\Models\Evaluation;
use App\Models\EvaluationAnswer;
use App\Models\EvaluationForm;
use App\Models\EvaluationFormField;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * The evaluation form engine (V2 Phase 4). Content edits apply to the
 * published version in place; structural edits go through a draft that is
 * published as a NEW version, so historical evaluations keep rendering
 * against the version they were answered on. Core fields (the accountability
 * analytics inputs) can never be removed or type-changed.
 */
final class EvaluationFormService
{
    /**
     * Deliberately NOT memoized: the router caches controller (and thus
     * service) instances across requests in long-lived runtimes, so an
     * instance memo would serve a just-archived version after a publish.
     * The lookup is one indexed row plus its fields.
     */
    public function published(string $key): EvaluationForm
    {
        return EvaluationForm::query()
            ->with('fields')
            ->where('key', $key)
            ->where('status', 'published')
            ->firstOrFail();
    }

    /**
     * Laravel validation rules built from the form's ACTIVE field definitions,
     * keyed by field key. The `comment` field validates here but is stored on
     * the evaluation header, not as an answer.
     *
     * @return array<string, list<mixed>>
     */
    public function validationRulesFor(EvaluationForm $form): array
    {
        $rules = [];

        foreach ($form->fields as $field) {
            if (! $field->active) {
                continue;
            }

            $rules[$field->key] = $this->rulesForField($field);
        }

        return $rules;
    }

    /**
     * Write the header + answers in one transaction. $payload holds validated
     * answers keyed by field key; $context the header attributes (author,
     * subject, date, snapshots, external metadata).
     *
     * @param  array<string, mixed>  $payload
     * @param  array<string, mixed>  $context
     */
    public function store(EvaluationForm $form, array $payload, array $context): Evaluation
    {
        $this->assertHeaderInvariants($context);

        return DB::transaction(function () use ($form, $payload, $context): Evaluation {
            $evaluation = Evaluation::query()->create([
                ...$context,
                'form_id' => $form->id,
                'form_key' => $form->key,
                'comment' => $payload['comment'] ?? $context['comment'] ?? null,
            ]);

            foreach ($form->fields as $field) {
                if (! $field->active || $field->key === 'comment') {
                    continue;
                }

                if (! array_key_exists($field->key, $payload)) {
                    continue;
                }

                $value = $this->normalizeValue($field, $payload[$field->key]);

                if ($value === null) {
                    continue;
                }

                EvaluationAnswer::query()->create([
                    'evaluation_id' => $evaluation->id,
                    'field_key' => $field->key,
                    'value' => $value,
                ]);
            }

            return $evaluation;
        });
    }

    /** A structural edit starts here: copy the published form as version+1 draft. */
    public function createDraftFrom(EvaluationForm $form): EvaluationForm
    {
        return DB::transaction(function () use ($form): EvaluationForm {
            $existingDraft = EvaluationForm::query()
                ->where('key', $form->key)
                ->where('status', 'draft')
                ->first();

            if ($existingDraft !== null) {
                return $existingDraft->load('fields');
            }

            $nextVersion = (int) EvaluationForm::query()->where('key', $form->key)->max('version') + 1;

            $draft = EvaluationForm::query()->create([
                'key' => $form->key,
                'name' => $form->name,
                'target' => $form->target,
                'version' => $nextVersion,
                'status' => 'draft',
            ]);

            foreach ($form->fields as $field) {
                EvaluationFormField::query()->create([
                    ...$field->only(['section', 'key', 'label', 'help_text', 'type', 'options', 'required', 'sort_order', 'active', 'is_core']),
                    'form_id' => $draft->id,
                ]);
            }

            return $draft->load('fields');
        });
    }

    /** Publish a draft: archive the prior published version; exactly one published per key. */
    public function publish(EvaluationForm $draft): void
    {
        if ($draft->status !== 'draft') {
            throw ValidationException::withMessages([
                'form' => ['Only a draft version can be published.'],
            ]);
        }

        $this->assertCoreFieldsIntact($draft);

        DB::transaction(function () use ($draft): void {
            EvaluationForm::query()
                ->where('key', $draft->key)
                ->where('status', 'published')
                ->update(['status' => 'archived']);

            $draft->forceFill([
                'status' => 'published',
                'published_at' => now(),
            ])->save();
        });
    }

    /** Core fields can never be removed, deactivated, or type-changed. */
    public function assertCoreFieldsIntact(EvaluationForm $draft): void
    {
        $published = EvaluationForm::query()
            ->with('fields')
            ->where('key', $draft->key)
            ->where('status', 'published')
            ->first();

        if ($published === null) {
            return;
        }

        $draftFields = $draft->fields()->get()->keyBy('key');

        foreach ($published->fields as $field) {
            if (! $field->is_core) {
                continue;
            }

            $counterpart = $draftFields[$field->key] ?? null;

            if ($counterpart === null || ! $counterpart->active || $counterpart->type !== $field->type) {
                throw ValidationException::withMessages([
                    'fields' => ["The core field '{$field->key}' cannot be removed, deactivated, or change type: the accountability analytics depend on it."],
                ]);
            }
        }
    }

    /**
     * @return list<mixed>
     */
    private function rulesForField(EvaluationFormField $field): array
    {
        $rules = [$field->required ? 'required' : 'nullable'];

        switch ($field->type) {
            case 'boolean':
                $rules[] = 'boolean';
                break;
            case 'rating':
                $rules[] = 'integer';
                $rules[] = sprintf('between:%d,%d', $field->options['min'] ?? 1, $field->options['max'] ?? 5);
                break;
            case 'percent':
                $rules[] = 'integer';
                $rules[] = 'between:0,100';
                break;
            case 'integer':
                $rules[] = 'integer';
                $rules[] = sprintf('between:%d,%d', $field->options['min'] ?? 0, $field->options['max'] ?? 1000000);
                break;
            case 'time':
                $rules[] = 'date_format:H:i';
                break;
            case 'text':
                $rules[] = 'string';
                $rules[] = 'max:2000';
                break;
            case 'single_select':
                $rules[] = 'string';
                $rules[] = Rule::in($field->choiceValues());
                break;
            case 'multi_select':
                $rules[] = 'array';
                break;
        }

        return $rules;
    }

    /**
     * Multi-select members are validated here (nested rules would need the
     * caller to merge `key.*` entries; keeping it in one place is simpler).
     */
    private function normalizeValue(EvaluationFormField $field, mixed $value): mixed
    {
        if ($value === null || $value === '') {
            return null;
        }

        return match ($field->type) {
            'boolean' => (bool) $value,
            'rating', 'percent', 'integer' => (int) $value,
            'multi_select' => $this->normalizeMultiSelect($field, $value),
            default => $value,
        };
    }

    private function normalizeMultiSelect(EvaluationFormField $field, mixed $value): array
    {
        $allowed = $field->choiceValues();
        $values = array_values(array_filter(
            is_array($value) ? $value : [],
            fn ($entry) => is_string($entry) && ($allowed === [] || in_array($entry, $allowed, true)),
        ));

        return $values;
    }

    /**
     * @param  array<string, mixed>  $context
     */
    private function assertHeaderInvariants(array $context): void
    {
        $hasUserSubject = ! empty($context['subject_user_id']);
        $hasStudentSubject = ! empty($context['subject_student_id']);

        if ($hasUserSubject === $hasStudentSubject) {
            throw ValidationException::withMessages([
                'subjectId' => ['An evaluation names exactly one subject: a user or a student.'],
            ]);
        }

        $hasAuthor = ! empty($context['author_id']);
        $hasExternal = ! empty($context['external_evaluator_name']);

        if ($hasAuthor === $hasExternal) {
            throw ValidationException::withMessages([
                'authorId' => ['An evaluation carries exactly one source: an author account or an external evaluator name.'],
            ]);
        }
    }
}
