<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * IMP-PS-A3c — إجراء `dismiss` في سجل قرارات المراجعة: «سطر الكشف غير موجود في دفاترنا» (محرّك: `missing_in_books`)، **بسبب إلزامي (≥ 3 محارف)** وبلا وحدات.
 * توسيع حارس الشكل فقط (PostgreSQL `CHECK` / SQLite trigger) — لا عمود جديد ولا تعديل لأي صف، وسجل append-only بمُشغّلاته كما هو. لا أثر مالي: القرار تسجيل مراجعة وحده.
 * شكل `dismiss`: بلا وحدات، سبب ≥ 3، أعمدة الزوج فارغة. (كل شرط على عمود قابل للفراغ مصحوب بـ`IS NOT NULL` — `CHECK` يقبل NULL.)
 * `down()` يرفض إن وُجد أي قرار `dismiss` ثم يعيد حارس A3b حرفياً.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE partner_statement_review_decisions DROP CONSTRAINT partner_stmt_decision_shape_chk');
            DB::statement('ALTER TABLE partner_statement_review_decisions ADD CONSTRAINT partner_stmt_decision_shape_chk CHECK ('.$this->postgres(withDismiss: true).')');
        } else {
            DB::unprepared('DROP TRIGGER partner_stmt_decision_shape');
            DB::unprepared($this->sqlite(withDismiss: true));
        }
    }

    public function down(): void
    {
        if (DB::table('partner_statement_review_decisions')->where('action', 'dismiss')->exists()) {
            throw new RuntimeException('لا يُتراجع عن إجراء dismiss وفي سجل القرارات قرارات dismiss (سجل تدقيق لا يُحذف).');
        }
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE partner_statement_review_decisions DROP CONSTRAINT partner_stmt_decision_shape_chk');
            DB::statement('ALTER TABLE partner_statement_review_decisions ADD CONSTRAINT partner_stmt_decision_shape_chk CHECK ('.$this->postgres(withDismiss: false).')');
        } else {
            DB::unprepared('DROP TRIGGER partner_stmt_decision_shape');
            DB::unprepared($this->sqlite(withDismiss: false));
        }
    }

    private function postgres(bool $withDismiss): string
    {
        $actions = $withDismiss ? "'confirm','override','clear','link_pair','dismiss'" : "'confirm','override','clear','link_pair'";
        $noUnits = $withDismiss ? "action IN ('clear','dismiss')" : "action = 'clear'";
        $reason = $withDismiss ? "action NOT IN ('override','link_pair','dismiss')" : "action NOT IN ('override','link_pair')";

        return <<<SQL
            revision >= 1
            AND action IN ({$actions})
            AND (
                ({$noUnits} AND json_array_length(unit_keys) = 0)
                OR (action IN ('confirm','override') AND json_array_length(unit_keys) BETWEEN 1 AND 50)
                OR (action = 'link_pair' AND json_array_length(unit_keys) = 1)
            )
            AND ({$reason} OR (reason IS NOT NULL AND char_length(btrim(reason)) >= 3))
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

    private function sqlite(bool $withDismiss): string
    {
        $actions = $withDismiss ? "'confirm','override','clear','link_pair','dismiss'" : "'confirm','override','clear','link_pair'";
        $noUnits = $withDismiss ? "NEW.action IN ('clear','dismiss')" : "NEW.action = 'clear'";
        $reason = $withDismiss ? "NEW.action NOT IN ('override','link_pair','dismiss')" : "NEW.action NOT IN ('override','link_pair')";

        return <<<SQL
            CREATE TRIGGER partner_stmt_decision_shape BEFORE INSERT ON partner_statement_review_decisions
            WHEN NOT (
                NEW.revision >= 1
                AND NEW.action IN ({$actions})
                AND (
                    ({$noUnits} AND json_array_length(NEW.unit_keys) = 0)
                    OR (NEW.action IN ('confirm','override') AND json_array_length(NEW.unit_keys) BETWEEN 1 AND 50)
                    OR (NEW.action = 'link_pair' AND json_array_length(NEW.unit_keys) = 1)
                )
                AND ({$reason} OR (NEW.reason IS NOT NULL AND length(trim(NEW.reason)) >= 3))
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
