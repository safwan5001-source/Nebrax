<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * DLV-FOUNDATION-1 — تجاوزات الفرع **داخل** النسخة: لقطة كاملة لكل نسخة.
 *
 * التجاوز ليس إعداداً قابلاً للتعديل منفصلاً عن النسخة؛ هو صف تابع لنسخة
 * بعينها (`unique(version, branch)`)، تنسخه كل نسخة جديدة كما هو أو معدَّلاً.
 * فمعرّف نسخة مسجَّل يُحلّ دوماً لنفس الإعداد الفعلي لكل فرع.
 * `NULL` في عمود يعني «يرث من النسخة».
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('delivery_platform_version_overrides', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('delivery_platform_profile_version_id')
                ->constrained('delivery_platform_profile_versions')->restrictOnDelete();
            $table->foreignUuid('branch_id')->constrained('branches')->restrictOnDelete();
            $table->string('collection_mode', 32)->nullable();
            $table->string('external_reference_policy', 16)->nullable();
            $table->timestamp('created_at')->nullable();

            $table->unique(['delivery_platform_profile_version_id', 'branch_id'], 'dpp_overrides_version_branch_unique');
            $table->index(['tenant_id', 'branch_id'], 'dpp_overrides_tenant_branch_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('delivery_platform_version_overrides');
    }
};
