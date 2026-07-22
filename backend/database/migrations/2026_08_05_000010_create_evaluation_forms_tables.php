<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The admin-editable evaluation form engine (V2 Phase 4). Content edits
     * (labels, help text, order, option wording) apply to the published
     * version in place; structural edits (add/remove field, change key or
     * type) create a new version, so past evaluations always render against
     * the version they were answered on.
     */
    public function up(): void
    {
        Schema::create('evaluation_forms', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('key', 64);
            $table->string('name');
            $table->enum('target', ['consultant', 'resident', 'student']);
            $table->unsignedInteger('version');
            $table->enum('status', ['draft', 'published', 'archived'])->default('draft');
            $table->timestamp('published_at')->nullable();
            $table->timestamps();

            $table->unique(['key', 'version']);
        });

        Schema::create('evaluation_form_fields', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('form_id')->constrained('evaluation_forms')->cascadeOnDelete();
            $table->string('section', 120);
            $table->string('key', 64);
            $table->string('label');
            $table->string('help_text')->nullable();
            $table->enum('type', ['boolean', 'rating', 'percent', 'integer', 'time', 'text', 'single_select', 'multi_select']);
            $table->json('options')->nullable();
            $table->boolean('required')->default(false);
            $table->integer('sort_order')->default(0);
            $table->boolean('active')->default(true);
            // Core fields cannot be removed or type-changed by anyone: the
            // accountability analytics depend on them.
            $table->boolean('is_core')->default(false);
            $table->timestamps();

            $table->unique(['form_id', 'key']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('evaluation_form_fields');
        Schema::dropIfExists('evaluation_forms');
    }
};
