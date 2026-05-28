<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ReportTemplate extends Model
{
    use HasUuids;

    protected $fillable = [
        'slug', 'family', 'name', 'description', 'active_days', 'metadata', 'active',
    ];

    protected function casts(): array
    {
        return [
            'active_days' => 'array',
            'metadata' => 'array',
            'active' => 'boolean',
        ];
    }

    public function departments(): HasMany
    {
        return $this->hasMany(Department::class, 'template_id');
    }

    public function fieldDefinitions(): HasMany
    {
        return $this->hasMany(ReportFieldDefinition::class, 'template_id');
    }

    public function assignments(): HasMany
    {
        return $this->hasMany(ReportAssignment::class, 'template_id');
    }

    public function reports(): HasMany
    {
        return $this->hasMany(Report::class, 'template_id');
    }
}
