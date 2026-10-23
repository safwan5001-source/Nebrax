<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * REM-18b-2 — السياج F1 على `invoices`: لا ICV بلا مدخل في سلسلة ZATCA المشتركة.
 *
 * **مُشغّلات فقط** — لا عمود ولا فهرس ولا تعديل لأي صف. تفرض القاعدة نفسها (لا الكود وحده، ولا علم إعداد ولا مسار تجاوز):
 *
 *  A  حين يكون للمستأجر رأس سلسلة (`zatca_chains`)، لا تُكتب قيمة `zatca_icv` (إدراجاً أو تغييراً) إلا ومعها مدخل في
 *     `zatca_chain_entries` للفاتورة نفسها بالقيم نفسها (icv وuuid والهاش السابق والهاش). `ZatcaChainAllocator` يُدرج
 *     المدخل قبل تحديث الفاتورة في المعاملة نفسها فيمرّ؛ أما الكاتب القديم (`max(invoices.zatca_icv)+1` بلا مدخل —
 *     نسخة تطبيق سابقة ما زالت تعمل أثناء النشر المتدرّج، أو سكربت) فيُرفض وتتراجع معاملة ترحيله كلها: **فشل مغلق، لا تفرّع**.
 *  B  فاتورة صدرت عبر السلسلة (لها مدخل) لا تتغيّر هويتها في السلسلة: `zatca_icv` و`zatca_uuid` و`zatca_previous_hash`.
 *
 * ═══ لماذا يُطبَّق A على المستأجر الذي له رأس سلسلة فقط؟ ═══
 *  قبل أول ترحيل عبر المخصِّص لا مدخل للمستأجر، فجدول `invoices` هو سلسلته الوحيدة، والكاتب القديم يكتب `max+1` نفسه الذي
 *  كانت ستبدأ منه البذرة. وحين يُنشأ الرأس يفرض المُشغّل T6 (REM-18b-1) أن تساوي بذرته `max(invoices.zatca_icv)` الحالي،
 *  فيُستوعب كل ما كتبه القديم قبلها. وبعد إنشائه لا يعود المستأجر بلا رأس أبداً (T7 يمنع الحذف). ولأن كل كاتب يقفل مِرساة
 *  المستأجر قبل حساب ICV، لا يتداخل كاتبان على مستأجرٍ واحد. فلسلامة السلسلة لا يحتاج السياج نافذة صيانة، ولا يُعطّل مستأجراً لم يبدأ سلسلته؛ أما نسخة قديمة تعمل أثناء النشر فترحيلها لمستأجرٍ بدأ سلسلته يفشل مغلقاً حتى تُستبدل.
 *
 * ═══ ما لا يمنعه عمداً ═══
 *  `zatca_xml` / `zatca_hash` / `zatca_qr` / `zatca_cleared_xml` بعد الصدور (كاليوم): مسار الإرسال يكتب `zatca_cleared_xml`،
 *  وفحوص ما قبل الإرسال تكشف أي تلاعب باللقطة. سلسلة PIH لا تتأثر بذلك: المخصِّص يقارن هاش XML المحفوظ بهاش المدخل الثابت
 *  ويفشل مغلقاً عند الاختلاف. تجميد XML نفسه في القاعدة قرار تصليب مستقل (تقرير REM-18b-2).
 *
 * **التراجع:** يرفض متى وُجد أي مدخل سلسلة — بعد أول فاتورة صدرت عبر المخصِّص لا يجوز الرجوع إلى كاتبٍ يحسب ICV من
 * `invoices` وحده (التغييرات إلى الأمام فقط). قبل ذلك (لا مدخل) يُسقط المُشغّلات فقط.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::unprepared(<<<'SQL'
                CREATE OR REPLACE FUNCTION invoices_zatca_chain_fence() RETURNS trigger LANGUAGE plpgsql AS $fn$
                BEGIN
                    IF TG_OP = 'UPDATE' AND OLD.zatca_icv IS NOT NULL
                        AND (NEW.zatca_icv IS DISTINCT FROM OLD.zatca_icv
                             OR NEW.zatca_uuid IS DISTINCT FROM OLD.zatca_uuid
                             OR NEW.zatca_previous_hash IS DISTINCT FROM OLD.zatca_previous_hash)
                        AND EXISTS (SELECT 1 FROM zatca_chain_entries e WHERE e.invoice_id = OLD.id)
                    THEN
                        RAISE EXCEPTION 'invoices: the ZATCA chain identity of an issued invoice is immutable';
                    END IF;

                    IF NEW.zatca_icv IS NOT NULL
                        AND (TG_OP = 'INSERT' OR NEW.zatca_icv IS DISTINCT FROM OLD.zatca_icv)
                        AND EXISTS (SELECT 1 FROM zatca_chains c WHERE c.tenant_id = NEW.tenant_id)
                        AND NOT EXISTS (
                            SELECT 1 FROM zatca_chain_entries e
                             WHERE e.invoice_id = NEW.id AND e.tenant_id = NEW.tenant_id AND e.icv = NEW.zatca_icv
                               AND e.zatca_uuid = NEW.zatca_uuid AND e.previous_hash = NEW.zatca_previous_hash
                               AND e.hash = NEW.zatca_hash
                        )
                    THEN
                        RAISE EXCEPTION 'invoices: ZATCA ICV written without a matching shared-chain entry';
                    END IF;

                    RETURN NEW;
                END
                $fn$
                SQL);
            DB::unprepared(
                'CREATE TRIGGER invoices_zatca_chain_fence BEFORE INSERT OR UPDATE OF zatca_icv, zatca_uuid, zatca_previous_hash, zatca_hash '
                .'ON invoices FOR EACH ROW EXECUTE FUNCTION invoices_zatca_chain_fence()'
            );

            return;
        }

        $match = <<<'SQL'
            NOT EXISTS (
                SELECT 1 FROM zatca_chain_entries e
                 WHERE e.invoice_id = NEW.id AND e.tenant_id = NEW.tenant_id AND e.icv = NEW.zatca_icv
                   AND e.zatca_uuid = NEW.zatca_uuid AND e.previous_hash = NEW.zatca_previous_hash AND e.hash = NEW.zatca_hash
            )
            SQL;

        DB::unprepared(<<<SQL
            CREATE TRIGGER invoices_zatca_chain_fence_insert BEFORE INSERT ON invoices
            WHEN NEW.zatca_icv IS NOT NULL
              AND EXISTS (SELECT 1 FROM zatca_chains c WHERE c.tenant_id = NEW.tenant_id)
              AND {$match}
            BEGIN
                SELECT RAISE(ABORT, 'invoices: ZATCA ICV written without a matching shared-chain entry');
            END
            SQL);

        DB::unprepared(<<<SQL
            CREATE TRIGGER invoices_zatca_chain_fence_update BEFORE UPDATE OF zatca_icv, zatca_uuid, zatca_previous_hash, zatca_hash ON invoices
            WHEN NEW.zatca_icv IS NOT NULL AND NEW.zatca_icv IS NOT OLD.zatca_icv
              AND EXISTS (SELECT 1 FROM zatca_chains c WHERE c.tenant_id = NEW.tenant_id)
              AND {$match}
            BEGIN
                SELECT RAISE(ABORT, 'invoices: ZATCA ICV written without a matching shared-chain entry');
            END
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER invoices_zatca_chain_identity BEFORE UPDATE OF zatca_icv, zatca_uuid, zatca_previous_hash ON invoices
            WHEN OLD.zatca_icv IS NOT NULL
              AND (NEW.zatca_icv IS NOT OLD.zatca_icv OR NEW.zatca_uuid IS NOT OLD.zatca_uuid
                   OR NEW.zatca_previous_hash IS NOT OLD.zatca_previous_hash)
              AND EXISTS (SELECT 1 FROM zatca_chain_entries e WHERE e.invoice_id = OLD.id)
            BEGIN
                SELECT RAISE(ABORT, 'invoices: the ZATCA chain identity of an issued invoice is immutable');
            END
            SQL);
    }

    public function down(): void
    {
        if (Schema::hasTable('zatca_chain_entries') && DB::table('zatca_chain_entries')->exists()) {
            throw new RuntimeException(
                'Rollback refused: invoices have been issued through the shared ZATCA chain. '
                .'Removing the fence would let an ICV be computed from invoices alone and reuse values already issued; '
                .'use a forward-only migration instead.'
            );
        }

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::unprepared('DROP TRIGGER IF EXISTS invoices_zatca_chain_fence ON invoices');
            DB::unprepared('DROP FUNCTION IF EXISTS invoices_zatca_chain_fence()');

            return;
        }

        foreach (['invoices_zatca_chain_fence_insert', 'invoices_zatca_chain_fence_update', 'invoices_zatca_chain_identity'] as $trigger) {
            DB::unprepared("DROP TRIGGER IF EXISTS {$trigger}");
        }
    }
};
