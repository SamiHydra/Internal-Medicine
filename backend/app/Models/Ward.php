<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Ward extends Model
{
    use HasUuids;

    protected $fillable = [
        'slug',
        'name',
        'active',
    ];

    protected function casts(): array
    {
        return [
            'active' => 'boolean',
        ];
    }

    public function departments(): HasMany
    {
        return $this->hasMany(Department::class);
    }

    public function dutyTypes(): HasMany
    {
        return $this->hasMany(DutyType::class);
    }

    /** Student subgroup weeks placed on this ward (subgroup_placements.ward_id, restrict on delete). */
    public function subgroupPlacements(): HasMany
    {
        return $this->hasMany(SubgroupPlacement::class);
    }

    /** Evaluations that snapshotted this ward at submission (evaluations.ward_id). */
    public function evaluations(): HasMany
    {
        return $this->hasMany(Evaluation::class);
    }

    /** Teaching sessions that snapshotted this ward from the week's placement (teaching_sessions.ward_id). */
    public function teachingSessions(): HasMany
    {
        return $this->hasMany(TeachingSession::class);
    }
}
