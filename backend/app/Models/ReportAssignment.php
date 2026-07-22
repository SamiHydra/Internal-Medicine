<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ReportAssignment extends Model
{
    use HasUuids;

    protected $fillable = [
        'nurse_id', 'department_id', 'template_id',
        'active', 'approved_at', 'approved_by',
    ];

    protected function casts(): array
    {
        return [
            'active' => 'boolean',
            'approved_at' => 'datetime',
        ];
    }

    public function nurse(): BelongsTo
    {
        return $this->belongsTo(User::class, 'nurse_id');
    }

    public function approver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approved_by');
    }

    public function department(): BelongsTo
    {
        return $this->belongsTo(Department::class);
    }

    public function template(): BelongsTo
    {
        return $this->belongsTo(ReportTemplate::class, 'template_id');
    }

    public function reports(): HasMany
    {
        return $this->hasMany(Report::class, 'assignment_id');
    }
}
