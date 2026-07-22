<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class DutyType extends Model
{
    use HasUuids;

    public const CATEGORIES = ['ward_service', 'clinical_duty', 'on_call', 'external', 'leave'];

    public const GRANULARITIES = ['monthly', 'daily'];

    protected $fillable = [
        'slug',
        'name',
        'section_id',
        'ward_id',
        'category',
        'granularity',
        'pairs_for_evaluation',
        'pairing_group',
        'counts_for_morning_roster',
        'active',
    ];

    protected function casts(): array
    {
        return [
            'pairs_for_evaluation' => 'boolean',
            'counts_for_morning_roster' => 'boolean',
            'active' => 'boolean',
        ];
    }

    public function section(): BelongsTo
    {
        return $this->belongsTo(Section::class);
    }

    public function ward(): BelongsTo
    {
        return $this->belongsTo(Ward::class);
    }

    public function assignments(): HasMany
    {
        return $this->hasMany(DutyAssignment::class);
    }

    /**
     * The key two duty types must share for their holders to evaluate each
     * other: the ward when the duty has one, otherwise the pairing group.
     * Null when the duty does not pair at all (on-call, dialysis, externals,
     * leave).
     */
    public function pairingKey(): ?string
    {
        if (! $this->pairs_for_evaluation) {
            return null;
        }

        if ($this->ward_id !== null) {
            return 'ward:'.$this->ward_id;
        }

        return $this->pairing_group !== null ? 'group:'.$this->pairing_group : null;
    }
}
