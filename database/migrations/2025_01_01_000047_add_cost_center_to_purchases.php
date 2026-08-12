<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * ═══════════════════════════════════════════════════════════════
     *  مركز التكلفة على فاتورة الشراء — إغلاق فجوة مع الفواتير
     * ═══════════════════════════════════════════════════════════════
     *  `invoices.cost_center_id` قائم منذ 000004 ويوسم سطر الإيراد، فيقرأ
     *  تقرير الربحية إيرادات كل مركز. أمّا المشتريات فبلا وسم — أي أن نصف
     *  المعادلة يصل التقرير والنصف الآخر لا. **مركزٌ تُعرَف إيراداته ولا
     *  تُعرَف تكاليفه لا يُقاس ربحه**، وهو الغرض الوحيد من مراكز التكلفة.
     *
     *  إضافة غير كاسرة: القيم القائمة `null` (بلا مركز) كما كانت، والوسم
     *  يبدأ من الفواتير المُنشأة بعد الترقية.
     */
    public function up(): void
    {
        Schema::table('purchases', function (Blueprint $table) {
            $table->foreignUuid('cost_center_id')->nullable()->after('partner_id')
                ->constrained('cost_centers')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('purchases', function (Blueprint $table) {
            $table->dropConstrainedForeignId('cost_center_id');
        });
    }
};
