<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * CUST-HV V2b — مشتقّات التحويل لوسائط المُخصِّص (`storefront_media_derivatives`).
 *
 * إضافية بحتة (جدول جديد بلا مساس بأي جدول قائم). صفٌّ لكل ملفٍ مُشتقٍّ من
 * تحويلٍ على **الاستخدام** (قصّ/تدوير/تكبير/نقطة تركيز/ملاءمة) لا على الأصل:
 * العقد docs/plans/store/CUST-HV-V0-DECISIONS-AND-ARCHITECTURE-CONTRACT.md §7.2/§7.5.
 *
 * - `transform_key = sha256(media_id:normalized_transform:width:format)[0..32]`
 *   (يشمل `zoom` — AMEND-11)؛ `usage_key` هويّة التحويل وحدها (بلا عرضٍ/صيغة)
 *   لتجميع صفوف الاستخدام الواحد وقراءة حالته دفعةً واحدة.
 * - `width` = العرض الاسمي من السلّم (يدخل المفتاح)؛ `rendered_width/height`
 *   الأبعاد الفعلية (لا تكبير أبداً، فقد تقلّ عن الاسمي).
 * - `state` ∈ pending|ready|failed (AMEND-5). `claimed_at` عقد إيجارٍ قصير:
 *   `pending` أقدم من مدّته يُعامَل `failed(interrupted)` ويُستعاد — لا حالة
 *   عالقة دائمة (AMEND-21).
 * - `region_luminance` مكانٌ محجوز لأدلة التباين (شكلها تقرّره V5/V6 — AMEND-20).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('storefront_media_derivatives', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('media_id')->constrained('storefront_media')->cascadeOnDelete();
            $table->char('usage_key', 32);
            $table->char('transform_key', 32);
            $table->json('transform');
            $table->unsignedSmallInteger('width');
            $table->string('format', 8);
            $table->unsignedSmallInteger('rendered_width')->nullable();
            $table->unsignedSmallInteger('rendered_height')->nullable();
            $table->unsignedBigInteger('bytes')->nullable();
            // استشاري فقط (V0 §4.5.7) — محسوبٌ على البكسلات المُصيَّرة لا على الأصل.
            $table->unsignedSmallInteger('avg_luminance')->nullable();
            $table->char('dominant_colour', 7)->nullable();
            $table->json('region_luminance')->nullable();
            $table->string('storage_key', 64);
            $table->string('state', 16)->default('pending');
            $table->string('error_code', 64)->nullable();
            $table->unsignedSmallInteger('attempts')->default(0);
            $table->timestamp('claimed_at')->nullable();
            $table->timestamp('generated_at')->nullable();
            $table->timestamps();

            // لا ازدواج: استخدامان بتحويلٍ واحدٍ مطبَّع يتشاركان الصفّ (V0 §7.2).
            $table->unique(['media_id', 'transform_key', 'width', 'format'], 'sfm_derivatives_identity');
            $table->index(['tenant_id', 'media_id', 'usage_key']);
            $table->index(['tenant_id', 'state', 'claimed_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('storefront_media_derivatives');
    }
};
