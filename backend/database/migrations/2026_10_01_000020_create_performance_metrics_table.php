<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('performance_metrics', function (Blueprint $table): void {
            $table->id();
            $table->foreignUuid('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('metric', 24);
            $table->decimal('value', 12, 3);
            $table->string('route_name', 120);
            $table->string('device_class', 12);
            $table->string('release_sha', 64)->nullable();
            $table->timestamp('created_at');

            $table->index('created_at');
            $table->index(['metric', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('performance_metrics');
    }
};
