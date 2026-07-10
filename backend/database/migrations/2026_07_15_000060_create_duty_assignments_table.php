<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // The universal dated placement for residents and consultants: rotation
        // months, section duty months, on-call days, OPD, external rotations,
        // and leave all live here. Replaces the static `users.home_ward_id`.
        // The no-overlapping-monthly rule is enforced in RosterService inside
        // the write transaction, not by a DB constraint, because daily duties
        // (on-call, Transition) legitimately stack on top of a service month.
        Schema::create('duty_assignments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->constrained('users')->restrictOnDelete();
            $table->foreignUuid('duty_type_id')->constrained('duty_types')->restrictOnDelete();
            // Both bounds inclusive.
            $table->date('starts_on');
            $table->date('ends_on');
            $table->enum('source', ['admin', 'rotation_planner', 'transfer']);
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->string('note')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'starts_on', 'ends_on']);
            $table->index(['duty_type_id', 'starts_on', 'ends_on']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('duty_assignments');
    }
};
