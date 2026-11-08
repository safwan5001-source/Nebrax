<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * P1-3b-2c — تاريخ التحصيل الفعلي لتخصيصات التسوية، **منفصل** عن تاريخ التوريد وعن تاريخ إصدار الفاتورة.
 *
 *  - `collected_at`   لحظة التحصيل الفعلية (UTC) = لحظة إقرار التحصيل (`fuel_shift_collection_declarations.declared_at`) وقت الترحيل: دليل العدّ والتسليم.
 *  - `collection_date` اليوم التجاري لتلك اللحظة بتقويم المحطة = `payments.payment_date` = تاريخ قيد القبض في الأستاذ.
 *
 * ليس لهما قيد مساواة بتاريخ التوريد (`supply_business_date`)؛ قد يسبقه (إقرار قبل منتصف الليل لوردية أُغلقت بعده) أو يساويه. فحص الفترة المقفلة يجري على كلٍّ منهما
 * على حدة. الصفوف الجديدة تفرضهما معاً في القاعدة (لا إدراج بدونهما)؛ جدول التخصيصات بلا كاتب قبل هذه الشريحة فلا Backfill.
 * مُشغّل التجميد على SQLite ملتقِط لقائمة أعمدته فيُعاد بناؤه.
 */
return new class extends Migration
{
    private const TABLE = 'fuel_shift_settlement_collections';

    public function up(): void
    {
        Schema::table(self::TABLE, function (Blueprint $table) {
            $table->timestamp('collected_at')->nullable();
            $table->date('collection_date')->nullable();
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE '.self::TABLE.' ADD CONSTRAINT fuel_settlement_collections_dates_check CHECK ((collected_at IS NULL) = (collection_date IS NULL))');
            DB::unprepared(<<<'SQL'
                CREATE OR REPLACE FUNCTION fuel_settlement_collection_require_dates() RETURNS trigger LANGUAGE plpgsql AS $fn$
                BEGIN
                    IF NEW.collected_at IS NULL OR NEW.collection_date IS NULL THEN
                        RAISE EXCEPTION 'fuel_shift_settlement_collections: collected_at and collection_date are required on insert';
                    END IF;
                    RETURN NEW;
                END
                $fn$
                SQL);
            DB::unprepared('CREATE TRIGGER fuel_shift_settlement_collections_require_dates BEFORE INSERT ON '.self::TABLE.' FOR EACH ROW EXECUTE FUNCTION fuel_settlement_collection_require_dates()');
        } else {
            DB::unprepared('DROP TRIGGER IF EXISTS '.self::TABLE.'_guard_update_frozen');
            $this->recreateSqliteFrozenTrigger();
            DB::unprepared('CREATE TRIGGER fuel_shift_settlement_collections_dates_insert BEFORE INSERT ON '.self::TABLE
                .' WHEN NEW.collected_at IS NULL OR NEW.collection_date IS NULL BEGIN SELECT RAISE(ABORT, \'fuel_shift_settlement_collections: collected_at and collection_date are required on insert\'); END');
        }
    }

    public function down(): void
    {
        if (Schema::hasTable(self::TABLE) && DB::table(self::TABLE)->exists()) {
            throw new RuntimeException('لا يمكن التراجع: جدول تخصيصات تسوية الورديات يحتوي صفوفاً (تواريخ التحصيل لا تُسقط بالتراجع).');
        }

        if (DB::getDriverName() === 'pgsql') {
            DB::unprepared('DROP TRIGGER IF EXISTS fuel_shift_settlement_collections_require_dates ON '.self::TABLE);
            DB::unprepared('DROP FUNCTION IF EXISTS fuel_settlement_collection_require_dates() CASCADE');
            DB::unprepared('ALTER TABLE '.self::TABLE.' DROP CONSTRAINT IF EXISTS fuel_settlement_collections_dates_check');
        } else {
            DB::unprepared('DROP TRIGGER IF EXISTS fuel_shift_settlement_collections_dates_insert');
            DB::unprepared('DROP TRIGGER IF EXISTS '.self::TABLE.'_guard_update_frozen');
        }

        Schema::table(self::TABLE, function (Blueprint $table) {
            $table->dropColumn(['collected_at', 'collection_date']);
        });

        if (DB::getDriverName() !== 'pgsql') {
            $this->recreateSqliteFrozenTrigger();
        }
    }

    private function recreateSqliteFrozenTrigger(): void
    {
        $columns = array_values(array_diff(Schema::getColumnListing(self::TABLE), ['updated_at']));
        $changed = implode(' OR ', array_map(fn ($c) => "OLD.{$c} IS NOT NEW.{$c}", $columns));
        DB::unprepared('CREATE TRIGGER '.self::TABLE."_guard_update_frozen BEFORE UPDATE ON ".self::TABLE." WHEN {$changed} BEGIN SELECT RAISE(ABORT, '".self::TABLE.": settlement records are immutable (only single-use resolution columns may transition)'); END");
    }
};
