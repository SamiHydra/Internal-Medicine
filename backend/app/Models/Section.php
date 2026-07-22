<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Section extends Model
{
    use HasUuids;

    protected $fillable = [
        'slug',
        'name',
        'head_user_id',
        'active',
    ];

    protected function casts(): array
    {
        return [
            'active' => 'boolean',
        ];
    }

    public function head(): BelongsTo
    {
        return $this->belongsTo(User::class, 'head_user_id');
    }

    public function consultants(): HasMany
    {
        return $this->hasMany(User::class, 'section_id');
    }

    public function dutyTypes(): HasMany
    {
        return $this->hasMany(DutyType::class);
    }
}
