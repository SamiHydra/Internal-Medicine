<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class StudentBatch extends Model
{
    use HasUuids;

    public const COHORTS = ['C1', 'C2'];

    protected $fillable = [
        'cohort',
        'label',
        'starts_on',
        'ends_on',
        'active',
    ];

    protected function casts(): array
    {
        return [
            'starts_on' => 'date',
            'ends_on' => 'date',
            'active' => 'boolean',
        ];
    }

    public function students(): HasMany
    {
        return $this->hasMany(Student::class, 'batch_id');
    }

    public function placements(): HasMany
    {
        return $this->hasMany(SubgroupPlacement::class, 'batch_id');
    }

    public function repAssignments(): HasMany
    {
        return $this->hasMany(RepAssignment::class, 'batch_id');
    }

    public function sessions(): HasMany
    {
        return $this->hasMany(TeachingSession::class, 'batch_id');
    }
}
