<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * PAY-H4-04a — أساس الدفع الإلكتروني لطلبات المتجر (إضافي فقط).
 *
 * `commerce_payment_intents.method` و`status` عمودا نصٍّ بلا CHECK، فقيمتا `online` و`paid` لا تحتاجان تعديل مخطط. يُضاف فقط
 * `paid_at`: لحظة تثبيت الالتقاط المؤكَّد من المزوّد على النية (لا `collected_at` الذي يخصّ التحصيل النقدي COD/الاستلام).
 * المحاولات تبقى في `payment_attempts` (`payable_key = commerce_payment_intent:<id>`) — لا جدول محاولات موازٍ ولا أعمدة مزوّد هنا.
 *
 * لا Backfill ولا تعديل لأي صف قائم: كل النوايا التاريخية `cod`/`pay_on_pickup` كما هي.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('commerce_payment_intents', function (Blueprint $table) {
            $table->timestamp('paid_at')->nullable()->after('collected_at');
        });
    }

    public function down(): void
    {
        // لا تراجع فوق بيانات دفع إلكتروني فعلية: يضيع تاريخ الالتقاط. إصلاح إلى الأمام فقط.
        if (DB::table('commerce_payment_intents')->where('method', 'online')->exists()) {
            throw new RuntimeException('لا يمكن التراجع: توجد نوايا دفع إلكتروني (commerce_payment_intents.method = online).');
        }

        Schema::table('commerce_payment_intents', function (Blueprint $table) {
            $table->dropColumn('paid_at');
        });
    }
};
