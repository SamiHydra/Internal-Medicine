<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Evaluation extends Model
{
    use HasUuids;

    protected $fillable = [
        'form_id',
        'form_key',
        'author_id',
        'subject_user_id',
        'subject_student_id',
        'evaluation_date',
        'ward_id',
        'placement_type',
        'week_starts_on',
        'external_evaluator_name',
        'external_evaluator_department',
        'entered_by_id',
        'comment',
    ];

    protected function casts(): array
    {
        return [
            'evaluation_date' => 'date',
            'week_starts_on' => 'date',
        ];
    }

    /** @var array<string, mixed>|null Lazily-built field_key => value map. */
    private ?array $answerMap = null;

    public function form(): BelongsTo
    {
        return $this->belongsTo(EvaluationForm::class, 'form_id');
    }

    public function answers(): HasMany
    {
        return $this->hasMany(EvaluationAnswer::class, 'evaluation_id');
    }

    public function author(): BelongsTo
    {
        return $this->belongsTo(User::class, 'author_id');
    }

    public function subject(): BelongsTo
    {
        return $this->belongsTo(User::class, 'subject_user_id');
    }

    public function ward(): BelongsTo
    {
        return $this->belongsTo(Ward::class, 'ward_id');
    }

    public function enteredBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'entered_by_id');
    }

    public function scopeForKey(Builder $query, string $formKey): Builder
    {
        return $query->where('form_key', $formKey);
    }

    /** The answered value for a field key, or null. Eager-load answers first. */
    public function answer(string $fieldKey): mixed
    {
        if ($this->answerMap === null) {
            $this->loadMissing('answers');
            $this->answerMap = $this->answers->pluck('value', 'field_key')->all();
        }

        return $this->answerMap[$fieldKey] ?? null;
    }

    public function isExternal(): bool
    {
        return $this->author_id === null;
    }
}
