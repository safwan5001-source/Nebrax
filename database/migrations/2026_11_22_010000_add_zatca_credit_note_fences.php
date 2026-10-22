<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * REM-18b-3b — السياج F2 على `credit_notes` لقرار إصدار ZATCA ومستنده: **مُشغّلات فقط** (لا عمود ولا فهرس ولا تعديل لأي صف).
 *
 * لا يُصدر شيئاً ولا يُفعّل شيئاً: لا يكتب أي كود هذه الأعمدة بعد (إصدار الإشعار = REM-18b-3c)، والسياج يحمي الحالة قبل ذلك ويفرض ما
 * سيلتزم به المُصدِر لاحقاً. الإشعارات التاريخية (كل أعمدة ZATCA فيها NULL) تبقى صالحة بلا مدخل سلسلة وبلا أي تعديل.
 *
 * ═══ F2a — سلامة القرار والمستند الصادر ═══
 *  S1  `zatca_status` ∈ {NULL, generated, not_generated, disabled} مع تناسق الأعمدة:
 *        NULL          ⇒ لا مخرجات (uuid/icv/previous_hash/hash/qr/xml) ولا `zatca_skip_reason`.
 *        generated     ⇒ مستند كامل (النوع standard|simplified، رمز السبب، لحظة الإصدار، لقطة الطرفين، uuid، icv>0، PIH، الهاش، QR، XML)
 *                        بلا `zatca_skip_reason`، والإشعار `sales` و`status = posted`.
 *        not_generated ⇒ `zatca_skip_reason` صريح غير فارغ، ولا مخرجات.
 *        disabled      ⇒ لا مخرجات.
 *      إشعار المشتريات (`type = purchase`) لا يحمل أي قيمة ZATCA إطلاقاً (سلوكه القائم لا يتغيّر).
 *  S2  `generated` يشترط **مدخل سلسلة مطابقاً** في `zatca_chain_entries`: الإشعار نفسه والمستأجر نفسه ونوع المستند 381 وICV وUUID وPIH والهاش والصنف
 *      (standard|simplified). المخصِّص يُدرج المدخل قبل تحديث الإشعار في المعاملة نفسها (كالفواتير)، فيُرفض أي ICV بلا مدخل مطابق.
 *  S3  **التجميد:** متى سُجّل قرار (`zatca_status` ليس NULL) لا يتغيّر أي عمود من أعمدة ZATCA الاثني عشر ولا `tenant_id`/`id` أبداً — فلا يتحوّل `generated` إلى حالة أخرى،
 *      ولا `disabled`/`not_generated` إلى `generated` (لا إصدار رجعي)، ولا يُعدَّل XML أو هاش أو QR أو لقطة صدرت.
 *  S4  **لا قرار على إشعار مرحَّل بعد:** `zatca_status` لا يُكتب (من NULL) على إشعار حالته `posted` أصلاً؛ يُكتب قبل الترحيل أو في التحديث نفسه الذي يرحّله.
 *      فلا إصدار رجعي ولا Backfill للإشعارات المرحَّلة سابقاً.
 *  S5  **الحذف:** لا يُحذف إشعار صدر (`generated` أو له ICV أو مدخل) ما دام صف مستأجره موجوداً (حذف المستأجر المتسلسل يمرّ كبقية جداوله).
 *
 * ═══ F2b — سياج الترحيل (يقرأ ضوابط REM-18b-3a) ═══
 *  عند **انتقال** إشعار `sales` إلى `posted` (تحديث أو إدراج) يُرفض إن كان التفعيل الفعّال لمستأجره قائماً **و**لا قرار صريحاً عليه
 *  (`zatca_status IS NULL`) — أو كان القرار `disabled` (تفعيل قائم لا يُسجَّل «معطّلاً»: لا تخفيض صامت).
 *  التفعيل الفعّال = ضابط المستأجر `enabled` **و**لا إيقاف طارئ للمنصة (صفّ منصة `enabled = false`) — بعبارة SQL واحدة بلا قفل؛ غياب ضابط المستأجر = معطّل.
 *  حين لا تفعيل يبقى الترحيل القديم كما هو (بلا قرار)، فلا يتغيّر شيء لأي مستأجر قائم. نسخة تطبيق سابقة لا تكتب قراراً فيفشل ترحيلها لمستأجرٍ مفعَّل
 *  مغلقاً بعد تفعيله (ولا تفعيل بالنشر). لا يمسّ إشعارات المشتريات ولا الإشعارات المرحَّلة سابقاً (الفحص عند الانتقال إلى posted فقط).
 *
 * ═══ ما لا يفعله ═══
 *  لا يجمّد أعمدة الإشعار غير ZATCA، ولا يتحقق من تطابق `issued_at` مع المدخل (صيغة الطابع الزمني تختلف بين المحرّكين)، ولا يفرض قيد تسليم مؤجَّل بين
 *  المدخل والإشعار (SQLite بلا مُشغّلات مؤجَّلة؛ المعاملة الذرّية للمُصدِر هي الضمان). لا يقرأ الضوابط قفلاً ولا يكتبها.
 *
 * ═══ التراجع ═══
 *  يرفض متى وُجد أي إشعار بـ`zatca_status` غير NULL أو أي مدخل سلسلة لإشعار (القرارات والمستندات الصادرة لا تُترك بلا حماية بالتراجع)؛ وإلا يُسقط
 *  المُشغّلات والدوال فقط. الترتيب الحقيقي للتراجع: هذه الهجرة أولاً (تقرأ جداول السلسلة والضوابط)، ثم ضوابط التفعيل، ثم أعمدة الإشعار والسلسلة.
 */
return new class extends Migration
{
    private const ZATCA_COLUMNS = [
        'zatca_status', 'zatca_skip_reason', 'zatca_document_type', 'zatca_reason_code', 'issued_at', 'party_snapshot',
        'zatca_uuid', 'zatca_icv', 'zatca_previous_hash', 'zatca_hash', 'zatca_qr', 'zatca_xml',
    ];

    private const ARTIFACTS = ['zatca_uuid', 'zatca_icv', 'zatca_previous_hash', 'zatca_hash', 'zatca_qr', 'zatca_xml'];

    private const FEATURE = 'credit_note_issuance';

    public function up(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            $this->createPostgresFences();
        } else {
            $this->createSqliteFences();
        }
    }

    public function down(): void
    {
        $decided = Schema::hasTable('credit_notes') && Schema::hasColumn('credit_notes', 'zatca_status')
            && DB::table('credit_notes')->whereNotNull('zatca_status')->exists();
        $entries = Schema::hasTable('zatca_chain_entries') && DB::table('zatca_chain_entries')->where('document_type', 'credit_note')->exists();
        if ($decided || $entries) {
            throw new RuntimeException(
                'Rollback refused: credit notes carry a ZATCA decision or issued document. '
                .'Removing the F2 fences would leave them unprotected; use a forward-only migration instead.'
            );
        }

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::unprepared('DROP TRIGGER IF EXISTS credit_notes_zatca_fence ON credit_notes');
            DB::unprepared('DROP TRIGGER IF EXISTS credit_notes_zatca_posting_fence ON credit_notes');
            DB::unprepared('DROP TRIGGER IF EXISTS credit_notes_zatca_no_delete ON credit_notes');
            foreach (['credit_notes_zatca_fence', 'credit_notes_zatca_posting_fence', 'credit_notes_zatca_guard_delete'] as $function) {
                DB::unprepared("DROP FUNCTION IF EXISTS {$function}()");
            }

            return;
        }

        foreach ([
            'credit_notes_zatca_shape_insert', 'credit_notes_zatca_shape_update', 'credit_notes_zatca_entry_insert', 'credit_notes_zatca_entry_update',
            'credit_notes_zatca_frozen', 'credit_notes_zatca_retroactive', 'credit_notes_zatca_posting_insert', 'credit_notes_zatca_posting_update',
            'credit_notes_zatca_no_delete',
        ] as $trigger) {
            DB::unprepared("DROP TRIGGER IF EXISTS {$trigger}");
        }
    }

    private function createPostgresFences(): void
    {
        $columns = implode(', ', self::ZATCA_COLUMNS);

        // F2a + S1…S4. المقارنة بالنص لـ`party_snapshot` (نوع json بلا معامل مساواة). رسائل ثابتة بلا قيم.
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION credit_notes_zatca_fence() RETURNS trigger LANGUAGE plpgsql AS $fn$
            DECLARE
                has_artifacts boolean;
            BEGIN
                IF TG_OP = 'UPDATE' THEN
                    -- S3: القرار المسجَّل وما صدر معه لا يتغيّر.
                    IF OLD.zatca_status IS NOT NULL THEN
                        IF NEW.zatca_status IS DISTINCT FROM OLD.zatca_status
                            OR NEW.zatca_skip_reason IS DISTINCT FROM OLD.zatca_skip_reason
                            OR NEW.zatca_document_type IS DISTINCT FROM OLD.zatca_document_type
                            OR NEW.zatca_reason_code IS DISTINCT FROM OLD.zatca_reason_code
                            OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
                            OR NEW.party_snapshot::text IS DISTINCT FROM OLD.party_snapshot::text
                            OR NEW.zatca_uuid IS DISTINCT FROM OLD.zatca_uuid
                            OR NEW.zatca_icv IS DISTINCT FROM OLD.zatca_icv
                            OR NEW.zatca_previous_hash IS DISTINCT FROM OLD.zatca_previous_hash
                            OR NEW.zatca_hash IS DISTINCT FROM OLD.zatca_hash
                            OR NEW.zatca_qr IS DISTINCT FROM OLD.zatca_qr
                            OR NEW.zatca_xml IS DISTINCT FROM OLD.zatca_xml
                            OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
                            OR NEW.id IS DISTINCT FROM OLD.id
                        THEN
                            RAISE EXCEPTION 'credit_notes: the ZATCA decision and issued document are immutable';
                        END IF;
                    ELSIF NEW.zatca_status IS NOT NULL AND OLD.status = 'posted' THEN
                        -- S4: لا إصدار رجعي على إشعار مرحَّل أصلاً.
                        RAISE EXCEPTION 'credit_notes: a ZATCA decision cannot be recorded on an already posted credit note';
                    END IF;
                END IF;

                -- إشعار المشتريات بلا أي قيمة ZATCA.
                IF NEW.type = 'purchase' AND (
                    NEW.zatca_status IS NOT NULL OR NEW.zatca_skip_reason IS NOT NULL OR NEW.zatca_document_type IS NOT NULL
                    OR NEW.zatca_reason_code IS NOT NULL OR NEW.issued_at IS NOT NULL OR NEW.party_snapshot IS NOT NULL
                    OR NEW.zatca_uuid IS NOT NULL OR NEW.zatca_icv IS NOT NULL OR NEW.zatca_previous_hash IS NOT NULL
                    OR NEW.zatca_hash IS NOT NULL OR NEW.zatca_qr IS NOT NULL OR NEW.zatca_xml IS NOT NULL
                ) THEN
                    RAISE EXCEPTION 'credit_notes: purchase credit notes carry no ZATCA data';
                END IF;

                -- S1: تناسق الحالة مع الأعمدة.
                has_artifacts := NEW.zatca_uuid IS NOT NULL OR NEW.zatca_icv IS NOT NULL OR NEW.zatca_previous_hash IS NOT NULL
                    OR NEW.zatca_hash IS NOT NULL OR NEW.zatca_qr IS NOT NULL OR NEW.zatca_xml IS NOT NULL;

                IF NEW.zatca_status IS NULL THEN
                    IF has_artifacts OR NEW.zatca_skip_reason IS NOT NULL THEN
                        RAISE EXCEPTION 'credit_notes: ZATCA artifacts require a recorded generated decision';
                    END IF;
                ELSIF NEW.zatca_status = 'generated' THEN
                    IF NEW.zatca_skip_reason IS NOT NULL
                        OR NEW.type IS DISTINCT FROM 'sales' OR NEW.status IS DISTINCT FROM 'posted'
                        OR NEW.zatca_document_type IS NULL OR NEW.zatca_document_type NOT IN ('standard','simplified')
                        OR COALESCE(btrim(NEW.zatca_reason_code), '') = ''
                        OR NEW.issued_at IS NULL OR NEW.party_snapshot IS NULL
                        OR NEW.zatca_uuid IS NULL
                        OR NEW.zatca_icv IS NULL OR NEW.zatca_icv <= 0
                        OR COALESCE(btrim(NEW.zatca_previous_hash), '') = ''
                        OR COALESCE(btrim(NEW.zatca_hash), '') = ''
                        OR COALESCE(btrim(NEW.zatca_qr), '') = ''
                        OR COALESCE(btrim(NEW.zatca_xml), '') = ''
                    THEN
                        RAISE EXCEPTION 'credit_notes: a generated ZATCA credit note needs a complete issued document on a posted sales note';
                    END IF;

                    -- S2: مدخل سلسلة مطابق (المصدر الوحيد لـICV/PIH).
                    IF NOT EXISTS (
                        SELECT 1 FROM zatca_chain_entries e
                         WHERE e.credit_note_id = NEW.id AND e.tenant_id = NEW.tenant_id
                           AND e.document_type = 'credit_note' AND e.type_code = '381'
                           AND e.icv = NEW.zatca_icv AND e.zatca_uuid = NEW.zatca_uuid
                           AND e.previous_hash = NEW.zatca_previous_hash AND e.hash = NEW.zatca_hash
                           AND e.subtype = NEW.zatca_document_type
                    ) THEN
                        RAISE EXCEPTION 'credit_notes: ZATCA document written without a matching shared-chain entry';
                    END IF;
                ELSIF NEW.zatca_status = 'not_generated' THEN
                    IF has_artifacts OR COALESCE(btrim(NEW.zatca_skip_reason), '') = '' THEN
                        RAISE EXCEPTION 'credit_notes: a not_generated decision needs an explicit skip reason and no artifacts';
                    END IF;
                ELSE
                    IF has_artifacts THEN
                        RAISE EXCEPTION 'credit_notes: a disabled decision carries no artifacts';
                    END IF;
                END IF;

                RETURN NEW;
            END
            $fn$
            SQL);
        DB::unprepared(
            "CREATE TRIGGER credit_notes_zatca_fence BEFORE INSERT OR UPDATE OF {$columns}, status, type, tenant_id, id ON credit_notes "
            .'FOR EACH ROW EXECUTE FUNCTION credit_notes_zatca_fence()'
        );

        // F2b: سياج الترحيل. التفعيل الفعّال بعبارة واحدة بلا قفل (ضابط المستأجر مفعَّل ولا إيقاف منصة).
        $feature = self::FEATURE;
        DB::unprepared(<<<SQL
            CREATE OR REPLACE FUNCTION credit_notes_zatca_posting_fence() RETURNS trigger LANGUAGE plpgsql AS \$fn\$
            BEGIN
                IF NEW.status = 'posted' AND NEW.type = 'sales'
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
                    RAISE EXCEPTION 'credit_notes: an activated tenant must record an explicit ZATCA issuance decision when posting a sales credit note';
                END IF;
                RETURN NEW;
            END
            \$fn\$
            SQL);
        DB::unprepared(
            'CREATE TRIGGER credit_notes_zatca_posting_fence BEFORE INSERT OR UPDATE OF status, type, zatca_status ON credit_notes '
            .'FOR EACH ROW EXECUTE FUNCTION credit_notes_zatca_posting_fence()'
        );

        // S5: لا حذف لإشعار صدر ما دام مستأجره موجوداً.
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION credit_notes_zatca_guard_delete() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id)
                    AND (OLD.zatca_status = 'generated' OR OLD.zatca_icv IS NOT NULL
                         OR EXISTS (SELECT 1 FROM zatca_chain_entries e WHERE e.credit_note_id = OLD.id))
                THEN
                    RAISE EXCEPTION 'credit_notes: an issued ZATCA credit note cannot be deleted';
                END IF;
                RETURN OLD;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER credit_notes_zatca_no_delete BEFORE DELETE ON credit_notes FOR EACH ROW EXECUTE FUNCTION credit_notes_zatca_guard_delete()');
    }

    private function createSqliteFences(): void
    {
        $updateColumns = implode(', ', self::ZATCA_COLUMNS);
        $changed = implode(' OR ', array_map(fn (string $column) => "NEW.{$column} IS NOT OLD.{$column}", [...self::ZATCA_COLUMNS, 'tenant_id', 'id']));
        $anyZatca = implode(' OR ', array_map(fn (string $column) => "NEW.{$column} IS NOT NULL", self::ZATCA_COLUMNS));
        $artifacts = implode(' OR ', array_map(fn (string $column) => "NEW.{$column} IS NOT NULL", self::ARTIFACTS));
        $blank = fn (string $column) => "COALESCE(trim(NEW.{$column}), '') = ''";

        // S1 (مجمَّعة): كل حالة ممنوعة في شرط واحد. NULL في الحالة لا يطابق أيّاً من فروع generated/not_generated/disabled.
        $shape = <<<SQL
            (NEW.type = 'purchase' AND ({$anyZatca}))
            OR (NEW.zatca_status IS NULL AND (({$artifacts}) OR NEW.zatca_skip_reason IS NOT NULL))
            OR (NEW.zatca_status = 'generated' AND (
                NEW.zatca_skip_reason IS NOT NULL
                OR NEW.type IS NOT 'sales' OR NEW.status IS NOT 'posted'
                OR NEW.zatca_document_type IS NULL OR NEW.zatca_document_type NOT IN ('standard','simplified')
                OR {$blank('zatca_reason_code')}
                OR NEW.issued_at IS NULL OR NEW.party_snapshot IS NULL
                OR NEW.zatca_uuid IS NULL
                OR NEW.zatca_icv IS NULL OR NEW.zatca_icv <= 0
                OR {$blank('zatca_previous_hash')} OR {$blank('zatca_hash')} OR {$blank('zatca_qr')} OR {$blank('zatca_xml')}
            ))
            OR (NEW.zatca_status = 'not_generated' AND (({$artifacts}) OR {$blank('zatca_skip_reason')}))
            OR (NEW.zatca_status = 'disabled' AND ({$artifacts}))
            SQL;

        // S2: `generated` بلا مدخل سلسلة مطابق.
        $entryMissing = <<<'SQL'
            NEW.zatca_status = 'generated' AND NOT EXISTS (
                SELECT 1 FROM zatca_chain_entries e
                 WHERE e.credit_note_id = NEW.id AND e.tenant_id = NEW.tenant_id
                   AND e.document_type = 'credit_note' AND e.type_code = '381'
                   AND e.icv = NEW.zatca_icv AND e.zatca_uuid = NEW.zatca_uuid
                   AND e.previous_hash = NEW.zatca_previous_hash AND e.hash = NEW.zatca_hash
                   AND e.subtype = NEW.zatca_document_type
            )
            SQL;

        foreach (['INSERT' => 'insert', "UPDATE OF {$updateColumns}, status, type, tenant_id, id" => 'update'] as $event => $suffix) {
            DB::unprepared(<<<SQL
                CREATE TRIGGER credit_notes_zatca_shape_{$suffix} BEFORE {$event} ON credit_notes
                WHEN {$shape}
                BEGIN
                    SELECT RAISE(ABORT, 'credit_notes: invalid ZATCA state for this credit note');
                END
                SQL);
            DB::unprepared(<<<SQL
                CREATE TRIGGER credit_notes_zatca_entry_{$suffix} BEFORE {$event} ON credit_notes
                WHEN {$entryMissing}
                BEGIN
                    SELECT RAISE(ABORT, 'credit_notes: ZATCA document written without a matching shared-chain entry');
                END
                SQL);
        }

        // S3
        DB::unprepared(<<<SQL
            CREATE TRIGGER credit_notes_zatca_frozen BEFORE UPDATE OF {$updateColumns}, tenant_id, id ON credit_notes
            WHEN OLD.zatca_status IS NOT NULL AND ({$changed})
            BEGIN
                SELECT RAISE(ABORT, 'credit_notes: the ZATCA decision and issued document are immutable');
            END
            SQL);

        // S4
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER credit_notes_zatca_retroactive BEFORE UPDATE OF zatca_status ON credit_notes
            WHEN OLD.zatca_status IS NULL AND NEW.zatca_status IS NOT NULL AND OLD.status = 'posted'
            BEGIN
                SELECT RAISE(ABORT, 'credit_notes: a ZATCA decision cannot be recorded on an already posted credit note');
            END
            SQL);

        // F2b
        $feature = self::FEATURE;
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
                SELECT RAISE(ABORT, 'credit_notes: an activated tenant must record an explicit ZATCA issuance decision when posting a sales credit note');
            END
            SQL);
        DB::unprepared(<<<SQL
            CREATE TRIGGER credit_notes_zatca_posting_update BEFORE UPDATE OF status, type, zatca_status ON credit_notes
            WHEN OLD.status IS NOT 'posted' AND {$activated}
            BEGIN
                SELECT RAISE(ABORT, 'credit_notes: an activated tenant must record an explicit ZATCA issuance decision when posting a sales credit note');
            END
            SQL);

        // S5
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER credit_notes_zatca_no_delete BEFORE DELETE ON credit_notes
            WHEN EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id)
              AND (OLD.zatca_status = 'generated' OR OLD.zatca_icv IS NOT NULL
                   OR EXISTS (SELECT 1 FROM zatca_chain_entries e WHERE e.credit_note_id = OLD.id))
            BEGIN
                SELECT RAISE(ABORT, 'credit_notes: an issued ZATCA credit note cannot be deleted');
            END
            SQL);
    }
};
