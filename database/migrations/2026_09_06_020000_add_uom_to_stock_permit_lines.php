<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * ═══════════════════════════════════════════════════════════════
     *  PR-INV-3 — لقطة الوحدة على سطر الإذن المخزني + الكمية الأساس الرسمية
     * ═══════════════════════════════════════════════════════════════
     *  نفس عقد `2025_01_01_000046_create_unit_templates.php` (اللقطة على
     *  invoice_lines/purchase_lines): `unit_name`/`unit_factor` يُنسَخان عند
     *  الإنشاء ولا يُعاد تفسيرهما من قالبٍ قد يتغيّر لاحقاً.
     *
     *  الإضافة هنا على القاعدة: `base_quantity` **مُخزَّنة** لا محسوبة عند
     *  كل استدعاء (خلافاً لـ`HasUnitConversion::baseQuantity()` القائمة على
     *  الفاتورة/الشراء) — لأن عقد PR-INV-3 يشترط صراحةً «immutable conversion
     *  snapshot/base quantity» تُحفَظ **قبل** أي حركة مخزون، لا تُشتَقّ عند
     *  كل قراءة. المستودع نواة ما قبل الإنتاج فلا بيانات تجريبية تُصان: يُملأ
     *  الحقل الجديد لكل سطرٍ قائم بمعامل ١ (نفس معنى غياب الوحدة تماماً)
     *  فيصبح `base_quantity = quantity` — صفر تغيير سلوك على ما بُني قبله.
     */
    public function up(): void
    {
        Schema::table('stock_permit_lines', function (Blueprint $table) {
            $table->string('unit_name')->nullable()->after('quantity');
            $table->unsignedInteger('unit_factor')->default(1)->after('unit_name');
            $table->integer('base_quantity')->default(0)->after('unit_factor');
        });

        DB::table('stock_permit_lines')->update(['base_quantity' => DB::raw('quantity')]);
    }

    public function down(): void
    {
        Schema::table('stock_permit_lines', function (Blueprint $table) {
            $table->dropColumn(['unit_name', 'unit_factor', 'base_quantity']);
        });
    }
};
