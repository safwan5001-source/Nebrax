<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * AWJ-PAYMENTS-HZ-01 / PAY-H3-01c — حارس انتقالات ترحيل استرداد البوابة في القاعدة (ADR-0007 A5). **مُشغّل فقط: لا عمود ولا تعديل لأي صف.**
 * `posting_status`: null ← pending (عند التأكيد) ← posted | blocked_period؛ blocked_period ← posted؛ المرحَّل نهائي. ومدخل القيد لا يُكتب إلا مع `posted`
 * ويُثبَّت بعدها (الثبات العام لـ`journal_entry_id` في مُشغّل 01b). `down()` يرفض متى وُجد استرداد مرحَّل أو محجوب (إصلاح إلى الأمام فقط).
 */
return new class extends Migration
{
    private const NAME = 'payment_refunds_posting_transition';

    public function up(): void
    {
        // COALESCE على الطرفين: مقارنة NULL تعطي NULL فيتجاوز NOT(...) الشرط (NULL→posted كان يمرّ).
        $old = "COALESCE(OLD.posting_status, '')";
        $new = "COALESCE(NEW.posting_status, '')";
        $legal = "({$old} = '' AND {$new} = 'pending') "
            ."OR ({$old} = 'pending' AND {$new} IN ('posted','blocked_period')) "
            ."OR ({$old} = 'blocked_period' AND {$new} = 'posted')";
        $changed = DB::connection()->getDriverName() === 'pgsql'
            ? 'NEW.posting_status IS DISTINCT FROM OLD.posting_status'
            : 'NEW.posting_status IS NOT OLD.posting_status';
        $journalWithoutPosted = "(NEW.journal_entry_id IS NOT NULL AND COALESCE(NEW.posting_status, '') <> 'posted')";
        $condition = "({$changed} AND NOT ({$legal})) OR {$journalWithoutPosted}";

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::unprepared('CREATE OR REPLACE FUNCTION '.self::NAME."() RETURNS trigger AS \$\$
BEGIN
    IF {$condition} THEN
        RAISE EXCEPTION '".self::NAME."';
    END IF;
    RETURN NEW;
END;
\$\$ LANGUAGE plpgsql");
            DB::unprepared('CREATE TRIGGER '.self::NAME.' BEFORE UPDATE ON payment_refunds FOR EACH ROW EXECUTE FUNCTION '.self::NAME.'()');

            return;
        }

        DB::unprepared('CREATE TRIGGER '.self::NAME." BEFORE UPDATE ON payment_refunds WHEN {$condition} BEGIN SELECT RAISE(ABORT, '".self::NAME."'); END");
    }

    public function down(): void
    {
        if (DB::table('payment_refunds')->whereIn('posting_status', ['posted', 'blocked_period'])->exists()) {
            throw new RuntimeException('Rollback refused: payment_refunds holds posted/blocked refunds. Fix forward instead.');
        }
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::unprepared('DROP TRIGGER IF EXISTS '.self::NAME.' ON payment_refunds');
            DB::unprepared('DROP FUNCTION IF EXISTS '.self::NAME.'()');

            return;
        }
        DB::unprepared('DROP TRIGGER IF EXISTS '.self::NAME);
    }
};
