<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * COM-MOBILE-SHIPPING-1 (ADR-10) — `commerce_orders.total` كان دوماً مجموع
 * سطور المنتج وحدها (`delivery_amount_minor` لم يكن له عمود على الإطلاق قبل
 * هذه الهجرة، ولا `CommerceOrderService::createFromCheckout()` يضيف شيئاً
 * غيرها إلى `$total`). عمودٌ إضافي بحت يلتقط رسم الشحن **المحسوم فعلاً على
 * Checkout وقت الإتمام** (`CommerceCheckout.delivery_amount_minor`) — مطابقٌ
 * لنمط "لقطة، لا مرجع" الذي اتّبعته `CommerceOrderSnapshot` لبيانات العنوان.
 * `default(0)`: كل طلبٍ قديم (staff/trusted، ولا Checkout له أصلاً) يبقى
 * بلا رسم شحن — سلوكه الحالي محفوظ بلا تغيير.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('commerce_orders', function (Blueprint $table) {
            $table->bigInteger('delivery_amount_minor')->default(0)->after('delivery_method');
        });
    }

    public function down(): void
    {
        Schema::table('commerce_orders', function (Blueprint $table) {
            $table->dropColumn('delivery_amount_minor');
        });
    }
};
