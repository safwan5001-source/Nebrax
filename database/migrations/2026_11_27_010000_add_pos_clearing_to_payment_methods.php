<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * AWJ-PAYMENTS-HZ-01 / PAY-H6-01 (قرار D-09 — الخيار 1، اعتمده المالك) — مقاصة بطاقات POS اختيارية لكل طريقة دفع.
 *
 * - `payment_methods.pos_clearing_gateway_id` (NULL = مطفأ، وهو الافتراضي لكل المستأجرين الحاليين والجدد): طريقة بنكية مرتبطة باتصال
 *   مستحوذ ⇒ سند قبض POS بها يرحَّل A12 (مدين 1170 مقاصة / دائن 1130) بدل A11 (مدين بنك الطريقة / دائن 1130)، عبر `PaymentService` القائم.
 *   لا يمسّ سنداً مرحَّلاً سابقاً (السند يلتقط اتصاله وقت إنشائه). FK بلا CASCADE: اتصال مربوط بطريقة لا يُحذف من القاعدة؛ حذف المستأجر
 *   المتسلسل يمرّ (التحقق عند نهاية العبارة).
 * - `pos_session_reconciliations.clearing_amount` (إضافي، NULL = تاريخي/غير مميَّز): جزء المتوقَّع المحصَّل عبر المقاصة، فيميّز إقفال الجلسة
 *   ما يصل البنك فوراً مما ينتظر تسوية المستحوذ. اللقطة تبقى غير قابلة للتعديل.
 *
 * `down()` يرفض متى وُجدت طريقة مرتبطة أو لقطة مميَّزة (إصلاح إلى الأمام؛ إسقاط العمود يمحو قرار توجيه محاسبي).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payment_methods', function (Blueprint $table) {
            $table->foreignUuid('pos_clearing_gateway_id')->nullable()->after('is_default')->constrained('payment_gateways');
        });

        Schema::table('pos_session_reconciliations', function (Blueprint $table) {
            $table->bigInteger('clearing_amount')->nullable()->after('expected_amount');
        });
    }

    public function down(): void
    {
        if (DB::table('payment_methods')->whereNotNull('pos_clearing_gateway_id')->exists()
            || DB::table('pos_session_reconciliations')->whereNotNull('clearing_amount')->exists()) {
            throw new RuntimeException('لا يمكن التراجع: توجد طرق دفع مرتبطة بمقاصة POS أو لقطات إقفال مميِّزة لها (إصلاح إلى الأمام فقط).');
        }

        Schema::table('pos_session_reconciliations', function (Blueprint $table) {
            $table->dropColumn('clearing_amount');
        });
        Schema::table('payment_methods', function (Blueprint $table) {
            $table->dropConstrainedForeignId('pos_clearing_gateway_id');
        });
    }
};
