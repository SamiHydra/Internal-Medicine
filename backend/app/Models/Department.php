<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Department extends Model
{
    use HasUuids;

    protected $fillable = [
        'slug', 'family', 'template_id', 'name', 'description', 'accent_color', 'bed_count', 'active',
    ];

    protected function casts(): array
    {
        return [
            'active' => 'boolean',
            'bed_count' => 'integer',
        ];
    }

    public function template(): BelongsTo
    {
        return $this->belongsTo(ReportTemplate::class, 'template_id');
    }

    public function assignments(): HasMany
    {
        return $this->hasMany(ReportAssignment::class);
    }

    public function accessRequestItems(): HasMany
    {
        return $this->hasMany(AccessRequestItem::class);
    }

    public function reports(): HasMany
    {
        return $this->hasMany(Report::class);
    }
}
