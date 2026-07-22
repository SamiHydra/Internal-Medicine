<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * One author may evaluate one subject once per date per form. Without
     * that key a resident can POST the same consultant evaluation N times and
     * cast N votes: every analytics aggregate is a per-row mean, so each
     * repeat re-weights the subject's score by a full vote.
     *
     * Subject is nullable in two different columns (a user or a student), and
     * both engines ignore NULLs in a unique index, so the key is built on a
     * generated discriminator instead. External entries (author_id NULL) stay
     * outside the key by design: they carry no authenticated author to
     * de-duplicate against, and the entering clerk is already audited.
     */
    public function up(): void
    {
        $this->collapseDuplicates();

        Schema::table('evaluations', function (Blueprint $table) {
            $table->string('subject_ref', 36)
                ->nullable()
                ->virtualAs('coalesce(subject_user_id, subject_student_id)');

            $table->unique(
                ['author_id', 'subject_ref', 'evaluation_date', 'form_key'],
                'evaluations_author_subject_date_form_unique',
            );
        });
    }

    public function down(): void
    {
        Schema::table('evaluations', function (Blueprint $table) {
            $table->dropUnique('evaluations_author_subject_date_form_unique');
            $table->dropColumn('subject_ref');
        });
    }

    /**
     * Seeded and pre-guard installs already carry repeats, so the key cannot
     * simply be added. The FIRST submission of each group is kept because
     * that is the one the new service guard would have accepted; the later
     * repeats are the accidental extra votes. evaluation_answers cascade.
     *
     * These are clinical records and down() cannot bring them back, so every
     * doomed row and its answers are written to a JSON archive under
     * storage/app first and the operator is told what happened. `migrate
     * --pretend` never reaches this code (Connection::select() returns []),
     * which is exactly why the count has to be printed at run time.
     */
    private function collapseDuplicates(): void
    {
        $groups = DB::table('evaluations')
            ->selectRaw('author_id, coalesce(subject_user_id, subject_student_id) as subject_ref, evaluation_date, form_key')
            ->selectRaw('count(*) as row_count')
            ->whereNotNull('author_id')
            ->groupBy('author_id', 'subject_ref', 'evaluation_date', 'form_key')
            ->havingRaw('count(*) > 1')
            ->get();

        if ($groups->isEmpty()) {
            return;
        }

        $archive = [];
        $doomedIds = [];

        foreach ($groups as $group) {
            $ids = DB::table('evaluations')
                ->where('author_id', $group->author_id)
                ->whereRaw('coalesce(subject_user_id, subject_student_id) = ?', [$group->subject_ref])
                ->where('evaluation_date', $group->evaluation_date)
                ->where('form_key', $group->form_key)
                ->orderBy('created_at')
                ->orderBy('id')
                ->pluck('id');

            $doomed = $ids->slice(1)->values();

            if ($doomed->isEmpty()) {
                continue;
            }

            $archive[] = [
                'kept_evaluation_id' => $ids->first(),
                'evaluations' => DB::table('evaluations')->whereIn('id', $doomed)->get()->all(),
                'evaluation_answers' => DB::table('evaluation_answers')->whereIn('evaluation_id', $doomed)->get()->all(),
            ];

            $doomedIds = array_merge($doomedIds, $doomed->all());
        }

        if ($archive === []) {
            return;
        }

        // Archive BEFORE deleting: if the file cannot be written the migration
        // aborts with the rows still in place, which is the safe direction.
        $path = $this->writeArchive($archive);

        DB::table('evaluations')->whereIn('id', $doomedIds)->delete();

        $this->announce(sprintf(
            'Collapsed %d duplicate evaluation row(s) across %d group(s). Archived to %s',
            count($doomedIds),
            count($archive),
            $path,
        ));
    }

    /**
     * @param  list<array<string, mixed>>  $archive
     */
    private function writeArchive(array $archive): string
    {
        $path = storage_path('app/evaluation-duplicate-archive-'.date('Ymd-His').'.json');

        File::ensureDirectoryExists(dirname($path));
        File::put($path, json_encode($archive, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

        return $path;
    }

    /**
     * Destroying clinical records must never be a silent side effect of a
     * deploy, so say so on the console the operator is watching as well as in
     * the log the upgrade leaves behind.
     */
    private function announce(string $message): void
    {
        if (PHP_SAPI === 'cli') {
            fwrite(STDOUT, $message.PHP_EOL);
        }

        Log::warning($message);
    }
};
