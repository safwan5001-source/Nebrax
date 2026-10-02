<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * DLV-FOUNDATION-1 — نسخ تكوين ملف المنصة: إلحاقية ثابتة (لا تحديث ولا حذف).
 *
 * كل تعديل (سياسة تحصيل، سياسة مرجع خارجي، أسماء العرض، التفعيل، أو تجاوز
 * فرع) ينتج صفاً جديداً بـ`version_number` أعلى. معرّف النسخة هو المرجع الذي
 * ستثبّته المستندات اللاحقة؛ ولا يتغيّر معناه بعد ذلك.
 *
 * `collection_mode` بيانات فقط: لا يُشغّل أي ترحيل أو توجيه في هذه المهمة.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('delivery_platform_profile_versions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('delivery_platform_profile_id')
                ->constrained('delivery_platform_profiles')->restrictOnDelete();
            $table->unsignedInteger('version_number');
            $table->string('collection_mode', 32);
            $table->string('external_reference_policy', 16);
            $table->string('display_name');
            $table->string('display_name_en')->nullable();
            $table->string('logo_asset_key')->nullable();
            $table->boolean('is_active');
            $table->string('change_reason', 500)->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            // دقة ميكروثانية: نسختان في الثانية نفسها تبقيان مرتَّبتين زمنياً (نظير product_activities).
            $table->timestamp('effective_from', 6);
            $table->timestamp('created_at', 6)->nullable();

            $table->unique(['delivery_platform_profile_id', 'version_number'], 'dpp_versions_profile_number_unique');
            $table->index(['tenant_id', 'delivery_platform_profile_id', 'effective_from'], 'dpp_versions_profile_effective_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('delivery_platform_profile_versions');
    }
};
