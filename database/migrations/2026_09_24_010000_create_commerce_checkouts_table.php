<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * COM-CHECKOUT-1A — أساس Checkout.
 *
 * جلسة إتمام شراء مؤقتة، مرتبطة صراحةً بنفس سياق Cart (tenant/storefront/
 * sales_channel) وبسلة AWJ واحدة (`cart_id`) — ليست مستنداً مالياً ولا طلباً
 * (`CommerceCheckout != CommerceOrder`, راجع AWJ_CHECKOUT_V1_ARCHITECTURE.md §4).
 * لا رقم مستند، لا إجمالي مخزَّن: مبلغ التوصيل وحده مخزَّن (سلطة الخادم فقط،
 * §5)، وبقية المبالغ تُشتقّ حيّةً من `CommerceCartService::serialize()` عند
 * كل قراءة — لا تكرار لحالة السلة هنا.
 *
 * لقطة الاتصال (`contact_*`) وعنوان التوصيل (`delivery_*`) قابلة الإدخال
 * دفعياً (progressive) عبر PATCH منفصلة، فكلّها nullable — لا partner_id
 * مطلوب لإنشاء Checkout (ضيف بالكامل، يطابق Cart).
 *
 * حقول عنوان التوصيل تطابق القائمة الدنيا في §4 من الوثيقة حرفياً (country،
 * region/state/province، city، district، street/address line، postal_code،
 * notes) — لا building_no ولا تقسيم شحن/فوترة منفصلين كما في
 * `commerce_order_snapshots`: Checkout V1 عنوان توصيل واحد فقط.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('commerce_checkouts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('storefront_id')->constrained('storefronts')->restrictOnDelete();
            $table->foreignUuid('sales_channel_id')->constrained('sales_channels')->restrictOnDelete();
            // Checkout بلا سلته لا معنى له في هذا التأسيس (لا طلب أُنشئ بعد
            // ليحفظ لقطته) — حذف السلة (لا يحدث اليوم فعلياً) يحذف Checkout معها.
            $table->foreignUuid('cart_id')->constrained('commerce_carts')->cascadeOnDelete();

            $table->enum('status', ['active', 'ready', 'completed', 'expired'])->default('active');
            $table->timestamp('expires_at');

            // لقطة اتصال الضيف — كلّها اختيارية عند الإنشاء، تُملأ عبر
            // PATCH /checkout/contact تدريجياً.
            $table->string('contact_name')->nullable();
            $table->string('contact_phone')->nullable();
            $table->string('contact_email')->nullable();

            // عنوان التوصيل — يُملأ عبر PATCH /checkout/address.
            $table->string('delivery_country')->nullable();
            $table->string('delivery_region')->nullable();
            $table->string('delivery_city')->nullable();
            $table->string('delivery_district')->nullable();
            $table->string('delivery_street')->nullable();
            $table->string('delivery_postal_code')->nullable();
            $table->text('delivery_notes')->nullable();

            // اختيار التوصيل — يُملأ عبر PATCH /checkout/delivery. المبلغ
            // سلطة خادم بحتة: صفر دائماً في هذا التأسيس (لا محرك شحن حقيقي
            // بعد — راجع CommerceCheckoutService لتوثيق القرار)، أبداً من
            // العميل.
            $table->string('delivery_method')->nullable();
            $table->unsignedBigInteger('delivery_amount_minor')->default(0);

            $table->timestamps();

            // الاستعلام الأساسي: "أعطني Checkout الحالي الصالح لهذه السلة
            // ضمن هذا السياق" — نفس تصفية Cart's context قيداً إضافياً دفاعياً
            // (لا اتكالاً وحيداً على تصفية cart's نفسها).
            $table->index(['tenant_id', 'storefront_id', 'sales_channel_id', 'cart_id', 'status'], 'commerce_checkouts_context_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('commerce_checkouts');
    }
};
