<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * ═══════════════════════════════════════════════════════════════
     *  «تم الدفع بالفعل» + حالة الاستلام على فاتورة الشراء
     * ═══════════════════════════════════════════════════════════════
     *  ــ ١) السداد الفوري
     *
     *  كان `payment_type = 'cash'` يجعل الطرفَ الدائن **1110 الصندوق** مباشرةً
     *  ويترك `paid_amount = 0` و`payment_status = 'unpaid'`. والنتيجة خللٌ
     *  صامت في تقرير أعمار الديون الدائنة، إذ يجمعه هكذا:
     *
     *      Purchase::where('status','posted')->where('payment_status','!=','paid')
     *
     *  فكل فاتورة نقدية تظهر التزاماً قائماً للمورّد، بينما الدفتر لا يحمل
     *  لها هللةً واحدة في 2110. التقرير يضخّم المطلوبات بمقدار كل شراء نقدي.
     *
     *  والعلاج أن **الفاتورة تُقيَّد دائماً على 2110**، ويُولَّد للسداد الفوري
     *  **سند صرف حقيقي** عبر `PaymentService` (مدين 2110 / دائن 1110 أو 1120).
     *  الأثر الصافي على الأرصدة هو الأثر نفسه، لكنه يضيف ثلاثة أشياء لم تكن:
     *  سنداً يظهر في كشف حساب المورّد، وسنداً قابلاً للعكس وحده دون الفاتورة،
     *  و`paid_amount`/`payment_status` صحيحين — فينصلح التقرير من جذره.
     *
     *  وبه صار **الدفع الجزئي عند الإصدار** ممكناً: مبلغٌ دون الإجمالي يترك
     *  الفاتورة `partial` والباقي ديناً حقيقياً في 2110.
     *
     *  ــ ٢) حالة الاستلام
     *
     *  حقلان **إعلاميان لا محاسبيان**: تاريخ وصول البضاعة قد يخالف تاريخ
     *  الفاتورة. المخزون يظلّ يدخل عند الترحيل كما هو اليوم — فصلُ الاستلام
     *  عن الترحيل يحتاج حساب «بضاعة بالطريق» ودورةَ استلامٍ كاملة، وهي وحدة
     *  مستقلّة لا حقلٌ في هجرة.
     */
    public function up(): void
    {
        Schema::table('purchases', function (Blueprint $table) {
            // المبلغ المدفوع لحظة الترحيل (هللات) — نيّةٌ تُحفظ على المسودة
            // ويُترجمها `PurchaseService::post` إلى سند صرف مرحَّل.
            $table->bigInteger('paid_on_post')->default(0)->after('payment_status');
            // وسيلة ذلك السداد: نقداً (1110) أو بنكاً (1120).
            $table->string('payment_method')->default('cash')->after('paid_on_post');

            // pending بانتظار الاستلام · partial جزئي · received مستلَم
            $table->string('received_status')->default('received')->after('payment_method');
            $table->date('received_date')->nullable()->after('received_status');
        });

        /**
         * تصحيح الفواتير النقدية القائمة.
         *
         * **لا تُولَّد لها سندات بأثر رجعي:** قيدُها المفرد (دائن 1110) موجودٌ
         * في الدفتر وصحيحُ الأثر، وإقحامُ سندٍ اليوم يزيد الصندوقَ خصماً مرة
         * ثانية. المصحَّح هو **حالة المستند** وحدها، فيخرج من تقرير الأعمار
         * ما لا دَين عليه — وهو تحديداً موضع الخلل.
         */
        DB::table('purchases')
            ->where('status', 'posted')
            ->where('payment_type', 'cash')
            ->update([
                'paid_amount'    => DB::raw('total'),
                'payment_status' => 'paid',
            ]);

        // المرحَّل استُلمت بضاعته فعلاً (دخلت المخزون عند الترحيل)، فتاريخ
        // استلامه تاريخُ الشراء. والمسوّدات تبقى بلا تاريخ حتى تُرحَّل.
        DB::table('purchases')
            ->where('status', 'posted')
            ->update(['received_date' => DB::raw('purchase_date')]);
    }

    public function down(): void
    {
        Schema::table('purchases', function (Blueprint $table) {
            $table->dropColumn(['paid_on_post', 'payment_method', 'received_status', 'received_date']);
        });
    }
};
