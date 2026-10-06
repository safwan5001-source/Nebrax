<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * CUST-HV V2a — مكتبة وسائط المُخصِّص (`storefront_media`) على مستوى المستأجر.
 *
 * إضافية بحتة: لا تمسّ أي جدول قائم ولا تعيد كتابة أي وثيقة. العقد:
 * docs/plans/store/CUST-HV-V0-DECISIONS-AND-ARCHITECTURE-CONTRACT.md §7.2.
 *
 * `storage_key` يُخزَّن اسم الملف الأصلي فقط (`original.jpg`) — المفتاح الكامل
 * `tenant/{tenant}/storefront-media/{id}/{file}` تبنيه `R2StorageService` من
 * سياق المستأجر؛ لا مسار/قرص/دلو يظهر في أي استجابة. `variants` قائمة
 * (width/height/format/file/bytes) للسلّم الأساسي؛ مشتقات التحويل في جدول
 * مستقلّ يأتي مع V2b. `state` ∈ active|deleted|purged؛ الحذف الناعم عمود لا
 * SoftDeletes كي لا يتسلّل نطاقٌ عام يُخفي الصفوف عن المصالِح.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('storefront_media', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('kind', 16)->default('image');
            $table->string('original_name', 255);
            $table->string('mime', 32);
            $table->unsignedBigInteger('size');
            $table->char('sha256', 64);
            $table->unsignedInteger('width');
            $table->unsignedInteger('height');
            // استشاري فقط (V0 §4.5.7): 0–255 — لا يُستخدم كدليل تباين أبداً.
            $table->unsignedSmallInteger('avg_luminance')->nullable();
            $table->char('dominant_colour', 7)->nullable();
            // مكان محجوز: شكل أدلة التباين تقرّره V5/V6 (AMEND-20).
            $table->json('region_luminance')->nullable();
            $table->string('alt_ar', 300)->nullable();
            $table->string('alt_en', 300)->nullable();
            $table->string('storage_key', 64);
            $table->json('variants')->nullable();
            // pending | ready | failed (AMEND-5)
            $table->string('variants_state', 16)->default('pending');
            // رمز ثابت قابل للترجمة في الواجهة عند failed.
            $table->string('variants_error', 64)->nullable();
            $table->string('state', 16)->default('active');
            $table->timestamp('deleted_at')->nullable();
            $table->timestamp('purge_after')->nullable();
            $table->uuid('uploaded_by')->nullable();
            $table->timestamps();

            $table->index(['tenant_id', 'state', 'created_at']);
            $table->index(['tenant_id', 'sha256']);
            $table->index(['state', 'purge_after']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('storefront_media');
    }
};
