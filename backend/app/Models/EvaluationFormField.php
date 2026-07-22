<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class EvaluationFormField extends Model
{
    use HasUuids;

    protected $fillable = [
        'form_id',
        'section',
        'key',
        'label',
        'help_text',
        'type',
        'options',
        'required',
        'sort_order',
        'active',
        'is_core',
    ];

    protected function casts(): array
    {
        return [
            'options' => 'array',
            'required' => 'boolean',
            'sort_order' => 'integer',
            'active' => 'boolean',
            'is_core' => 'boolean',
        ];
    }

    public function form(): BelongsTo
    {
        return $this->belongsTo(EvaluationForm::class, 'form_id');
    }

    /**
     * Allowed values for select fields, from options.choices[].value.
     *
     * @return list<string>
     */
    public function choiceValues(): array
    {
        return array_values(array_map(
            fn (array $choice) => (string) $choice['value'],
            $this->options['choices'] ?? [],
        ));
    }
}
