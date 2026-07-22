<?php

namespace App\Services\Academic;

use App\Models\Evaluation;
use App\Models\EvaluationAnswer;
use App\Models\EvaluationForm;
use App\Models\EvaluationFormField;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * The evaluation form engine (V2 Phase 4). Content edits apply atomically to
 * the current published version; structural edits go through a draft that is
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

            // Members get their own rule so a disallowed value 422s instead of
            // being silently dropped at normalize time.
            if ($field->type === 'multi_select' && $field->choiceValues() !== []) {
                $rules[$field->key.'.*'] = ['string', Rule::in($field->choiceValues())];
            }
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
        return $this->createDraftWithState($form)['form'];
    }

    /** @return array{form: EvaluationForm, created: bool} */
    public function createDraftWithState(EvaluationForm $form): array
    {
        return DB::transaction(function () use ($form): array {
            $versions = $this->lockFormKey($form->key);
            $existingDraft = $versions->firstWhere('status', 'draft');

            if ($existingDraft !== null) {
                return ['form' => $existingDraft->load('fields'), 'created' => false];
            }

            $source = $versions->firstWhere('id', $form->id);

            if ($source === null) {
                throw ValidationException::withMessages([
                    'form' => ['The source form no longer exists.'],
                ]);
            }

            $source->load('fields');
            $nextVersion = (int) $versions->max('version') + 1;

            $draft = EvaluationForm::query()->create([
                'key' => $source->key,
                'name' => $source->name,
                'target' => $source->target,
                'version' => $nextVersion,
                'status' => 'draft',
            ]);

            foreach ($source->fields as $field) {
                EvaluationFormField::query()->create([
                    ...$field->only(['section', 'key', 'label', 'help_text', 'type', 'options', 'required', 'sort_order', 'active', 'is_core']),
                    'form_id' => $draft->id,
                ]);
            }

            return ['form' => $draft->load('fields'), 'created' => true];
        });
    }

    /**
     * Apply wording and presentation edits to the current published version
     * under the same form-key lock used by draft creation and publishing.
     *
     * @param  array<string, mixed>  $attributes
     */
    public function updateContent(EvaluationForm $form, array $attributes): EvaluationForm
    {
        return DB::transaction(function () use ($form, $attributes): EvaluationForm {
            $published = $this->lockedPublished($form);

            if (array_key_exists('name', $attributes)) {
                $published->forceFill(['name' => $attributes['name']])->save();
            }

            $fieldsByKey = $published->fields()
                ->lockForUpdate()
                ->get()
                ->keyBy('key');

            foreach ($attributes['fields'] ?? [] as $entry) {
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

            return $published->refresh()->load('fields');
        });
    }

    /**
     * Replace a draft's field set atomically. Core validation deliberately
     * runs before this transaction commits, so an invalid replacement rolls
     * back both the delete and every inserted field.
     *
     * @param  list<array<string, mixed>>  $fields
     */
    public function updateStructure(EvaluationForm $form, array $fields): EvaluationForm
    {
        return DB::transaction(function () use ($form, $fields): EvaluationForm {
            $draft = $this->lockedDraft($form);
            $existingFields = $draft->fields()
                ->lockForUpdate()
                ->get();
            $coreByKey = $existingFields->keyBy('key')->map(fn (EvaluationFormField $field) => $field->is_core);

            $draft->fields()->delete();

            foreach ($fields as $index => $entry) {
                EvaluationFormField::query()->create([
                    'form_id' => $draft->id,
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

            $this->assertCoreFieldsIntact($draft);

            return $draft->refresh()->load('fields');
        });
    }

    /** Publish a draft: archive the prior published version; exactly one published per key. */
    public function publish(EvaluationForm $draft): void
    {
        $this->publishWithState($draft);
    }

    /** Return true only when this call performed the publish transition. */
    public function publishWithState(EvaluationForm $draft): bool
    {
        return DB::transaction(function () use ($draft): bool {
            $versions = $this->lockFormKey($draft->key);
            $lockedDraft = $versions->firstWhere('id', $draft->id);

            if ($lockedDraft === null) {
                throw ValidationException::withMessages([
                    'form' => ['The draft form no longer exists.'],
                ]);
            }

            // A retry after a committed response is an idempotent success.
            if ($lockedDraft->status === 'published') {
                return false;
            }

            if ($lockedDraft->status !== 'draft') {
                throw ValidationException::withMessages([
                    'form' => ['Only a draft version can be published.'],
                ]);
            }

            $this->assertCoreFieldsIntact($lockedDraft);

            EvaluationForm::query()
                ->where('key', $lockedDraft->key)
                ->where('status', 'published')
                ->update(['status' => 'archived']);

            $lockedDraft->forceFill([
                'status' => 'published',
                'published_at' => now(),
            ])->save();

            return true;
        });
    }

    /**
     * Lock every version for one logical form. A form key always has a seeded
     * published row, so the parent range exists even before its first draft.
     * MariaDB serializes draft version allocation and publish transitions on
     * these rows; the generated active-status unique key is the final guard.
     */
    private function lockFormKey(string $key): Collection
    {
        $versions = EvaluationForm::query()
            ->where('key', $key)
            ->orderBy('version')
            ->lockForUpdate()
            ->get();

        if ($versions->isEmpty()) {
            throw ValidationException::withMessages([
                'form' => ['The evaluation form no longer exists.'],
            ]);
        }

        return $versions;
    }

    /** Re-read status from the locked row instead of trusting a stale model. */
    private function lockedDraft(EvaluationForm $form): EvaluationForm
    {
        $versions = $this->lockFormKey($form->key);
        $locked = $versions->firstWhere('id', $form->id);

        if ($locked === null) {
            throw ValidationException::withMessages([
                'form' => ['The evaluation form no longer exists.'],
            ]);
        }

        if ($locked->status !== 'draft') {
            throw ValidationException::withMessages([
                'form' => ['Only a draft version can be edited. Create or resume a draft first.'],
            ]);
        }

        return $locked;
    }

    /** Re-read the target and ensure it is still the active published row. */
    private function lockedPublished(EvaluationForm $form): EvaluationForm
    {
        $versions = $this->lockFormKey($form->key);
        $locked = $versions->firstWhere('id', $form->id);
        $current = $versions->firstWhere('status', 'published');

        if ($locked === null) {
            throw ValidationException::withMessages([
                'form' => ['The evaluation form no longer exists.'],
            ]);
        }

        if ($locked->status !== 'published' || $current?->id !== $locked->id) {
            throw ValidationException::withMessages([
                'form' => ['Content edits only apply to the current published version.'],
            ]);
        }

        return $locked;
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
     * Merge new choice labels over the existing choices without allowing the
     * stored value set to change.
     *
     * @param  array<string, mixed>|null  $incoming
     * @return array<string, mixed>|null
     */
    private function mergeOptionWording(EvaluationFormField $field, ?array $incoming): ?array
    {
        $current = $field->options;

        if ($current === null || ! isset($current['choices'])) {
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
        // Disallowed members already 422 via the `key.*` rule; this is the
        // last line of defence, so an empty choice list admits nothing.
        $allowed = $field->choiceValues();

        return array_values(array_filter(
            is_array($value) ? $value : [],
            fn ($entry) => is_string($entry) && in_array($entry, $allowed, true),
        ));
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
        $hasExternal = isset($context['external_evaluator_name'])
            && trim((string) $context['external_evaluator_name']) !== '';

        if ($hasAuthor === $hasExternal) {
            throw ValidationException::withMessages([
                'authorId' => ['An evaluation carries exactly one source: an author account or an external evaluator name.'],
            ]);
        }
    }
}
