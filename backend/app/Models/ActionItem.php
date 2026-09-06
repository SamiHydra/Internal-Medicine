<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ActionItem extends Model
{
    use HasUuids;

    public const STATUSES = ['open', 'assigned', 'in_progress', 'resolved', 'closed'];

    public const OUTSTANDING_STATUSES = ['open', 'assigned', 'in_progress'];

    public const SEVERITIES = ['low', 'medium', 'high'];

    protected $fillable = [
        'report_id', 'department_id', 'clinical_alert_rule_id', 'rule_version', 'source', 'source_key',
        'field_key', 'observed_value', 'trigger_threshold', 'trigger_operator', 'title', 'description',
        'severity', 'status', 'condition_state', 'assigned_to', 'responsible_role',
        'due_at', 'overdue_notified_at', 'created_by', 'resolved_by', 'verified_by',
        'resolution_note', 'resolved_at', 'verified_at',
    ];

    protected function casts(): array
    {
        return [
            'observed_value' => 'float',
            'trigger_threshold' => 'float',
            'rule_version' => 'integer',
            'due_at' => 'datetime',
            'overdue_notified_at' => 'datetime',
            'resolved_at' => 'datetime',
            'verified_at' => 'datetime',
        ];
    }

    /**
     * Where a notification about this item should land. Always the deep link:
     * the bare queue drops the reader on a list of every open action with no
     * hint which one they were told about.
     */
    public function notificationRoute(): string
    {
        return sprintf('/admin/action-items?item=%s', $this->id);
    }

    public function report(): BelongsTo
    {
        return $this->belongsTo(Report::class);
    }

    public function department(): BelongsTo
    {
        return $this->belongsTo(Department::class);
    }

    public function assignee(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assigned_to');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function resolver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'resolved_by');
    }

    public function verifier(): BelongsTo
    {
        return $this->belongsTo(User::class, 'verified_by');
    }

    public function alertRule(): BelongsTo
    {
        return $this->belongsTo(ClinicalAlertRule::class, 'clinical_alert_rule_id');
    }

    public function history(): HasMany
    {
        return $this->hasMany(ActionItemStatusHistory::class)->latest('created_at');
    }

    public function comments(): HasMany
    {
        return $this->hasMany(ActionItemComment::class)->latest('created_at');
    }

    public function evidence(): HasMany
    {
        return $this->hasMany(ActionItemEvidence::class)->latest('created_at');
    }

    public function isOutstanding(): bool
    {
        return in_array($this->status, self::OUTSTANDING_STATUSES, true);
    }

    public function isOverdue(): bool
    {
        return $this->isOutstanding() && $this->due_at !== null && $this->due_at->isPast();
    }
}
