<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * يبقى المرجع المنطقي متعدد الأنواع محمياً في نموذج الرابط وباني المعاملة.
     * لا يصلح FK واحد لـ purchases بعد إضافة Expense، ولا يجوز حذف الروابط
     * لإتمام rollback؛ لذلك يرفض down وجود أي رابط Expense بدلاً من فقدان التدقيق.
     */
    public function up(): void
    {
        Schema::table('document_transaction_links', function (Blueprint $table): void {
            $table->dropForeign(['transaction_id']);
        });
    }

    public function down(): void
    {
        if (DB::table('document_transaction_links')->where('transaction_type', 'expense')->exists()) {
            throw new \RuntimeException('Cannot restore the purchase-only transaction link constraint while expense links exist.');
        }

        Schema::table('document_transaction_links', function (Blueprint $table): void {
            $table->foreign('transaction_id')->references('id')->on('purchases')->restrictOnDelete();
        });
    }
};
