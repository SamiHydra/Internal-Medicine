<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Consultant section-transfer workflow. Decided by the HEAD of the
        // destination section (a data-driven designation, not a role) or an
        // admin. Applied at a rotation boundary by the daily scheduled command
        // unless an admin overrides to immediate.
        Schema::create('transfer_requests', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->constrained('users')->restrictOnDelete();
            $table->foreignUuid('from_section_id')->constrained('sections')->restrictOnDelete();
            $table->foreignUuid('to_section_id')->constrained('sections')->restrictOnDelete();
            $table->text('reason')->nullable();
            $table->enum('status', ['pending', 'approved', 'rejected', 'cancelled'])->default('pending');
            $table->foreignUuid('decided_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('decided_at')->nullable();
            $table->date('effective_on')->nullable();
            $table->timestamp('applied_at')->nullable();
            $table->timestamps();

            $table->index(['status', 'effective_on']);
            $table->index('user_id');
            $table->index('to_section_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('transfer_requests');
    }
};
