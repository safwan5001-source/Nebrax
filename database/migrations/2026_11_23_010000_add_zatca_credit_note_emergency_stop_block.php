<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * REM-18b-3d — سياسة الإيقاف الطارئ B على سياج الترحيل F2b: **مُشغّلات ودوال فقط** (لا عمود ولا فهرس ولا تعديل لأي صف).
 *
 * يستبدل جسم F2b المُنشأ في `2026_11_22_010000_add_zatca_credit_note_fences` **بالأسماء نفسها** (الدالة والمُشغّلات)، فيبقى
 * `down()` تلك الهجرة سليماً ويبقى كل ما يشير إليها (اختبارات التراجع) على حاله.
 *
 * ═══ الجدول (انتقال إشعار `sales` إلى `posted`، إدراجاً أو تحديثاً) ═══
 *    ضابط المستأجر │ إيقاف المنصة │ النتيجة
 *    غائب/معطَّل   │ أيّاً كان    │ ترحيل قديم بلا أي تغيير (لا قرار مطلوب)                                        [بلا تغيير]
 *    مفعَّل        │ لا           │ قرار صريح مطلوب (NULL أو disabled مرفوض)                                        [بلا تغيير — 3b]
 *    مفعَّل        │ **نعم**      │ **مرفوض كلياً**: لا قرار ولا disabled ولا not_generated ولا generated كامل   [جديد — B]
 *
 * لماذا يُرفض حتى المستند الكامل أثناء الإيقاف؟ الإيقاف غرضه وقف الإصدار؛ ولو أُبقي مسار `generated` لاستمر حجز ICV وتوقيع المستندات
 * أثناء ما قد يكون حادثاً (مفتاح مسرَّب مثلاً). والمرفوض يبقى مسودة قابلة للتعديل وإعادة الترحيل بعد رفع الإيقاف — لا تأجيل ولا طابور
 * ولا إصدار رجعي (S3/S4 بلا مساس).
 *
 * القراءة: عبارتا `EXISTS` عاديتان على `zatca_rollout_controls` بلا أي قفل (قراءة MVCC) — فلا حافة قفل جديدة ولا دورة. حدّ الاتساق هو آخر
 * حالة مثبَّتة وقت عبارة الترحيل (READ COMMITTED)؛ إيقاف يثبَّت بعد العبارة لا يُلغي مستنداً صدر كاملاً بمدخله، وهو السلوك المقصود (D-B3).
 *
 * ما لا يمسّه: F2a (S1–S5)، ضوابط التفعيل، السلسلة، القيد المحاسبي، المستأجر غير المفعَّل أو المعطَّل صراحةً.
 *
 * التراجع: يعيد أجسام 3b حرفياً (يرخّي القيد فقط، لا يمسّ بيانات) فهو آمن في أي وقت. ترتيب التراجع الحقيقي: هذه الهجرة ثم هجرة F2 (3b).
 * ترتيب النشر الموصى: الكود أولاً ثم هذه الهجرة — نسخة قديمة من المُصدِر أثناء إيقاف قائم تُرفض بخطأ قاعدة (500) بدل 422 (فشل مغلق، تراجع كامل).
 */
return new class extends Migration
{
    private const FEATURE = 'credit_note_issuance';

    private const STOP_MESSAGE = 'credit_notes: sales credit-note posting is blocked while the platform emergency stop is in force for an activated tenant';

    private const DECISION_MESSAGE = 'credit_notes: an activated tenant must record an explicit ZATCA issuance decision when posting a sales credit note';

    public function up(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            $this->postgres(withStopBlock: true);
        } else {
            $this->sqlite(withStopBlock: true);
        }
    }

    /** يعيد أجسام F2b كما كانت في 2026_11_22_010000 (بلا فرع الإيقاف). */
    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            $this->postgres(withStopBlock: false);
        } else {
            $this->sqlite(withStopBlock: false);
        }
    }

    private function postgres(bool $withStopBlock): void
    {
        $feature = self::FEATURE;
        $stop = self::STOP_MESSAGE;
        $decision = self::DECISION_MESSAGE;

        // الفرع الأول (B) يُدرَج فقط في up(). الجسم الثاني حرفياً من 3b.
        $stopBranch = $withStopBlock
            ? <<<SQL
                IF NEW.status = 'posted' AND NEW.type = 'sales'
                    AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'posted')
                    AND EXISTS (
                        SELECT 1 FROM zatca_rollout_controls c
                         WHERE c.scope = 'tenant' AND c.tenant_id = NEW.tenant_id AND c.feature_key = '{$feature}' AND c.enabled
                    )
                    AND EXISTS (
                        SELECT 1 FROM zatca_rollout_controls p
                         WHERE p.scope = 'platform' AND p.feature_key = '{$feature}' AND NOT p.enabled
                    )
                THEN
                    RAISE EXCEPTION '{$stop}';
                END IF;

            SQL
            : '';

        DB::unprepared(<<<SQL
            CREATE OR REPLACE FUNCTION credit_notes_zatca_posting_fence() RETURNS trigger LANGUAGE plpgsql AS \$fn\$
            BEGIN
            {$stopBranch}    IF NEW.status = 'posted' AND NEW.type = 'sales'
                    AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'posted')
                    AND (NEW.zatca_status IS NULL OR NEW.zatca_status = 'disabled')
                    AND EXISTS (
                        SELECT 1 FROM zatca_rollout_controls c
                         WHERE c.scope = 'tenant' AND c.tenant_id = NEW.tenant_id AND c.feature_key = '{$feature}' AND c.enabled
                    )
                    AND NOT EXISTS (
                        SELECT 1 FROM zatca_rollout_controls p
                         WHERE p.scope = 'platform' AND p.feature_key = '{$feature}' AND NOT p.enabled
                    )
                THEN
                    RAISE EXCEPTION '{$decision}';
                END IF;
                RETURN NEW;
            END
            \$fn\$
            SQL);
    }

    private function sqlite(bool $withStopBlock): void
    {
        $feature = self::FEATURE;
        $stop = self::STOP_MESSAGE;
        $decision = self::DECISION_MESSAGE;

        DB::unprepared('DROP TRIGGER IF EXISTS credit_notes_zatca_posting_insert');
        DB::unprepared('DROP TRIGGER IF EXISTS credit_notes_zatca_posting_update');

        if (! $withStopBlock) {
            // 3b حرفياً: شرط واحد ورسالة واحدة.
            $activated = <<<SQL
                NEW.status = 'posted' AND NEW.type = 'sales'
                AND (NEW.zatca_status IS NULL OR NEW.zatca_status = 'disabled')
                AND EXISTS (
                    SELECT 1 FROM zatca_rollout_controls c
                     WHERE c.scope = 'tenant' AND c.tenant_id = NEW.tenant_id AND c.feature_key = '{$feature}' AND c.enabled
                )
                AND NOT EXISTS (
                    SELECT 1 FROM zatca_rollout_controls p
                     WHERE p.scope = 'platform' AND p.feature_key = '{$feature}' AND p.enabled = 0
                )
                SQL;
            DB::unprepared(<<<SQL
                CREATE TRIGGER credit_notes_zatca_posting_insert BEFORE INSERT ON credit_notes
                WHEN {$activated}
                BEGIN
                    SELECT RAISE(ABORT, '{$decision}');
                END
                SQL);
            DB::unprepared(<<<SQL
                CREATE TRIGGER credit_notes_zatca_posting_update BEFORE UPDATE OF status, type, zatca_status ON credit_notes
                WHEN OLD.status IS NOT 'posted' AND {$activated}
                BEGIN
                    SELECT RAISE(ABORT, '{$decision}');
                END
                SQL);

            return;
        }

        // B: مستأجر مفعَّل ⇒ إيقاف المنصة يرفض كل شيء؛ بلا إيقاف ⇒ قاعدة 3b. (RAISE داخل CASE مسموح في برنامج المُشغّل.)
        $enabledTenant = <<<SQL
            NEW.status = 'posted' AND NEW.type = 'sales'
            AND EXISTS (
                SELECT 1 FROM zatca_rollout_controls c
                 WHERE c.scope = 'tenant' AND c.tenant_id = NEW.tenant_id AND c.feature_key = '{$feature}' AND c.enabled
            )
            SQL;
        $body = <<<SQL
            SELECT CASE
                WHEN EXISTS (
                    SELECT 1 FROM zatca_rollout_controls p
                     WHERE p.scope = 'platform' AND p.feature_key = '{$feature}' AND p.enabled = 0
                ) THEN RAISE(ABORT, '{$stop}')
                WHEN (NEW.zatca_status IS NULL OR NEW.zatca_status = 'disabled') THEN RAISE(ABORT, '{$decision}')
            END;
            SQL;
        DB::unprepared(<<<SQL
            CREATE TRIGGER credit_notes_zatca_posting_insert BEFORE INSERT ON credit_notes
            WHEN {$enabledTenant}
            BEGIN
                {$body}
            END
            SQL);
        DB::unprepared(<<<SQL
            CREATE TRIGGER credit_notes_zatca_posting_update BEFORE UPDATE OF status, type, zatca_status ON credit_notes
            WHEN OLD.status IS NOT 'posted' AND {$enabledTenant}
            BEGIN
                {$body}
            END
            SQL);
    }
};
