<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private const INDEX = 'student_attendance_student_present_index';

    private const FALLBACK_STUDENT_INDEX = 'student_attendance_student_id_index';

    public function up(): void
    {
        if (! $this->hasIndex(self::INDEX)) {
            Schema::table('student_attendance', function (Blueprint $table): void {
                $table->index(['student_id', 'present'], self::INDEX);
            });
        }

        if (! $this->isMariaDbOrMySql()) {
            return;
        }

        // InnoDB may retain the single-column index that was created to support
        // the student foreign key. The composite index satisfies that same
        // requirement, so remove any redundant copy explicitly.
        foreach ($this->singleColumnStudentIndexes() as $index) {
            Schema::table('student_attendance', function (Blueprint $table) use ($index): void {
                $table->dropIndex($index);
            });
        }
    }

    public function down(): void
    {
        if (! $this->hasIndex(self::INDEX)) {
            return;
        }

        if ($this->isMariaDbOrMySql() && $this->singleColumnStudentIndexes() === []) {
            // Restore a deterministic FK-supporting index before removing the
            // composite. MariaDB otherwise refuses to drop the only usable key.
            Schema::table('student_attendance', function (Blueprint $table): void {
                $table->index('student_id', self::FALLBACK_STUDENT_INDEX);
            });
        }

        Schema::table('student_attendance', function (Blueprint $table): void {
            $table->dropIndex(self::INDEX);
        });
    }

    /**
     * @return list<string>
     */
    private function singleColumnStudentIndexes(): array
    {
        return collect(Schema::getIndexes('student_attendance'))
            ->filter(fn (array $index): bool => $index['name'] !== self::INDEX
                && ($index['columns'] ?? []) === ['student_id']
                && ! ($index['unique'] ?? false)
                && ! ($index['primary'] ?? false))
            ->pluck('name')
            ->values()
            ->all();
    }

    private function hasIndex(string $name): bool
    {
        return collect(Schema::getIndexes('student_attendance'))
            ->contains(fn (array $index): bool => $index['name'] === $name);
    }

    private function isMariaDbOrMySql(): bool
    {
        return in_array(Schema::getConnection()->getDriverName(), ['mariadb', 'mysql'], true);
    }
};
