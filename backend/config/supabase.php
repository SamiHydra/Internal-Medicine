<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Legacy Supabase connection (Phase 12 data migration only)
    |--------------------------------------------------------------------------
    |
    | Used by the `supabase:export` command to pull the live `public` schema
    | out of the old Supabase project via PostgREST. The service-role key
    | bypasses RLS so every row is exported. These values are NOT used by the
    | running application and should be removed/rotated once cutover is proven.
    |
    */

    'url' => env('SUPABASE_URL'),

    'service_role_key' => env('SUPABASE_SERVICE_ROLE_KEY'),

    // Where exported JSON snapshots are written / read. Contains PII + PHI,
    // so the directory is gitignored.
    'import_path' => env('SUPABASE_IMPORT_PATH', database_path('imports/supabase')),

    // PostgREST page size for paginated exports.
    'page_size' => (int) env('SUPABASE_EXPORT_PAGE_SIZE', 1000),
];
