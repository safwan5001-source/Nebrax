<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * #2021 (قرارات المالك D1/D2/D5) — أعمدة إضافية فقط، كلها `nullable`، بلا Backfill ولا تعديل لأي صف قائم.
 *
 *  - `fuel_sale_payment_receipts`: وردية الاستلام الفعلية (D1) + لقطة نوع التسوية والمبلغ وحساب النقد والفاعل.
 *    الصفوف التاريخية تبقى NULL (لا نسبة تلقائية لوردية).
 *  - `fuel_shift_cash_variances`: مكوّنات الصورة المجمَّدة عند الإغلاق (D2).
 *  - `fuel_shift_cash_movements`: غرض الحركة (`treasury_handover` لـD5) والمستلم المسمّى.
 *
 * لا قيد محاسبي ولا سند ولا مفتاح أجنبي يمسّ `commerce_orders`. التراجع يرفض متى وُجدت قيم مكتوبة.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('fuel_sale_payment_receipts', function (Blueprint $table) {
            $table->foreignUuid('fuel_shift_id')->nullable()->constrained('fuel_shifts')->restrictOnDelete();
            $table->string('settlement_type', 16)->nullable(); // cash | bank — لقطة وقت التحصيل
            $table->bigInteger('amount_minor')->nullable();
            $table->uuid('cash_account_id')->nullable(); // حساب الأستاذ الذي دخله السند (الصندوق الفعلي)
            $table->foreignUuid('received_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->index(['tenant_id', 'fuel_shift_id', 'settlement_type'], 'fuel_receipt_shift_settlement_idx');
        });

        Schema::table('fuel_shift_cash_variances', function (Blueprint $table) {
            $table->bigInteger('documented_official_cash_receipts_minor')->nullable();
            $table->bigInteger('documented_treasury_handover_minor')->nullable();
            $table->bigInteger('registered_network_receipts_minor')->nullable();
            $table->string('official_cash_basis', 32)->nullable(); // movements_only | receiving_shift_receipts
            $table->boolean('expectation_complete')->nullable();
            $table->json('incompleteness')->nullable();
        });

        Schema::table('fuel_shift_cash_movements', function (Blueprint $table) {
            $table->string('purpose', 32)->nullable(); // treasury_handover
            $table->foreignUuid('received_by_user_id')->nullable()->constrained('users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        $stamped = DB::table('fuel_sale_payment_receipts')->whereNotNull('fuel_shift_id')->exists();
        $frozen = DB::table('fuel_shift_cash_variances')->whereNotNull('official_cash_basis')->exists();
        $handover = DB::table('fuel_shift_cash_movements')->whereNotNull('purpose')->exists();
        if ($stamped || $frozen || $handover) {
            throw new RuntimeException('لا يمكن التراجع: توجد إيصالات مختومة بوردية أو لقطات نقد مجمّدة أو تسليمات خزنة مسجّلة (#2021).');
        }

        Schema::table('fuel_shift_cash_movements', function (Blueprint $table) {
            $table->dropConstrainedForeignId('received_by_user_id');
            $table->dropColumn('purpose');
        });
        Schema::table('fuel_shift_cash_variances', function (Blueprint $table) {
            $table->dropColumn([
                'documented_official_cash_receipts_minor', 'documented_treasury_handover_minor',
                'registered_network_receipts_minor', 'official_cash_basis', 'expectation_complete', 'incompleteness',
            ]);
        });
        Schema::table('fuel_sale_payment_receipts', function (Blueprint $table) {
            $table->dropIndex('fuel_receipt_shift_settlement_idx');
            $table->dropConstrainedForeignId('received_by_user_id');
            $table->dropConstrainedForeignId('fuel_shift_id');
            $table->dropColumn(['settlement_type', 'amount_minor', 'cash_account_id']);
        });
    }
};
