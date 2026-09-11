<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * COM-7-P2A — متجر Commerce مستضاف (Storefront)، منفصل عن `SalesChannel`
 * (AWJ_COM_7_P2_STOREFRONT_DOMAIN_RESOLUTION_DECISION.md §1-2). جدولٌ إضافي
 * بحت — لا `sales_channels` ولا أي جدول قائم يتغيّر.
 *
 * `sales_channel_id`: يشير حصراً إلى قناة `type = web` تابعة لنفس المستأجر —
 * يفرضه `Storefront::booted()` صراحةً (لا FK وحده)، لا هذا الترحيل.
 *
 * لا حقول علامة تجارية/قالب/SEO هنا عمداً (القرار §2) — تلك أعمدة عمل
 * Store Configuration/Design لاحقة، خارج نطاق هذا الجدول صراحةً.
 *
 * `unique(tenant_id, slug)` حرفياً كما في العقد المعتمد — بلا فهرس جزئي
 * يستثني المحذوف ناعماً (خلافاً لـ`products.sku`)، فإعادة استخدام سلاجٍ
 * لمتجر محذوف قرارٌ منتجي لاحق، لا افتراضٌ يُختلق هنا.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('storefronts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('sales_channel_id')->constrained('sales_channels')->cascadeOnDelete();
            $table->string('slug');
            $table->string('name');
            $table->boolean('is_active')->default(true);
            $table->string('default_locale', 10)->default('ar');
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['tenant_id', 'slug']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('storefronts');
    }
};
