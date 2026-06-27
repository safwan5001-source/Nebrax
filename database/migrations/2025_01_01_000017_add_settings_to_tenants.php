<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // إعدادات المستأجر (تفضيلات غير محاسبية) كـ JSON — مثل إعدادات المبيعات.
        Schema::table('tenants', function (Blueprint $table) {
            $table->json('settings')->nullable()->after('plan_limits');
        });
    }

    public function down(): void
    {
        Schema::table('tenants', function (Blueprint $table) {
            $table->dropColumn('settings');
        });
    }
};
