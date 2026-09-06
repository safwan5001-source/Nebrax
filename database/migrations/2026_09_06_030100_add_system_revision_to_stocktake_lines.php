<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * لقطة الفتح تحفظ الآن `revision` صفّ `product_warehouse_stock` جنباً
     * إلى جنب مع `system_quantity` — انظر شرح `revision` الكامل في
     * `2026_09_06_030000_add_revision_to_product_warehouse_stock.php`.
     */
    public function up(): void
    {
        Schema::table('stocktake_lines', function (Blueprint $table) {
            $table->unsignedBigInteger('system_revision')->default(0)->after('system_quantity');
        });
    }

    public function down(): void
    {
        Schema::table('stocktake_lines', function (Blueprint $table) {
            $table->dropColumn('system_revision');
        });
    }
};
