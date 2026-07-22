<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ConsultantEvaluation extends Model
{
    use HasUuids;

    protected $fillable = [
        'author_id',
        'subject_id',
        'ward_id',
        'ward_ref_id',
        'placement_type',
        'evaluation_date',
        'senior_present',
        'senior_joined_at',
        'presence_minutes',
        'all_patients_reviewed',
        'mgmt_plan_documented',
        'vte_assessed',
        'discharge_discussed',
        'med_review_done',
        'critical_labs_reviewed',
        'pct_patients_seen',
        'round_delayed',
        'mdt_participants',
        'system_issues',
        'comment',
    ];

    /**
     * The six round-quality yes/no items that form the quality score.
     *
     * @var list<string>
     */
    public const SCORE_ITEMS = [
        'all_patients_reviewed',
        'mgmt_plan_documented',
        'vte_assessed',
        'discharge_discussed',
        'med_review_done',
        'critical_labs_reviewed',
    ];

    protected function casts(): array
    {
        return [
            'evaluation_date' => 'date',
            'senior_present' => 'boolean',
            'presence_minutes' => 'integer',
            'all_patients_reviewed' => 'boolean',
            'mgmt_plan_documented' => 'boolean',
            'vte_assessed' => 'boolean',
            'discharge_discussed' => 'boolean',
            'med_review_done' => 'boolean',
            'critical_labs_reviewed' => 'boolean',
            'pct_patients_seen' => 'integer',
            'round_delayed' => 'boolean',
            'mdt_participants' => 'array',
            'system_issues' => 'array',
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

    /** Snapshot of the physical teaching ward the round happened on. */
    public function wardRef(): BelongsTo
    {
        return $this->belongsTo(Ward::class, 'ward_ref_id');
    }
}
