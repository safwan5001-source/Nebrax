<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // تتبّع السداد على مستوى الفاتورة — منفصل عن حالة المستند (draft/posted).
        // payment_status: unpaid | partial | paid (string لتوافق ALTER في SQLite).
        Schema::table('invoices', function (Blueprint $table) {
            $table->bigInteger('paid_amount')->default(0)->after('total');      // المسدَّد (هللات)
            $table->string('payment_status')->default('unpaid')->after('paid_amount');
        });
    }

    public function down(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            $table->dropColumn(['paid_amount', 'payment_status']);
        });
    }
};
