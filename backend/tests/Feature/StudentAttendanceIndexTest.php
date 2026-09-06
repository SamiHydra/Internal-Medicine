<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class StudentAttendanceIndexTest extends TestCase
{
    use RefreshDatabase;

    public function test_student_attendance_has_the_covering_analytics_index(): void
    {
        $index = collect(Schema::getIndexes('student_attendance'))
            ->firstWhere('name', 'student_attendance_student_present_index');

        $this->assertNotNull($index);
        $this->assertSame(['student_id', 'present'], $index['columns']);
    }
}
