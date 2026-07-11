<?php

namespace App\Models;

use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class MorningRosterOverride extends Model
{
    use HasUuids;

    protected $fillable = [
        'user_id',
        'action',
        'starts_on',
        'ends_on',
        'created_by',
    ];

    protected function casts(): array
    {
        return [
            'starts_on' => 'date',
            'ends_on' => 'date',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** Overrides active on $date (open-ended when ends_on is null). */
    public function scopeCovering(Builder $query, CarbonInterface $date): Builder
    {
        return $query
            ->whereDate('starts_on', '<=', $date->toDateString())
            ->where(fn (Builder $window) => $window
                ->whereNull('ends_on')
                ->orWhereDate('ends_on', '>=', $date->toDateString()));
    }
}
