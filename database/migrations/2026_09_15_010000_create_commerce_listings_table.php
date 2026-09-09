<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * PR-COM-3 — عرض تجاري Commerce (Master Plan §PHASE 3): يفصل حقيقة المنتج
 * الأساسية (`Product` — SKU/باركود/وحدة/تكلفة/محاسبة) عن عرضه ونشره التجاري
 * حسب قناة بيع. جدولٌ إضافي بحت — لا `products` ولا `sales_channels` يتغيّران.
 *
 * `unique(['product_id', 'sales_channel_id'])`: **صفر أو عرض واحد** لكل زوج
 * منتج×قناة — نفس منتج قد يُعرض في قناة ولا يُعرض في أخرى، بعرضٍ مختلف لكل
 * قناة، لا سجلّاً عالمياً واحداً (نفس منطق `fulfillment_policies` مع قناة
 * التنفيذ، لكن هنا البُعد الآخر منتجٌ لا مخزن).
 *
 * `title`/`description` **اختياريان صراحةً بلا نسخ من المنتج عند الإنشاء**:
 * `null` يعني «استخدم عرض المنتج الافتراضي» (`CommerceListing::displayTitle()`/
 * `displayDescription()` يحسمان ذلك عند القراءة) — لا ازدواج حقيقة. حقيقة
 * السعر/الضريبة/المخزون/التنفيذ لا تعيش هنا إطلاقاً (PR-COM-4A/تنفيذ لاحقان).
 *
 * الحذف: `product_id` → `restrictOnDelete()` **بنفس اختيار
 * `price_list_items.product_id` حرفياً** — هذا عرضٌ تجاري حيّ (مثل بند
 * تسعير)، لا سجلّ تدقيق ولا هوية مخزون؛ حذف منتجٍ صامتاً بينما هو معروضٌ
 * فعلياً على قناة يكسر تهيئة حيّة. `sales_channel_id` → `cascadeOnDelete()`
 * بنفس اختيار `fulfillment_policies.sales_channel_id` (COM-2B): عرضٌ يشير
 * إلى قناة محذوفة فعلياً بلا معنى.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('commerce_listings', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('sales_channel_id')->constrained('sales_channels')->cascadeOnDelete();

            // تجاوزات عرض اختيارية — null = عرض المنتج الافتراضي (لا نسخ عند الإنشاء).
            $table->string('title')->nullable();
            $table->text('description')->nullable();

            $table->boolean('is_published')->default(false);
            $table->timestamps();

            $table->unique(['product_id', 'sales_channel_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('commerce_listings');
    }
};
