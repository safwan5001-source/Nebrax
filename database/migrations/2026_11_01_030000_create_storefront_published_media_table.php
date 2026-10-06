<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * CUST-HV V2c — مجموعة «الوسائط المنشورة» المُطبَّعة (V0 §7.8): معرّفات الوسائط
 * التي تشير إليها **الوثيقة المنشورة** لكل متجر، تُعاد بناؤها عند كل كتابةٍ
 * لـ`published_config` فيقرأ مسار التسليم العام صفّاً بفهرسٍ لا يفكّ JSON لكل
 * طلب. إضافية بحتة؛ لا تمسّ أي جدول قائم، ولا بياناتٍ قائمة تحتاج ترحيلاً (لا
 * وثيقة منشورة حالية تحمل `mediaId`؛ حقول الوسائط في الوثيقة تصل مع V4–V9).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('storefront_published_media', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('storefront_id')->constrained()->cascadeOnDelete();
            $table->uuid('media_id');
            $table->timestamps();

            $table->unique(['storefront_id', 'media_id']);
            $table->index(['tenant_id', 'media_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('storefront_published_media');
    }
};
