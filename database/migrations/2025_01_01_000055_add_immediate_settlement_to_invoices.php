<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * ═══════════════════════════════════════════════════════════════
     *  «مدفوع بالفعل» على فاتورة المبيعات — نيّةٌ تُحفَظ، وسندُ قبض يُرحَّل
     * ═══════════════════════════════════════════════════════════════
     *  نظير `paid_on_post` على فاتورة الشراء (هجرة 000050) في جانب المبيعات،
     *  وللعلّة نفسها: `payment_type = 'cash'` كان يمدِّن **1110 الصندوق**
     *  مباشرةً داخل قيد الفاتورة ويترك `paid_amount = 0` و`payment_status =
     *  'unpaid'`. فلا سندَ قبض يظهر في كشف حساب العميل، ولا حالةَ سدادٍ
     *  صادقة، وتقريرُ أعمار الديون يجمعه هكذا:
     *
     *      Invoice::where('status','posted')->where('payment_status','!=','paid')
     *
     *  فتظهر كل فاتورة نقدية دَيناً قائماً على العميل بينما الدفتر لا يحمل
     *  لها هللةً في 1130.
     *
     *  والعلاج نفسه: الفاتورة تُقيَّد على **1130 العملاء**، ثم يقفلها **سند
     *  قبض حقيقي** عبر `PaymentService` (مدين 1110/1120 · دائن 1130). الأثر
     *  الصافي على الأرصدة هو الأثر نفسه، ويضيف ما لم يكن: سنداً في كشف حساب
     *  العميل، قابلاً للعكس وحده دون الفاتورة، و`paid_amount`/`payment_status`
     *  صحيحين.
     *
     *  الحقول **نيّةٌ على المسوّدة** يترجمها `InvoiceService::post` إلى سند:
     *   • `is_paid`           — «مدفوع بالفعل» (الخانة في ملخّص الفاتورة).
     *   • `payment_method`    — الأداة كما يراها البائع: نقدي · تحويل · بطاقة.
     *     (السند نفسه ثنائي `cash|bank`؛ التحويل والبطاقة كلاهما بنك — نفس
     *      تعيين `PosService` حرفياً.)
     *   • `payment_reference` — رقم المعرِّف (حوالة/شبكة) يُمرَّر إلى السند.
     *   • `cash_account_id`   — الخزينة المستلِمة. الغياب = الافتراضية بحسب
     *     الأداة (1110 أو 1120)، وهو سلوك اليوم حرفياً.
     *
     *  **لا يُمَسّ مستندٌ قائم:** الافتراضات هي سلوك ما قبل الهجرة، والفواتير
     *  النقدية المرحّلة تبقى كما هي — قيدُها في الدفتر صحيح الأثر، وتوليد
     *  سندٍ لها بأثر رجعي كان سيخصم الصندوق مرّتين. تصحيح حالتها قرارُ بيانات
     *  يخصّ المالك، لا أثرٌ جانبي لهجرة شاشة.
     */
    public function up(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            $table->boolean('is_paid')->default(false)->after('payment_status');
            $table->string('payment_method')->default('cash')->after('is_paid');
            $table->string('payment_reference')->nullable()->after('payment_method');
            // عمودٌ عادي **بلا مفتاح أجنبي** عمداً — كنظيره في هجرة المدفوعات
            // (000054): إضافة FK لجدولٍ قائم تُعيد بناءه على SQLite فتُسقط شرط
            // الفهرس الجزئي (`WHERE branch_id IS NULL`) لهجرة الترقيم بالفرع
            // (000053) ويكسر استقلال تسلسل الفروع. التكامل المرجعي يضمنه
            // `PaymentService::validCashAccountId` (السند هو من يقيّد الخزينة).
            $table->uuid('cash_account_id')->nullable()->after('payment_reference');
        });
    }

    public function down(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            $table->dropColumn(['cash_account_id', 'is_paid', 'payment_method', 'payment_reference']);
        });
    }
};
