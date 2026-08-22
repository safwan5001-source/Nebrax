<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // كان سطر المرتجع بلا خصم، فتُفسَّر كل القيم القائمة كخصم صفر. حفظ الخصم
        // يفصل إجمالي السطر قبل الخصم عن صافي الإيراد المردود، ويمنع ردّ POS
        // من تجاوز ما دُفع فعلاً عند وجود خصم على فاتورة المصدر.
        Schema::table('return_lines', function (Blueprint $table) {
            $table->bigInteger('line_discount')->default(0)->after('line_subtotal');
        });
    }

    public function down(): void
    {
        Schema::table('return_lines', function (Blueprint $table) {
            $table->dropColumn('line_discount');
        });
    }
};
