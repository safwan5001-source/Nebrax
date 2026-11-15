<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * TANKER-PR8-S — تثبيت متطلب مراجعة فروق العدّادات على اللقطة المجمَّدة وقت الإغلاق. عمود إضافي واحد nullable على `fuel_shift_nozzle_reconciliations`:
 *
 *  - `review_requirement` = `required_before_approval` (القيمة الوحيدة المسموحة الآن) يُكتب مرة واحدة في معاملة الإغلاق مع اللقطة نفسها، فلا يتغيّر بتعطيل الإعداد لاحقاً
 *    ولا بإغلاق بوابة النشر. مُشغّلات منع UPDATE/DELETE القائمة (هجرة PR-8) تحميه.
 *  - **NULL = مطلوب** (فشل مغلق): لقطة سبقت هذا العمود كانت خاضعة لقاعدة PR-8 («كل فرق خارج التفاوت يحتاج مراجعة»). لا Backfill ولا تعديل لأي صف قائم.
 *  - لا لمس لـ`fuel_shifts` ولا مُشغّل اعتماد؛ الفرض في `FuelShiftMeterReconciliationService::assertApprovable` تحت قفل الوردية.
 *
 * التراجع يرفض متى وُجدت أي قيمة غير فارغة (لا يُمحى متطلب مجمَّد).
 */
return new class extends Migration
{
    private const TABLE = 'fuel_shift_nozzle_reconciliations';

    public function up(): void
    {
        Schema::table(self::TABLE, function (Blueprint $table) {
            $table->string('review_requirement', 40)->nullable()->after('incompleteness');
        });

        $driver = DB::connection()->getDriverName();
        if ($driver === 'pgsql') {
            DB::statement('ALTER TABLE ' . self::TABLE . " ADD CONSTRAINT fuel_nozzle_reconciliation_requirement CHECK (review_requirement IS NULL OR review_requirement IN ('required_before_approval'))");
        } elseif ($driver === 'sqlite') {
            DB::unprepared('CREATE TRIGGER fuel_nozzle_reconciliation_requirement BEFORE INSERT ON ' . self::TABLE . "
                WHEN NEW.review_requirement IS NOT NULL AND NEW.review_requirement NOT IN ('required_before_approval')
                BEGIN SELECT RAISE(ABORT, 'fuel_shift_nozzle_reconciliations: invalid review requirement'); END");
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn(self::TABLE, 'review_requirement') && DB::table(self::TABLE)->whereNotNull('review_requirement')->exists()) {
            throw new RuntimeException('Rollback refused: ' . self::TABLE . ' carries frozen review requirements.');
        }

        $driver = DB::connection()->getDriverName();
        if ($driver === 'pgsql') {
            DB::statement('ALTER TABLE ' . self::TABLE . ' DROP CONSTRAINT IF EXISTS fuel_nozzle_reconciliation_requirement');
        } elseif ($driver === 'sqlite') {
            DB::unprepared('DROP TRIGGER IF EXISTS fuel_nozzle_reconciliation_requirement');
        }
        Schema::table(self::TABLE, function (Blueprint $table) {
            $table->dropColumn('review_requirement');
        });
    }
};
