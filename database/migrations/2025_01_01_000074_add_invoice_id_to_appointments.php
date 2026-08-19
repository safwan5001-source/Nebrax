<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * الموعد يبقى مستقلاً إن لم يكن له مستند مصدر، لكن رابط الفاتورة الصريح
     * يتيح عرض المواعيد من الفاتورة بلا استنتاج هشّ من العميل أو عنوان الموعد.
     */
    public function up(): void
    {
        Schema::table('appointments', function (Blueprint $table) {
            $table->foreignUuid('invoice_id')
                ->nullable()
                ->after('partner_id')
                ->constrained('invoices')
                ->nullOnDelete();
            $table->index(['tenant_id', 'invoice_id', 'appointment_at']);
        });
    }

    public function down(): void
    {
        Schema::table('appointments', function (Blueprint $table) {
            $table->dropIndex(['tenant_id', 'invoice_id', 'appointment_at']);
            $table->dropConstrainedForeignId('invoice_id');
        });
    }
};
