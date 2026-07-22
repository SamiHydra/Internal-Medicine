<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    private const INSERT_TRIGGER = 'evaluations_enforce_sources_insert';

    private const UPDATE_TRIGGER = 'evaluations_enforce_sources_update';

    public function up(): void
    {
        $invalidRows = DB::table('evaluations')
            ->where(function ($query): void {
                $query
                    ->whereRaw('(subject_user_id IS NULL AND subject_student_id IS NULL)')
                    ->orWhereRaw('(subject_user_id IS NOT NULL AND subject_student_id IS NOT NULL)')
                    ->orWhereRaw("(author_id IS NULL AND (external_evaluator_name IS NULL OR TRIM(external_evaluator_name) = ''))")
                    ->orWhereRaw("(author_id IS NOT NULL AND external_evaluator_name IS NOT NULL AND TRIM(external_evaluator_name) <> '')");
            })
            ->count();

        if ($invalidRows > 0) {
            throw new RuntimeException("Cannot enforce evaluation header invariants: {$invalidRows} existing row(s) are invalid.");
        }

        $driver = DB::connection()->getDriverName();

        if ($driver === 'sqlite') {
            DB::unprepared('DROP TRIGGER IF EXISTS '.self::INSERT_TRIGGER);
            DB::unprepared('DROP TRIGGER IF EXISTS '.self::UPDATE_TRIGGER);
            $this->createSqliteTriggers();

            return;
        }

        if (in_array($driver, ['mysql', 'mariadb'], true)) {
            DB::unprepared('DROP TRIGGER IF EXISTS `'.self::INSERT_TRIGGER.'`');
            DB::unprepared('DROP TRIGGER IF EXISTS `'.self::UPDATE_TRIGGER.'`');
            $this->createMysqlTriggers();

            return;
        }

        throw new RuntimeException("Evaluation invariant triggers are not implemented for the {$driver} database driver.");
    }

    public function down(): void
    {
        $driver = DB::connection()->getDriverName();

        if ($driver === 'sqlite') {
            DB::unprepared('DROP TRIGGER IF EXISTS '.self::INSERT_TRIGGER);
            DB::unprepared('DROP TRIGGER IF EXISTS '.self::UPDATE_TRIGGER);

            return;
        }

        if (in_array($driver, ['mysql', 'mariadb'], true)) {
            DB::unprepared('DROP TRIGGER IF EXISTS `'.self::INSERT_TRIGGER.'`');
            DB::unprepared('DROP TRIGGER IF EXISTS `'.self::UPDATE_TRIGGER.'`');
        }
    }

    private function createSqliteTriggers(): void
    {
        $condition = <<<'SQL'
            ((NEW.subject_user_id IS NULL) = (NEW.subject_student_id IS NULL))
            OR
            ((NEW.author_id IS NULL) = (NEW.external_evaluator_name IS NULL OR TRIM(NEW.external_evaluator_name) = ''))
        SQL;

        foreach (['INSERT' => self::INSERT_TRIGGER, 'UPDATE' => self::UPDATE_TRIGGER] as $operation => $name) {
            DB::unprepared(<<<SQL
                CREATE TRIGGER {$name}
                BEFORE {$operation} ON evaluations
                FOR EACH ROW
                WHEN {$condition}
                BEGIN
                    SELECT RAISE(ABORT, 'An evaluation must have exactly one subject and exactly one evaluator source.');
                END
            SQL);
        }
    }

    private function createMysqlTriggers(): void
    {
        $condition = <<<'SQL'
            ((NEW.subject_user_id IS NULL) = (NEW.subject_student_id IS NULL))
            OR
            ((NEW.author_id IS NULL) = (NEW.external_evaluator_name IS NULL OR TRIM(NEW.external_evaluator_name) = ''))
        SQL;

        foreach (['INSERT' => self::INSERT_TRIGGER, 'UPDATE' => self::UPDATE_TRIGGER] as $operation => $name) {
            DB::unprepared(<<<SQL
                CREATE TRIGGER `{$name}`
                BEFORE {$operation} ON `evaluations`
                FOR EACH ROW
                BEGIN
                    IF {$condition} THEN
                        SIGNAL SQLSTATE '45000'
                            SET MESSAGE_TEXT = 'An evaluation must have exactly one subject and exactly one evaluator source.';
                    END IF;
                END
            SQL);
        }
    }
};
