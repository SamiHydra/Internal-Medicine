<?php

namespace Database\Seeders;

use App\Models\ReportFieldDefinition;
use App\Models\ReportTemplate;
use Illuminate\Database\Seeder;

/**
 * Backfills the presentation/UI metadata that historically lived only in the
 * frontend config (src/config/templates.ts, exported to
 * database/data/templates-config.json) into the existing JSON metadata columns:
 *  - report_templates.metadata.presentation = { sections, summaryCards, chartMappings }
 *  - report_field_definitions.metadata += { unit, highlightWhenNonZero, readOnlyWeeklyTotal, options, description }
 *
 * Idempotent and edit-safe: it only ADDS missing keys, never overwrites a
 * presentation block or field flag an admin may have already edited. Runs after
 * ReportTemplateSeeder + ReportFieldDefinitionSeeder (rows must exist first).
 */
class BackfillTemplatePresentationSeeder extends Seeder
{
    private const FIELD_FLAGS = ['unit', 'highlightWhenNonZero', 'readOnlyWeeklyTotal', 'options', 'description'];

    public function run(): void
    {
        $path = database_path('data/templates-config.json');

        if (! is_file($path)) {
            $this->command?->warn('templates-config.json not found; skipping template presentation backfill.');

            return;
        }

        $config = json_decode((string) file_get_contents($path), true);
        $templates = is_array($config['templates'] ?? null) ? $config['templates'] : [];

        $templatesTouched = 0;
        $fieldsTouched = 0;

        foreach ($templates as $tpl) {
            $slug = $tpl['id'] ?? null;
            if (! $slug) {
                continue;
            }

            $template = ReportTemplate::query()->where('slug', $slug)->first();
            if (! $template) {
                continue;
            }

            $metadata = $template->metadata ?? [];
            if (! array_key_exists('presentation', $metadata)) {
                $metadata['presentation'] = [
                    'sections' => $tpl['sections'] ?? [],
                    'summaryCards' => $tpl['summaryCards'] ?? [],
                    'chartMappings' => $tpl['chartMappings'] ?? [],
                ];
                $template->forceFill(['metadata' => $metadata])->save();
                $templatesTouched++;
            }

            $fieldConfigByKey = [];
            foreach (($tpl['fields'] ?? []) as $field) {
                if (isset($field['id'])) {
                    $fieldConfigByKey[$field['id']] = $field;
                }
            }

            $definitions = ReportFieldDefinition::query()->where('template_id', $template->id)->get();
            foreach ($definitions as $definition) {
                $fieldConfig = $fieldConfigByKey[$definition->field_key] ?? null;
                if (! $fieldConfig) {
                    continue;
                }

                $meta = $definition->metadata ?? [];
                $changed = false;
                foreach (self::FIELD_FLAGS as $flag) {
                    if (array_key_exists($flag, $fieldConfig) && ! array_key_exists($flag, $meta)) {
                        $meta[$flag] = $fieldConfig[$flag];
                        $changed = true;
                    }
                }

                if ($changed) {
                    $definition->forceFill(['metadata' => $meta])->save();
                    $fieldsTouched++;
                }
            }
        }

        $this->command?->info(sprintf(
            'Template presentation backfill: %d templates, %d fields enriched from config.',
            $templatesTouched,
            $fieldsTouched,
        ));
    }
}
