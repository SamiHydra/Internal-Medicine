<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class RepAssignment extends Model
{
    use HasUuids;

    public const SCOPES = ['group', 'subgroup_a', 'subgroup_b'];

    protected $fillable = [
        'user_id',
        'batch_id',
        'scope',
        'active',
    ];

    protected function casts(): array
    {
        return [
            'active' => 'boolean',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function batch(): BelongsTo
    {
        return $this->belongsTo(StudentBatch::class, 'batch_id');
    }

    /** Activity types this scope may record (guide 1.6). */
    public function recordableActivities(): array
    {
        return $this->scope === 'group'
            ? ['lecture', 'seminar']
            : ['bedside', 'teaching_round'];
    }

    /** The subgroup this scope covers, or null for cohort scope. */
    public function subgroup(): ?string
    {
        return match ($this->scope) {
            'subgroup_a' => 'A',
            'subgroup_b' => 'B',
            default => null,
        };
    }
}
