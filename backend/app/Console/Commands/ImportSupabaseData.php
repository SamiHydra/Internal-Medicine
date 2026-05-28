<?php

namespace App\Console\Commands;

use App\Support\Migration\SupabaseSchemaMap;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;

class ImportSupabaseData extends Command
{
    protected $signature = 'supabase:import
        {--dry-run : Parse snapshots and report counts without writing}
        {--truncate : Delete existing rows in the imported tables first (clean slate)}
        {--skip-reference : Skip reference tables (roles, templates, departments, field defs, periods, settings)}
        {--only= : Comma-separated list of tables to import (target or source names)}';

    protected $description = 'Import exported Supabase JSON snapshots into the Laravel database (Phase 12 migration).';

    public function handle(): int
    {
        $importPath = (string) config('supabase.import_path');

        if (! File::isDirectory($importPath)) {
            $this->error("Import directory not found: {$importPath}. Run `php artisan supabase:export` first.");

            return self::FAILURE;
        }

        $working = $this->workingSet();
        if ($working === []) {
            $this->error('No tables selected for import.');

            return self::FAILURE;
        }

        $dryRun = (bool) $this->option('dry-run');

        // Load + transform every snapshot up front so a bad file fails fast,
        // before we touch the database.
        $prepared = [];
        foreach ($working as $target => $spec) {
            $sourceTable = SupabaseSchemaMap::sourceTable($target, $spec);
            $file = $importPath.DIRECTORY_SEPARATOR.$sourceTable.'.json';

            if (! File::exists($file)) {
                $this->error("Missing snapshot for `{$sourceTable}`: {$file}");

                return self::FAILURE;
            }

            $sourceRows = json_decode(File::get($file), true);
            if (! is_array($sourceRows)) {
                $this->error("Could not parse JSON snapshot: {$file}");

                return self::FAILURE;
            }

            $prepared[$target] = [
                'spec' => $spec,
                'sourceCount' => count($sourceRows),
                'rows' => array_map(fn (array $row) => $this->transformRow($row, $spec), $sourceRows),
            ];
        }

        if ($dryRun) {
            $this->renderDryRun($prepared);

            return self::SUCCESS;
        }

        DB::transaction(function () use ($working, $prepared): void {
            if ($this->option('truncate')) {
                foreach (array_reverse($working, true) as $target => $spec) {
                    DB::table($target)->delete();
                }
                $this->line('Cleared existing rows in imported tables.');
            }

            foreach ($prepared as $target => $bundle) {
                $spec = $bundle['spec'];
                $rows = $bundle['rows'];

                if ($rows === []) {
                    continue;
                }

                $updateColumns = SupabaseSchemaMap::updateColumns($spec);
                foreach (array_chunk($rows, 500) as $chunk) {
                    DB::table($target)->upsert($chunk, [$spec['key']], $updateColumns);
                }
            }
        });

        return $this->renderResult($prepared);
    }

    /**
     * @return array<string, array<string, mixed>>
     */
    private function workingSet(): array
    {
        $skipReference = (bool) $this->option('skip-reference');
        $only = $this->option('only');
        $onlyList = $only !== null
            ? array_filter(array_map('trim', explode(',', $only)))
            : null;

        $working = [];
        foreach (SupabaseSchemaMap::tables() as $target => $spec) {
            if ($skipReference && ($spec['reference'] ?? false)) {
                continue;
            }

            if ($onlyList !== null) {
                $sourceTable = SupabaseSchemaMap::sourceTable($target, $spec);
                if (! in_array($target, $onlyList, true) && ! in_array($sourceTable, $onlyList, true)) {
                    continue;
                }
            }

            $working[$target] = $spec;
        }

        return $working;
    }

    /**
     * @param  array<string, mixed>  $sourceRow
     * @param  array<string, mixed>  $spec
     * @return array<string, mixed>
     */
    private function transformRow(array $sourceRow, array $spec): array
    {
        $generate = $spec['generate'] ?? [];
        $coerce = $spec['coerce'] ?? [];
        $row = [];

        foreach ($spec['columns'] as $column) {
            $raw = isset($generate[$column])
                ? $generate[$column]($sourceRow)
                : ($sourceRow[$column] ?? null);

            $row[$column] = $this->coerce($raw, $coerce[$column] ?? null);
        }

        return $row;
    }

    private function coerce(mixed $value, ?string $type): mixed
    {
        if ($type === null) {
            return $value;
        }

        if ($type === 'bool') {
            return $value === null ? null : ((bool) $value ? 1 : 0);
        }

        if ($value === null || $value === '') {
            return null;
        }

        return match ($type) {
            'datetime' => Carbon::parse($value)->utc()->format('Y-m-d H:i:s'),
            'date' => Carbon::parse($value)->format('Y-m-d'),
            'time' => Carbon::parse($value)->format('H:i:s'),
            'json' => json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            default => $value,
        };
    }

    /**
     * @param  array<string, array<string, mixed>>  $prepared
     */
    private function renderDryRun(array $prepared): void
    {
        $rows = [];
        $total = 0;
        foreach ($prepared as $target => $bundle) {
            $rows[] = [$target, $bundle['sourceCount']];
            $total += $bundle['sourceCount'];
        }

        $this->info('DRY RUN — no data was written.');
        $this->table(['Table', 'Rows to import'], $rows);
        $this->line("Total rows across {$this->countLabel($prepared)}: {$total}");
    }

    /**
     * @param  array<string, array<string, mixed>>  $prepared
     */
    private function renderResult(array $prepared): int
    {
        $rows = [];
        $mismatch = false;

        foreach ($prepared as $target => $bundle) {
            $source = $bundle['sourceCount'];
            $actual = DB::table($target)->count();
            $ok = $actual >= $source;
            $mismatch = $mismatch || ! $ok;
            $rows[] = [$target, $source, $actual, $ok ? 'OK' : 'MISMATCH'];
        }

        $this->info('Import complete.');
        $this->table(['Table', 'Source rows', 'Target rows', 'Status'], $rows);

        if ($mismatch) {
            $this->warn('Some target tables have fewer rows than the source snapshot. Investigate before cutover.');

            return self::FAILURE;
        }

        $this->line('All imported tables match or exceed source row counts.');

        return self::SUCCESS;
    }

    private function countLabel(array $prepared): string
    {
        $n = count($prepared);

        return $n.' '.($n === 1 ? 'table' : 'tables');
    }
}
