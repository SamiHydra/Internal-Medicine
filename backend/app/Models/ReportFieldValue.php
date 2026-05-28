<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ReportFieldValue extends Model
{
    use HasUuids;

    protected $fillable = [
        'report_id', 'field_definition_id', 'day_name',
        'value_number', 'value_text', 'value_time', 'value_json',
    ];

    protected function casts(): array
    {
        return [
            'value_number' => 'decimal:4',
            'value_json' => 'array',
        ];
    }

    public function report(): BelongsTo
    {
        return $this->belongsTo(Report::class);
    }

    public function fieldDefinition(): BelongsTo
    {
        return $this->belongsTo(ReportFieldDefinition::class, 'field_definition_id');
    }
}
