<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * TANKER-PR3 (قرار المالك 6) — `fuel_nozzles.allowed_operations`: أنواع العمليات المسموحة على الفوهة (`direct_sale` | `tanker_fill` | `internal_issue`).
 *
 * إضافية بالكامل: عمود JSON nullable بلا Backfill. **`NULL` = كل العمليات مسموحة** (السلوك الحالي لكل فوهة قائمة)، والمجموعة الكاملة تُخزَّن `NULL`
 * عمداً كي لا تستثني قائمةٌ صريحة عملياتٍ تُضاف لاحقاً. التحقق والتدقيق وصلاحية التضييق في `FuelStationMasterDataService`.
 * التخزين والتحقق فقط: لا يطبَّق القيد على أي مسار بيع/تعبئة في هذه الشريحة (لا أثر تشغيلي ولا مالي ولا مخزني).
 *
 * التراجع يرفض متى وُجدت فوهة بقيد مضبوط (لا فقد صامت لقرار تشغيلي).
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('fuel_nozzles', 'allowed_operations')) {
            Schema::table('fuel_nozzles', function (Blueprint $table) {
                $table->json('allowed_operations')->nullable();
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('fuel_nozzles', 'allowed_operations')) {
            if (DB::table('fuel_nozzles')->whereNotNull('allowed_operations')->exists()) {
                throw new RuntimeException('Rollback refused: fuel_nozzles contains configured allowed_operations.');
            }
            Schema::table('fuel_nozzles', function (Blueprint $table) {
                $table->dropColumn('allowed_operations');
            });
        }
    }
};
