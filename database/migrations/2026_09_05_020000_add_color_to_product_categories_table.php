<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * PR-2C: عمود إضافي بحت — لون تعريفي اختياري للتصنيف يُستهلك حصراً حين
     * يختار المستأجر صراحةً وضع عرض «لون» في POS (`category_presentation_mode`).
     * لا أثر محاسبي ولا تغيير على أي عمود قائم؛ الفارغ يعني تصنيفاً بلا لون
     * مضبوط، فيسقط العرض على المعالجة المحايدة الآمنة.
     */
    public function up(): void
    {
        Schema::table('product_categories', function (Blueprint $table): void {
            $table->string('color', 7)->nullable()->after('image_size');
        });
    }

    public function down(): void
    {
        Schema::table('product_categories', function (Blueprint $table): void {
            $table->dropColumn('color');
        });
    }
};
