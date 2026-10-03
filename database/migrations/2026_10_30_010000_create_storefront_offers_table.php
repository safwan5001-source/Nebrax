<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * CUST-H4-6 / H4-ARCH-1 §23.3 — مصدر «العروض» الحقيقي للمتجر: **تنسيق وجدولة
 * فقط**. الجدول يقول «اعتبر هذا المنتج لقسم العروض ضمن هذه النافذة» ولا شيء
 * غير ذلك — لا سعر ولا نسبة خصم ولا سعر أصلي ولا ضريبة ولا هامش ولا مخزون ولا
 * وفر محسوب، وبنيوياً **لا يستطيع** التعبير عن خصم: الخصم الحقيقي يُقرأ وقت
 * العرض من `CommercePriceResolver` وحده (سلطة التسعير القائمة)، فلا يمكن لتاجر
 * ولا لعميل مخترَق كتابة خصم مُختلَق عبر هذا الجدول.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('storefront_offers', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('storefront_id')->constrained('storefronts')->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained('products')->cascadeOnDelete();
            // UTC دائماً (نفس معيار بقية الأعمدة الزمنية في Commerce) — لا توقيت محلي للمستأجر.
            $table->timestamp('starts_at')->nullable();
            $table->timestamp('ends_at')->nullable();
            $table->boolean('is_active')->default(true);
            $table->unsignedSmallInteger('position')->default(0);
            $table->timestamps();

            // صفّ تهيئة واحد لكل (متجر، منتج): التكرار يُرفض صراحةً (409) لا يُدمج صامتاً.
            $table->unique(['storefront_id', 'product_id'], 'storefront_offers_storefront_product_unique');
            // القراءة العامة/الاستعراض: متجرٌ ← فعّال ← ترتيب حتمي.
            $table->index(['storefront_id', 'is_active', 'position'], 'storefront_offers_storefront_active_position');
            $table->index('tenant_id');
            $table->index('product_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('storefront_offers');
    }
};
