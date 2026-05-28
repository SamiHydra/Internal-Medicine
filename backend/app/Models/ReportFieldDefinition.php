<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ReportFieldDefinition extends Model
{
    use HasUuids;

    protected $fillable = [
        'template_id', 'section_key', 'field_key', 'label',
        'field_kind', 'aggregate_type', 'display_order', 'metadata',
    ];

    protected function casts(): array
    {
        return [
            'metadata' => 'array',
            'display_order' => 'integer',
        ];
    }

    public function template(): BelongsTo
    {
        return $this->belongsTo(ReportTemplate::class, 'template_id');
    }

    public function values(): HasMany
    {
        return $this->hasMany(ReportFieldValue::class, 'field_definition_id');
    }
}
