<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * ═══════════════════════════════════════════════════════════════
     *  خصم وشحن وتسوية على فاتورة الشراء — بتكلفةٍ تدخل المخزون
     * ═══════════════════════════════════════════════════════════════
     *  الفواتير تحمل هذه الحقول منذ 000004؛ والمشتريات لا. فتُضاف مرآةً لها
     *  بالأسماء والأنواع نفسها، **لكن بمعالجة محاسبية معكوسة**:
     *
     *   • في البيع: الخصم يخفّض الإيراد، والشحن **إيراد** على 4130.
     *   • في الشراء: الخصم والشحن يدخلان **تكلفة البضاعة** لا حساباً مستقلّاً.
     *
     *  ــ لماذا؟
     *
     *  الخصم التجاري جزءٌ من ثمن الشراء لا إيرادٌ منفصل. ولو رُحِّل إلى حساب
     *  مقابل (5115) لدخل المخزون بالمبلغ **قبل** الخصم، فيبقى المتوسط المتحرك
     *  مضخّماً وتخرج كل تكلفة بضاعة مباعة لاحقة أعلى من الحقيقة.
     *
     *  والشحن الوارد من تكلفة الشراء بنصّ IAS 2 — «تكاليف الشراء تشمل النقل
     *  والمناولة». فرسملتُه تجعل المتوسط يعكس ما كلّف الصنفُ فعلاً حتى وصل
     *  المخزن، وهو الرقم الذي تُقاس به ربحية البيع.
     *
     *  ــ الصفر لا يغيّر شيئاً
     *
     *  الحقول الثلاثة افتراضها `0`، فكل فاتورة قائمة وكل فاتورة لا تستعملها
     *  تُرحَّل كما كانت حرفياً — لا إعادة حساب لمتوسط ولا تغيير في قيد.
     */
    public function up(): void
    {
        Schema::table('purchases', function (Blueprint $table) {
            // خصم على مستوى الفاتورة (هللات) — يُوزَّع نسبياً على السطور.
            $table->bigInteger('discount')->default(0)->after('total');
            // شحن وارد (هللات، قبل الضريبة) — يُرسمَل في تكلفة المخزون.
            $table->bigInteger('shipping')->default(0)->after('discount');
            // تسوية/تقريب (+/−، غير خاضعة للضريبة) — فرق 5170 كالفواتير.
            $table->bigInteger('adjustment')->default(0)->after('shipping');
        });

        // خصم السطر — يخفّض الأساس الخاضع للضريبة، كـ`invoice_lines` تماماً.
        Schema::table('purchase_lines', function (Blueprint $table) {
            $table->bigInteger('line_discount')->default(0)->after('line_subtotal');
        });
    }

    public function down(): void
    {
        Schema::table('purchase_lines', function (Blueprint $table) {
            $table->dropColumn('line_discount');
        });

        Schema::table('purchases', function (Blueprint $table) {
            $table->dropColumn(['discount', 'shipping', 'adjustment']);
        });
    }
};
