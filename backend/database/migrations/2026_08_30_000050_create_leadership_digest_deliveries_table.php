<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('leadership_digest_deliveries', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('reporting_period_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('recipient_id')->constrained('users')->cascadeOnDelete();
            $table->string('recipient_email');
            $table->timestamp('queued_at');
            $table->timestamps();

            $table->unique(
                ['reporting_period_id', 'recipient_id'],
                'leadership_digest_period_recipient_unique',
            );
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('leadership_digest_deliveries');
    }
};
