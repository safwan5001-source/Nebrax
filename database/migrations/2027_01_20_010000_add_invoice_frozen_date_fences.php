<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * P1-3b-2a-0 — تصليب ثبات تاريخي الفاتورة وقت الإصدار في **قاعدة البيانات**: مُشغّلات فقط (لا عمود ولا فهرس ولا تعديل لأي صف ولا Backfill).
 *
 * قبل هذه الهجرة كان ثبات `invoices.issued_at` و`invoices.party_snapshot` حارساً تطبيقياً فقط (`Invoice::booted`) يتجاوزه `DB::table`/Builder/SQL خام،
 * و`invoices.invoice_date` بلا حارس بعد الترحيل إلا أن خدمة التعديل ترفض الفاتورة غير المسودة. محرك ترحيل تسوية الورديات (P1-3b-2) يعتمد على هذه
 * التواريخ مصدراً وحيداً للتاريخين 3 و4 فلا يجوز أن يبقى ثباتها اتفاقاً.
 *
 * ═══ القواعد (لا تغيّر أي سلوك محاسبي قائم — يثبّته تدقيق الكتّاب في التقرير + الاختبارات) ═══
 *  R1  `issued_at`: متى كان مخزَّناً (ليس NULL) لا يتغيّر ولا يُمسح.
 *  R2  `issued_at`: لا يُكتب (من NULL) على فاتورة **ليست مسودة** — فلا ختم رجعي لفاتورة قديمة (لا Backfill). الكتابة الأولى تحدث في التحديث الذي يرحّل
 *      المسودة نفسه (`OLD.status = 'draft'`) وهو المسار الوحيد في `InvoiceService::post`.
 *  R3  `party_snapshot`: متى كانت مخزَّنة لا تتغيّر ولا تُمسح (مقارنة منطقية JSON على PostgreSQL، نصية على SQLite).
 *  R4  `party_snapshot`: لا تُكتب (من NULL) على فاتورة ليست مسودة (كالسابق).
 *  R5  `invoice_date`: لا يتغيّر بعد أن تخرج الفاتورة من حالة المسودة، ولا إن كانت لها لحظة إصدار.
 *
 * ═══ ما لا يفعله ═══
 *  لا يمنع الإدراج (الاختبارات والمهاجرات تُدرج صفوفاً مرحَّلة مباشرة)، ولا يحمي أعمدة أخرى (ZATCA لها سياج F1 مستقل)، ولا يتحقق من صيغة الطابع.
 *  لا يلمس `credit_notes` (لها حراسها F2). الصفوف التاريخية (قبل REM-13a/REM-14: NULL) تبقى صالحة وتقبل كل التحديثات الأخرى.
 *
 * ═══ التراجع ═══
 *  يسقط المُشغّلات والدالة فقط (لا يعتمد على صفوف): إسقاط حماية لا يترك البيانات غير متسقة.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            $this->createPostgres();
        } else {
            $this->createSqlite();
        }
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::unprepared('DROP TRIGGER IF EXISTS invoices_frozen_dates_fence ON invoices');
            DB::unprepared('DROP FUNCTION IF EXISTS invoices_frozen_dates_fence() CASCADE');

            return;
        }
        foreach (['invoices_frozen_dates_issued_at', 'invoices_frozen_dates_party_snapshot', 'invoices_frozen_dates_invoice_date'] as $trigger) {
            DB::unprepared("DROP TRIGGER IF EXISTS {$trigger}");
        }
    }

    private function createPostgres(): void
    {
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION invoices_frozen_dates_fence() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF OLD.issued_at IS NOT NULL AND NEW.issued_at IS DISTINCT FROM OLD.issued_at THEN
                    RAISE EXCEPTION 'invoices: issued_at is write-once and cannot be changed or cleared';
                END IF;
                IF OLD.issued_at IS NULL AND NEW.issued_at IS NOT NULL AND OLD.status <> 'draft' THEN
                    RAISE EXCEPTION 'invoices: issued_at cannot be stamped on an invoice that is no longer a draft';
                END IF;
                IF OLD.party_snapshot IS NOT NULL AND (NEW.party_snapshot IS NULL OR NEW.party_snapshot::jsonb IS DISTINCT FROM OLD.party_snapshot::jsonb) THEN
                    RAISE EXCEPTION 'invoices: party_snapshot is write-once and cannot be changed or cleared';
                END IF;
                IF OLD.party_snapshot IS NULL AND NEW.party_snapshot IS NOT NULL AND OLD.status <> 'draft' THEN
                    RAISE EXCEPTION 'invoices: party_snapshot cannot be stamped on an invoice that is no longer a draft';
                END IF;
                IF NEW.invoice_date IS DISTINCT FROM OLD.invoice_date AND (OLD.status <> 'draft' OR OLD.issued_at IS NOT NULL) THEN
                    RAISE EXCEPTION 'invoices: invoice_date cannot change once the invoice has left draft';
                END IF;
                RETURN NEW;
            END
            $fn$
            SQL);
        DB::unprepared(
            'CREATE TRIGGER invoices_frozen_dates_fence BEFORE UPDATE OF issued_at, party_snapshot, invoice_date ON invoices '
            .'FOR EACH ROW EXECUTE FUNCTION invoices_frozen_dates_fence()'
        );
    }

    private function createSqlite(): void
    {
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER invoices_frozen_dates_issued_at BEFORE UPDATE OF issued_at ON invoices
            WHEN (OLD.issued_at IS NOT NULL AND NEW.issued_at IS NOT OLD.issued_at)
              OR (OLD.issued_at IS NULL AND NEW.issued_at IS NOT NULL AND OLD.status <> 'draft')
            BEGIN
                SELECT RAISE(ABORT, 'invoices: issued_at is write-once and cannot be changed, cleared or stamped after draft');
            END
            SQL);
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER invoices_frozen_dates_party_snapshot BEFORE UPDATE OF party_snapshot ON invoices
            WHEN (OLD.party_snapshot IS NOT NULL AND NEW.party_snapshot IS NOT OLD.party_snapshot)
              OR (OLD.party_snapshot IS NULL AND NEW.party_snapshot IS NOT NULL AND OLD.status <> 'draft')
            BEGIN
                SELECT RAISE(ABORT, 'invoices: party_snapshot is write-once and cannot be changed, cleared or stamped after draft');
            END
            SQL);
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER invoices_frozen_dates_invoice_date BEFORE UPDATE OF invoice_date ON invoices
            WHEN NEW.invoice_date IS NOT OLD.invoice_date AND (OLD.status <> 'draft' OR OLD.issued_at IS NOT NULL)
            BEGIN
                SELECT RAISE(ABORT, 'invoices: invoice_date cannot change once the invoice has left draft');
            END
            SQL);
    }
};
