<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * ═══════════════════════════════════════════════════════════════
     *  PR-INV-4 (تصحيح بعد المراجعة) — هوية حالة صريحة (revision) بدل
     *  مقارنة الكمية وحدها
     * ═══════════════════════════════════════════════════════════════
     *  مقارنة الكمية النهائية فقط عمياء عن حركة ABA: ١٠٠ → صرف ١٠ → ٩٠ →
     *  استلام ١٠ → ١٠٠. الكمية عادت كما كانت، لكن حركتين حقيقيتين وقعتا على
     *  نفس الصنف/المخزن منذ لحظة فتح الجرد — والعقد يطلب كشف «حركة/تغيّر
     *  حالة»، لا فرق كمية نهائي فقط.
     *
     *  `revision` عدّاد **رتيب** (monotonic) لكل صفّ Product×Warehouse:
     *  كل حركة مخزون ناجحة تُغيّر هذا الصفّ تزيده بالضبط ١ ضمن نفس المعاملة
     *  (`InventoryService::adjustWarehouseStock()`، المسار الوحيد الذي يكتب
     *  هذا الجدول). لا طابع زمني: الطابع الزمني لا يضمن ترتيباً رتيباً تحت
     *  دقة قاعدة بيانات محدودة أو ساعات نظام غير متزامنة تماماً بين عمليات
     *  متتالية سريعة — والعدّاد الصحيح لا يحتاج توقيتاً أصلاً، فقط تغييراً.
     */
    public function up(): void
    {
        Schema::table('product_warehouse_stock', function (Blueprint $table) {
            $table->unsignedBigInteger('revision')->default(0)->after('quantity');
        });
    }

    public function down(): void
    {
        Schema::table('product_warehouse_stock', function (Blueprint $table) {
            $table->dropColumn('revision');
        });
    }
};
