<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class EvaluationForm extends Model
{
    use HasUuids;

    public const KEYS = ['consultant_mdt', 'resident_acgme', 'student_weekly', 'student_final'];

    public const FIELD_TYPES = ['boolean', 'rating', 'percent', 'integer', 'time', 'text', 'single_select', 'multi_select'];

    protected $fillable = [
        'key',
        'name',
        'target',
        'version',
        'status',
        'published_at',
    ];

    protected function casts(): array
    {
        return [
            'version' => 'integer',
            'published_at' => 'datetime',
        ];
    }

    public function fields(): HasMany
    {
        return $this->hasMany(EvaluationFormField::class, 'form_id')->orderBy('sort_order');
    }

    public function evaluations(): HasMany
    {
        return $this->hasMany(Evaluation::class, 'form_id');
    }

    public function isPublished(): bool
    {
        return $this->status === 'published';
    }
}
