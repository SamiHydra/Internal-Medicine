<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ResidentEvaluation extends Model
{
    use HasUuids;

    protected $fillable = [
        'author_id',
        'subject_id',
        'ward_id',
        'evaluation_date',
        'on_time',
        'prepared',
        'presentation_clear',
        'clinical_reasoning',
        'management_plan',
        'documentation_timely',
        'communication',
        'professional',
        'responsive_feedback',
        'follow_through',
        'overall_rating',
        'concerns',
        'comment',
    ];

    /**
     * The ten "met expectations" yes/no items that form the performance score.
     *
     * @var list<string>
     */
    public const SCORE_ITEMS = [
        'on_time',
        'prepared',
        'presentation_clear',
        'clinical_reasoning',
        'management_plan',
        'documentation_timely',
        'communication',
        'professional',
        'responsive_feedback',
        'follow_through',
    ];

    protected function casts(): array
    {
        return [
            'evaluation_date' => 'date',
            'on_time' => 'boolean',
            'prepared' => 'boolean',
            'presentation_clear' => 'boolean',
            'clinical_reasoning' => 'boolean',
            'management_plan' => 'boolean',
            'documentation_timely' => 'boolean',
            'communication' => 'boolean',
            'professional' => 'boolean',
            'responsive_feedback' => 'boolean',
            'follow_through' => 'boolean',
            'overall_rating' => 'integer',
            'concerns' => 'array',
        ];
    }

    public function author(): BelongsTo
    {
        return $this->belongsTo(User::class, 'author_id');
    }

    public function subject(): BelongsTo
    {
        return $this->belongsTo(User::class, 'subject_id');
    }

    public function ward(): BelongsTo
    {
        return $this->belongsTo(Department::class, 'ward_id');
    }
}
