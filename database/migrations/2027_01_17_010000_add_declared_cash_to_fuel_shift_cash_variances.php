<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * P1-2 — أساس النقد المتوقع `declared_collection`: عمود إضافي واحد `nullable` في لقطة الفرق المجمَّدة يحمل النقد المُقَرّ به
 * الذي بُني عليه المتوقع عند الإغلاق (يُملأ فقط تحت هذا الأساس). بلا Backfill ولا تعديل لأي صف قائم؛ `official_cash_basis` نصّ حر 32 حرفاً.
 * التراجع يرفض متى وُجدت قيم مكتوبة.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('fuel_shift_cash_variances', function (Blueprint $table) {
            $table->bigInteger('documented_declared_cash_minor')->nullable();
        });
    }

    public function down(): void
    {
        if (DB::table('fuel_shift_cash_variances')->whereNotNull('documented_declared_cash_minor')->exists()) {
            throw new RuntimeException('لا يمكن التراجع: توجد لقطات فرق مجمَّدة تحت الأساس declared_collection.');
        }
        Schema::table('fuel_shift_cash_variances', function (Blueprint $table) {
            $table->dropColumn('documented_declared_cash_minor');
        });
    }
};
