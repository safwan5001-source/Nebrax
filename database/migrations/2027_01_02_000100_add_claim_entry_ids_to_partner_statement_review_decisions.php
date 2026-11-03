<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * IMP-PS-A3d (Codex P2 على #1941) — هوية قيود القرار محفوظة في القرار نفسه: عمود إضافي اختياري `claim_entry_ids` على سجل القرارات (append-only) يُكتب لقراري `confirm`/`override` وحدهما بمعرّفات قيود الوحدات
 * التي اعتمدها المراجع **وقت القرار** (من الدفتر المقيَّد ببصمته). به يستطيع حارس المطالبات في القاعدة أن يثبت أن القيد المُطالَب به **ينتمي إلى الوحدة المعتمدة** دون أن يعيد حساب مكوّنات الوحدات من الأستاذ.
 *
 *  - **إضافي ومتوافق خلفياً:** عمود nullable بلا backfill؛ لا تغيير في منطق المطابقة ولا في واجهة API (لا حقل جديد في العرض). القرارات القائمة قبله تبقى صالحة للمراجعة، لكن **لا يُطالَب بقيودها** (يُرفض الإغلاق
 *    `claim_identity_unproven` وتُمنع المراجعة بمانع `decisions_without_entry_identity`) حتى يُعاد القرار نفسه فيُكتب بنسخة جديدة بالهوية — ولا إغلاق سابقاً لـA3d فلا مقارنة مغلقة تتأثر.
 *  - حارس الشكل: `claim_entry_ids` لا تحمله إلا قرارات confirm/override، مصفوفة JSON غير فارغة. القرار immutable أصلاً (مُشغّلات A3a) فلا تُعدَّل الهوية بعد كتابتها.
 * يسبق هجرة المطالبات (يقرؤه مُشغّلها). `down()` يرفض إن وُجد صف يحمل هوية (أثر تدقيق).
 */
return new class extends Migration
{
    private const TABLE = 'partner_statement_review_decisions';

    public function up(): void
    {
        Schema::table(self::TABLE, function (Blueprint $table) {
            $table->json('claim_entry_ids')->nullable();
        });

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement(<<<'SQL'
                ALTER TABLE partner_statement_review_decisions
                    ADD CONSTRAINT partner_stmt_decision_entry_ids_chk CHECK (
                        claim_entry_ids IS NULL
                        OR (action IN ('confirm', 'override') AND json_typeof(claim_entry_ids) = 'array' AND json_array_length(claim_entry_ids) BETWEEN 1 AND 5000)
                    )
                SQL);
        } else {
            DB::unprepared(<<<'SQL'
                CREATE TRIGGER partner_stmt_decision_entry_ids BEFORE INSERT ON partner_statement_review_decisions
                WHEN NEW.claim_entry_ids IS NOT NULL
                 AND NOT (NEW.action IN ('confirm', 'override') AND json_valid(NEW.claim_entry_ids) AND json_type(NEW.claim_entry_ids) = 'array'
                          AND json_array_length(NEW.claim_entry_ids) BETWEEN 1 AND 5000)
                BEGIN
                    SELECT RAISE(ABORT, 'partner_statement_review_decisions: claim_entry_ids belong to confirm/override decisions only and must be a non-empty array');
                END
                SQL);
        }
    }

    public function down(): void
    {
        if (DB::table(self::TABLE)->whereNotNull('claim_entry_ids')->exists()) {
            throw new RuntimeException('لا يُتراجع عن هوية قيود القرارات وفي السجل قرارات تحملها (أثر تدقيق).');
        }
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE '.self::TABLE.' DROP CONSTRAINT IF EXISTS partner_stmt_decision_entry_ids_chk');
        } else {
            DB::unprepared('DROP TRIGGER IF EXISTS partner_stmt_decision_entry_ids');
        }
        Schema::table(self::TABLE, fn (Blueprint $table) => $table->dropColumn('claim_entry_ids'));
    }
};
