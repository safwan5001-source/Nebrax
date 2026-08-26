<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('pos_devices', function (Blueprint $table) {
            // بيانات تشغيل محلية للجهاز فقط. سر الاقتران مشفّر قبل الحفظ ولا يعود
            // أبداً في مورد الـ API، فلا يستطيع متصفح أو مستخدم آخر فتح الدرج.
            $table->json('cash_drawer_config')->nullable()->after('notes');
        });
    }

    public function down(): void
    {
        Schema::table('pos_devices', function (Blueprint $table) {
            $table->dropColumn('cash_drawer_config');
        });
    }
};
