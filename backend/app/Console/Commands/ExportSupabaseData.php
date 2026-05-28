<?php

namespace App\Console\Commands;

use App\Support\Migration\SupabaseSchemaMap;
use Illuminate\Console\Command;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Http;

class ExportSupabaseData extends Command
{
    protected $signature = 'supabase:export
        {--table= : Export only this source table}';

    protected $description = 'Export the legacy Supabase public schema to JSON snapshots (Phase 12 migration).';

    public function handle(): int
    {
        $url = rtrim((string) config('supabase.url'), '/');
        $key = (string) config('supabase.service_role_key');

        if ($url === '' || $key === '') {
            $this->error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the backend .env before exporting.');

            return self::FAILURE;
        }

        $importPath = (string) config('supabase.import_path');
        File::ensureDirectoryExists($importPath);

        $only = $this->option('table');
        $manifest = [
            'exported_at' => now()->toIso8601String(),
            'source' => parse_url($url, PHP_URL_HOST),
            'tables' => [],
        ];

        foreach (SupabaseSchemaMap::tables() as $target => $spec) {
            $sourceTable = SupabaseSchemaMap::sourceTable($target, $spec);

            if ($only !== null && $only !== $sourceTable && $only !== $target) {
                continue;
            }

            $this->line("Exporting <info>{$sourceTable}</info> ...");

            $rows = $this->fetchAll($url, $key, $sourceTable, $spec['key']);
            if ($rows === null) {
                return self::FAILURE;
            }

            $file = $importPath.DIRECTORY_SEPARATOR.$sourceTable.'.json';
            File::put($file, json_encode($rows, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            $manifest['tables'][$sourceTable] = count($rows);
            $this->line("  → {$file} (".count($rows).' rows)');
        }

        File::put(
            $importPath.DIRECTORY_SEPARATOR.'_manifest.json',
            json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES),
        );

        $this->newLine();
        $this->info('Export complete. Snapshots written to: '.$importPath);
        $this->warn('These files contain PII/PHI. They are gitignored — do not commit or share them.');

        return self::SUCCESS;
    }

    /**
     * Fetch every row of a table via PostgREST, paginating until exhausted.
     *
     * @return list<array<string, mixed>>|null null on HTTP failure
     */
    private function fetchAll(string $url, string $key, string $table, string $orderBy): ?array
    {
        $pageSize = max(1, (int) config('supabase.page_size'));
        $offset = 0;
        $all = [];

        do {
            $response = $this->client($key)
                ->get("{$url}/rest/v1/{$table}", [
                    'select' => '*',
                    'order' => $orderBy,
                    'limit' => $pageSize,
                    'offset' => $offset,
                ]);

            if ($response->failed()) {
                $this->error("  Failed to fetch {$table}: HTTP {$response->status()} {$response->body()}");

                return null;
            }

            $page = $response->json();
            if (! is_array($page)) {
                $this->error("  Unexpected response for {$table}.");

                return null;
            }

            $all = array_merge($all, $page);
            $offset += $pageSize;
        } while (count($page) === $pageSize);

        return $all;
    }

    private function client(string $key): PendingRequest
    {
        return Http::withHeaders([
            'apikey' => $key,
            'Authorization' => 'Bearer '.$key,
            'Accept' => 'application/json',
        ])->acceptJson()->timeout(120);
    }
}
