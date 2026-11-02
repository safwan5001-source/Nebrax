<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * IMP-PS-A3b — الربط اليدوي لزوج قيد أصل/عكس مثبت (`link_pair`) في سجل قرارات المراجعة. **إضافي**: ثلاثة أعمدة اختيارية + عمود تدقيق، وتوسيع حارس الشكل بإجراء رابع.
 * لا تعديل لأي صف قائم ولا لسجل الأستاذ ولا مفتاح أجنبي إلى القيود.
 *
 *  - `pair_member` (original | reversal): أي طرفي الزوج يقابله سطر الكشف — **قرار المراجع الصريح**، لا استنتاج.
 *  - `pair_original_entry_id` / `pair_reversal_entry_id`: معرّفا القيدين كما أثبتهما `reversal_of` في الأستاذ وقت القرار (أثر تدقيق؛ لا مفتاح أجنبي).
 *  - `engine_code`: رمز تفسير المحرّك لسطر الكشف وقت القرار (مثل `reversed_in_books`) فيبقى ما رآه المراجع محفوظاً مع قراره.
 *  - الشكل (PostgreSQL `CHECK` / SQLite trigger): `link_pair` ⇒ وحدة واحدة بالضبط + سبب ≥ 3 محارف + عضو صالح + قيدان مختلفان؛ وغيره ⇒ الأعمدة الثلاثة فارغة.
 *    كل شرط على عمود قابل للفراغ مصحوب بـ`IS NOT NULL` صريح: `CHECK` يقبل الناتج NULL، فبدونه يمرّ صفٌّ بلا عضو (التقاط من اختبار القاعدة).
 * سجل append-only كما هو (مُشغّلات الاستعمال والتسلسل والمنع لم تُمَس). `down()` يرفض إن وُجد أي قرار `link_pair`.
 */
return new class extends Migration
{
    private const TABLE = 'partner_statement_review_decisions';

    public function up(): void
    {
        Schema::table(self::TABLE, function (Blueprint $table) {
            $table->string('pair_member', 10)->nullable();
            $table->uuid('pair_original_entry_id')->nullable();
            $table->uuid('pair_reversal_entry_id')->nullable();
            $table->string('engine_code', 64)->nullable();
        });

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE partner_statement_review_decisions DROP CONSTRAINT partner_stmt_decision_shape_chk');
            DB::statement('ALTER TABLE partner_statement_review_decisions ADD CONSTRAINT partner_stmt_decision_shape_chk CHECK ('.$this->shapePostgres().')');
        } else {
            DB::unprepared('DROP TRIGGER partner_stmt_decision_shape');
            DB::unprepared($this->sqliteShapeTrigger());
        }
    }

    public function down(): void
    {
        if (Schema::hasTable(self::TABLE) && DB::table(self::TABLE)->where('action', 'link_pair')->exists()) {
            throw new RuntimeException('لا يُتراجع عن الربط اليدوي لأزواج القيود المعكوسة وفي السجل قرارات link_pair (سجل تدقيق لا يُحذف).');
        }

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE partner_statement_review_decisions DROP CONSTRAINT partner_stmt_decision_shape_chk');
            DB::statement(<<<'SQL'
                ALTER TABLE partner_statement_review_decisions
                    ADD CONSTRAINT partner_stmt_decision_shape_chk CHECK (
                        revision >= 1
                        AND action IN ('confirm','override','clear')
                        AND (
                            (action = 'clear' AND json_array_length(unit_keys) = 0)
                            OR (action IN ('confirm','override') AND json_array_length(unit_keys) BETWEEN 1 AND 50)
                        )
                        AND (action <> 'override' OR (reason IS NOT NULL AND char_length(btrim(reason)) >= 3))
                    )
                SQL);
        } else {
            DB::unprepared('DROP TRIGGER partner_stmt_decision_shape');
            DB::unprepared(<<<'SQL'
                CREATE TRIGGER partner_stmt_decision_shape BEFORE INSERT ON partner_statement_review_decisions
                WHEN NOT (
                    NEW.revision >= 1
                    AND NEW.action IN ('confirm','override','clear')
                    AND (
                        (NEW.action = 'clear' AND json_array_length(NEW.unit_keys) = 0)
                        OR (NEW.action IN ('confirm','override') AND json_array_length(NEW.unit_keys) BETWEEN 1 AND 50)
                    )
                    AND (NEW.action <> 'override' OR (NEW.reason IS NOT NULL AND length(trim(NEW.reason)) >= 3))
                )
                BEGIN
                    SELECT RAISE(ABORT, 'partner_statement_review_decisions: invalid decision shape');
                END
                SQL);
        }

        Schema::table(self::TABLE, function (Blueprint $table) {
            $table->dropColumn(['pair_member', 'pair_original_entry_id', 'pair_reversal_entry_id', 'engine_code']);
        });
    }

    private function shapePostgres(): string
    {
        return <<<'SQL'
            revision >= 1
            AND action IN ('confirm','override','clear','link_pair')
            AND (
                (action = 'clear' AND json_array_length(unit_keys) = 0)
                OR (action IN ('confirm','override') AND json_array_length(unit_keys) BETWEEN 1 AND 50)
                OR (action = 'link_pair' AND json_array_length(unit_keys) = 1)
            )
            AND (action NOT IN ('override','link_pair') OR (reason IS NOT NULL AND char_length(btrim(reason)) >= 3))
            AND (
                (action = 'link_pair'
                    AND pair_member IS NOT NULL AND pair_member IN ('original','reversal')
                    AND pair_original_entry_id IS NOT NULL AND pair_reversal_entry_id IS NOT NULL
                    AND pair_original_entry_id <> pair_reversal_entry_id)
                OR (action <> 'link_pair'
                    AND pair_member IS NULL AND pair_original_entry_id IS NULL AND pair_reversal_entry_id IS NULL)
            )
            SQL;
    }

    private function sqliteShapeTrigger(): string
    {
        return <<<'SQL'
            CREATE TRIGGER partner_stmt_decision_shape BEFORE INSERT ON partner_statement_review_decisions
            WHEN NOT (
                NEW.revision >= 1
                AND NEW.action IN ('confirm','override','clear','link_pair')
                AND (
                    (NEW.action = 'clear' AND json_array_length(NEW.unit_keys) = 0)
                    OR (NEW.action IN ('confirm','override') AND json_array_length(NEW.unit_keys) BETWEEN 1 AND 50)
                    OR (NEW.action = 'link_pair' AND json_array_length(NEW.unit_keys) = 1)
                )
                AND (NEW.action NOT IN ('override','link_pair') OR (NEW.reason IS NOT NULL AND length(trim(NEW.reason)) >= 3))
                AND (
                    (NEW.action = 'link_pair'
                        AND NEW.pair_member IS NOT NULL AND NEW.pair_member IN ('original','reversal')
                        AND NEW.pair_original_entry_id IS NOT NULL AND NEW.pair_reversal_entry_id IS NOT NULL
                        AND NEW.pair_original_entry_id <> NEW.pair_reversal_entry_id)
                    OR (NEW.action <> 'link_pair'
                        AND NEW.pair_member IS NULL AND NEW.pair_original_entry_id IS NULL AND NEW.pair_reversal_entry_id IS NULL)
                )
            )
            BEGIN
                SELECT RAISE(ABORT, 'partner_statement_review_decisions: invalid decision shape');
            END
            SQL;
    }
};
