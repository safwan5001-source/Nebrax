<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * COM-MOBILE-PAYMENTS-1 (ADR-04/ADR-09) — يضيف اختيار طريقة الدفع إلى جلسة
 * Checkout المؤقتة، بنفس نمط `delivery_method`: يُملأ عبر PATCH منفصلة
 * (`checkout/payment`)، مرجعٌ خام لا لقطة — الـCheckout عابرٌ (ينتهي/يُستهلك)
 * لا سجلٌّ تاريخي، فاللقطة (`payment_method_name`) تُحفَظ لاحقاً على
 * `CommercePaymentIntent` وقت إتمام الطلب فقط، بنفس نمط `payments.
 * payment_method_name` القائم.
 *
 * `restrictOnDelete()`: يطابق قيد `payments.payment_method_id` — لا تُحذف
 * طريقة دفعٍ مرتبطة بجلسة Checkout نشطة، تُعطَّل فقط.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('commerce_checkouts', function (Blueprint $table) {
            $table->foreignUuid('payment_method_id')->nullable()->after('delivery_amount_minor')
                ->constrained('payment_methods')->restrictOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('commerce_checkouts', function (Blueprint $table) {
            $table->dropConstrainedForeignId('payment_method_id');
        });
    }
};
