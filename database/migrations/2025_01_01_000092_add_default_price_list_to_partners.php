<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // قيمة اقتراحية للعميل وليست سعراً مثبتاً ولا أثراً محاسبياً. القيد
        // المقيّد يمنع حذف قائمة مختارة افتراضياً وترك إعداد طرف صامتاً بلا مرجع.
        Schema::table('partners', function (Blueprint $table) {
            $table->foreignUuid('default_price_list_id')
                ->nullable()
                ->constrained('price_lists')
                ->restrictOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('partners', function (Blueprint $table) {
            $table->dropConstrainedForeignId('default_price_list_id');
        });
    }
};
