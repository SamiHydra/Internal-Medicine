<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ClinicalAlertRule extends Model
{
    use HasUuids;

    public const OPERATORS = ['gt', 'gte', 'eq'];

    protected $fillable = [
        'template_id', 'field_definition_id', 'field_key', 'name', 'operator',
        'threshold', 'severity', 'deadline_hours', 'responsible_role',
        'notification_roles', 'active', 'version', 'effective_from',
        'effective_until', 'created_by', 'updated_by',
    ];

    protected function casts(): array
    {
        return [
            'threshold' => 'float',
            'deadline_hours' => 'integer',
            'notification_roles' => 'array',
            'active' => 'boolean',
            'version' => 'integer',
            'effective_from' => 'datetime',
            'effective_until' => 'datetime',
        ];
    }

    public function template(): BelongsTo
    {
        return $this->belongsTo(ReportTemplate::class, 'template_id');
    }

    public function fieldDefinition(): BelongsTo
    {
        return $this->belongsTo(ReportFieldDefinition::class, 'field_definition_id');
    }

    public function actionItems(): HasMany
    {
        return $this->hasMany(ActionItem::class, 'clinical_alert_rule_id');
    }

    public function matches(float $value): bool
    {
        return match ($this->operator) {
            'gte' => $value >= $this->threshold,
            'eq' => abs($value - $this->threshold) < 0.00001,
            default => $value > $this->threshold,
        };
    }
}
