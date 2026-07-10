<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class EvaluationAnswer extends Model
{
    use HasUuids;

    protected $fillable = [
        'evaluation_id',
        'field_key',
        'value',
    ];

    protected function casts(): array
    {
        return [
            // Answers are stored as JSON so one column carries booleans,
            // integers, times, text, and multi-select arrays alike.
            'value' => 'json',
        ];
    }

    public function evaluation(): BelongsTo
    {
        return $this->belongsTo(Evaluation::class, 'evaluation_id');
    }
}
