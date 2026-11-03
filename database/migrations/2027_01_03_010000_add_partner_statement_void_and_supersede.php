<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * IMP-PS-A3e — إبطال المطابقة المغلقة (`closed → voided`) واستبدالها الصريح (`closed → superseded`) مع إفراج المطالبات. **إضافي: لا مساس بالأستاذ ولا بأي مستند، ولا مفتاح أجنبي إلى جداول الأستاذ.**
 *
 *  - `partner_statement_reconciliations`: `voided_at/voided_by/void_reason` (يُكتبان مع الإبطال **والاستبدال**: الفاعل والوقت والسبب) و`superseded_by_id` (المقارنة البديلة؛ فارغ عند الإبطال المجرد). الحالتان طرفيتان.
 *    حراس القاعدة: الانتقال الوحيد المسموح من `closed` هو إلى `voided`/`superseded` ولا يكون إلا **بعد حدث تدقيق مطابق** (`void`/`supersede`: الفاعل والسبب وتشغيلة الإغلاق وعدد المطالبات المفرَج عنها، وللاستبدال المقارنة
 *    البديلة)؛ بيانات المراجعة والإغلاق **تبقى** (تاريخ المطابقة الأصلية قابل للتدقيق)؛ الصف `voided`/`superseded` لا يُعدَّل؛ الإدراج لا يكون بهذه الحالات أبداً.
 *  - **الإفراج بالقاعدة نفسها لا بالخدمة وحدها:** مُشغّل `AFTER UPDATE` عند الانتقال يضع `released_at = voided_at` لكل مطالبة فعّالة للمقارنة — فلا يترك أي مسار (حتى SQL خام) مقارنة مبطلة بمطالبات فعّالة، ولا تُفرَج مطالبة بغير ذلك.
 *    مُشغّل تحديث المطالبات يسمح بشيء واحد فقط: `released_at` من NULL إلى وقت إبطال/استبدال مقارنتها (بلا تغيير لأي عمود آخر، ولا عودة)؛ والحذف والتفريغ ما زالا ممنوعين. الفهرس الفريد الجزئي (`WHERE released_at IS NULL`) يحرّر القيد
 *    تلقائياً لمطالبة جديدة بعد الإفراج فقط — فلا إعادة استعمال قبل نجاح الإبطال/الاستبدال، ويبقى منع المطالبة المزدوجة.
 *  - `partner_statement_reconciliation_events`: عمود `related_reconciliation_id` (ربط الأصل بالبديل في سجل التدقيق) وإجراءان `void`/`supersede`. على PostgreSQL قيد مؤجَّل يتحقق عند الالتزام أن البديلة صارت `closed` (الذرّية تتجاوز الخدمة).
 * `down()` يرفض إن وُجدت مقارنة مبطلة/مستبدَلة أو حدث إبطال/استبدال أو مطالبة مفرَج عنها، ثم يعيد أجسام A3d نفسها بالانعكاس (لا نسخة ثانية منها).
 */
return new class extends Migration
{
    private const RECON = 'partner_statement_reconciliations';

    private const EVENTS = 'partner_statement_reconciliation_events';

    private const CLAIMS = 'partner_statement_unit_claims';

    private const A3D = 'database/migrations/2027_01_02_010000_add_partner_statement_final_claims.php';

    public function up(): void
    {
        Schema::table(self::RECON, function (Blueprint $table) {
            $table->timestamp('voided_at')->nullable();
            $table->uuid('voided_by')->nullable();           // مرجع تدقيق بلا مفتاح أجنبي (كـ closed_by)
            $table->string('void_reason', 500)->nullable();
            $table->uuid('superseded_by_id')->nullable();    // المقارنة البديلة (استبدال) — فارغ عند الإبطال المجرد
        });
        Schema::table(self::EVENTS, function (Blueprint $table) {
            $table->uuid('related_reconciliation_id')->nullable();
        });

        if (DB::connection()->getDriverName() === 'pgsql') {
            $this->postgresUp();
        } else {
            $this->sqliteUp();
        }
    }

    public function down(): void
    {
        if (DB::table(self::RECON)->whereIn('status', ['voided', 'superseded'])->exists()
            || DB::table(self::EVENTS)->whereIn('action', ['void', 'supersede'])->exists()
            || DB::table(self::CLAIMS)->whereNotNull('released_at')->exists()) {
            throw new RuntimeException('لا يُتراجع عن الإبطال/الاستبدال وفيه مقارنات مبطلة أو مستبدَلة أو أحداث أو مطالبات مفرَج عنها (سجل تدقيق لا يُحذف).');
        }

        $a3d = require base_path(self::A3D);
        if (DB::connection()->getDriverName() === 'pgsql') {
            foreach (['partner_stmt_recon_release', 'partner_stmt_recon_deferred_replacement'] as $trigger) {
                DB::statement("DROP TRIGGER IF EXISTS {$trigger} ON ".self::RECON);
            }
            foreach (['partner_stmt_claim_insert_guard', 'partner_stmt_claim_release_guard', 'partner_stmt_claim_no_delete', 'partner_stmt_claim_no_truncate'] as $trigger) {
                DB::statement("DROP TRIGGER IF EXISTS {$trigger} ON ".self::CLAIMS);
            }
            DB::statement('ALTER TABLE '.self::CLAIMS.' DROP CONSTRAINT IF EXISTS partner_stmt_claim_shape_chk');
            foreach (['partner_stmt_recon_release_claims', 'partner_stmt_recon_deferred_replacement'] as $function) {
                DB::statement("DROP FUNCTION IF EXISTS {$function}()");
            }
            $this->callA3d($a3d, 'postgresGuards');
        } else {
            foreach (['partner_stmt_recon_release', 'partner_stmt_claim_release_guard', 'partner_stmt_claim_shape', 'partner_stmt_claim_insert_guard', 'partner_stmt_claim_no_delete', 'partner_stmt_event_void_policy', 'partner_stmt_event_void_separation'] as $trigger) {
                DB::unprepared("DROP TRIGGER IF EXISTS {$trigger}");
            }
            $this->callA3d($a3d, 'sqliteGuards');
        }

        Schema::table(self::EVENTS, fn (Blueprint $table) => $table->dropColumn(['related_reconciliation_id']));
        Schema::table(self::RECON, fn (Blueprint $table) => $table->dropColumn(['voided_at', 'voided_by', 'void_reason', 'superseded_by_id']));
    }

    /** يعيد أجسام A3d (CHECK/دوال/مُشغّلات) بتنفيذ مولّدها نفسه — لا نسخة ثانية منه. */
    private function callA3d(object $a3d, string $method): void
    {
        $reflection = new ReflectionMethod($a3d, $method);
        $reflection->setAccessible(true);
        $reflection->invoke($a3d, true);
    }

    // ═══════════════════════════════ PostgreSQL ═══════════════════════════════

    private function postgresUp(): void
    {
        DB::statement('DROP TRIGGER IF EXISTS partner_stmt_recon_guard ON '.self::RECON);
        DB::statement('DROP TRIGGER IF EXISTS partner_stmt_recon_insert_guard ON '.self::RECON);
        DB::statement('DROP TRIGGER IF EXISTS partner_stmt_event_insert_guard ON '.self::EVENTS);
        DB::statement('DROP TRIGGER IF EXISTS partner_stmt_claim_no_update ON '.self::CLAIMS);
        DB::statement('DROP TRIGGER IF EXISTS partner_stmt_claim_insert_guard ON '.self::CLAIMS);
        DB::statement('ALTER TABLE '.self::RECON.' DROP CONSTRAINT IF EXISTS partner_stmt_recon_lifecycle_chk');
        DB::statement('ALTER TABLE '.self::EVENTS.' DROP CONSTRAINT IF EXISTS partner_stmt_event_shape_chk');
        DB::statement('ALTER TABLE '.self::CLAIMS.' DROP CONSTRAINT IF EXISTS partner_stmt_claim_shape_chk');

        $reviewed = 'reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL AND reviewed_run_id IS NOT NULL';
        $closed = 'closed_at IS NOT NULL AND closed_by IS NOT NULL AND scope_key IS NOT NULL AND closed_by <> reviewed_by';
        $noVoid = 'voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL AND superseded_by_id IS NULL';
        $voidedBase = 'voided_at IS NOT NULL AND voided_by IS NOT NULL AND void_reason IS NOT NULL AND char_length(btrim(void_reason)) >= 3';
        DB::statement(<<<SQL
            ALTER TABLE partner_statement_reconciliations
                ADD CONSTRAINT partner_stmt_recon_lifecycle_chk CHECK (
                    (status = 'draft' AND reviewed_at IS NULL AND reviewed_by IS NULL AND reviewed_run_id IS NULL AND closed_at IS NULL AND closed_by IS NULL AND scope_key IS NULL AND {$noVoid})
                    OR (status = 'reviewed' AND {$reviewed} AND closed_at IS NULL AND closed_by IS NULL AND scope_key IS NULL AND {$noVoid})
                    OR (status = 'closed' AND {$reviewed} AND {$closed} AND {$noVoid})
                    OR (status = 'voided' AND {$reviewed} AND {$closed} AND {$voidedBase} AND superseded_by_id IS NULL)
                    OR (status = 'superseded' AND {$reviewed} AND {$closed} AND {$voidedBase} AND superseded_by_id IS NOT NULL AND superseded_by_id <> id)
                )
            SQL);

        DB::statement(<<<'SQL'
            ALTER TABLE partner_statement_reconciliation_events
                ADD CONSTRAINT partner_stmt_event_shape_chk CHECK (
                    seq >= 1
                    AND (
                        (action = 'mark_reviewed' AND from_status = 'draft' AND to_status = 'reviewed'
                            AND run_id IS NOT NULL AND ledger_fingerprint IS NOT NULL AND statement_digest IS NOT NULL
                            AND reviewer_id IS NULL AND claims_count IS NULL AND related_reconciliation_id IS NULL)
                        OR (action = 'reopen' AND from_status = 'reviewed' AND to_status = 'draft'
                            AND reason IS NOT NULL AND char_length(btrim(reason)) >= 3
                            AND reviewer_id IS NULL AND claims_count IS NULL AND related_reconciliation_id IS NULL)
                        OR (action = 'close' AND from_status = 'reviewed' AND to_status = 'closed'
                            AND run_id IS NOT NULL AND ledger_fingerprint IS NOT NULL AND statement_digest IS NOT NULL
                            AND reviewer_id IS NOT NULL AND claims_count IS NOT NULL AND created_by <> reviewer_id AND related_reconciliation_id IS NULL)
                        OR (action = 'void' AND from_status = 'closed' AND to_status = 'voided'
                            AND run_id IS NOT NULL AND reason IS NOT NULL AND char_length(btrim(reason)) >= 3
                            AND claims_count IS NOT NULL AND reviewer_id IS NULL AND related_reconciliation_id IS NULL)
                        OR (action = 'supersede' AND from_status = 'closed' AND to_status = 'superseded'
                            AND run_id IS NOT NULL AND reason IS NOT NULL AND char_length(btrim(reason)) >= 3
                            AND claims_count IS NOT NULL AND reviewer_id IS NULL AND related_reconciliation_id IS NOT NULL)
                    )
                )
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION partner_stmt_event_guard_insert() RETURNS trigger LANGUAGE plpgsql AS $fn$
            DECLARE v_policy text;
            BEGIN
                IF NEW.seq <> 1 + COALESCE((SELECT MAX(e.seq) FROM partner_statement_reconciliation_events e
                                             WHERE e.tenant_id = NEW.tenant_id AND e.reconciliation_id = NEW.reconciliation_id), 0) THEN
                    RAISE EXCEPTION 'partner_statement_reconciliation_events: seq must follow the previous event';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM partner_statement_reconciliations r
                                WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.reconciliation_id AND r.status = NEW.from_status) THEN
                    RAISE EXCEPTION 'partner_statement_reconciliation_events: from_status does not match the current reconciliation status';
                END IF;
                IF NEW.action = 'close' THEN
                    IF NOT EXISTS (SELECT 1 FROM partner_statement_reconciliations r
                                    WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.reconciliation_id
                                      AND r.reviewed_by IS NOT DISTINCT FROM NEW.reviewer_id AND r.reviewed_run_id IS NOT DISTINCT FROM NEW.run_id) THEN
                        RAISE EXCEPTION 'partner_statement_reconciliation_events: close must name the recorded reviewer and review run';
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM partner_statement_reconciliation_events m
                                    WHERE m.tenant_id = NEW.tenant_id AND m.reconciliation_id = NEW.reconciliation_id AND m.action = 'mark_reviewed'
                                      AND m.seq = (SELECT MAX(x.seq) FROM partner_statement_reconciliation_events x
                                                    WHERE x.tenant_id = NEW.tenant_id AND x.reconciliation_id = NEW.reconciliation_id AND x.action = 'mark_reviewed')
                                      AND m.created_by = NEW.reviewer_id) THEN
                        RAISE EXCEPTION 'partner_statement_reconciliation_events: the reviewer must be the actor of the latest mark_reviewed event';
                    END IF;
                    IF NEW.claims_count <> (SELECT COUNT(*) FROM partner_statement_unit_claims c
                                             WHERE c.tenant_id = NEW.tenant_id AND c.reconciliation_id = NEW.reconciliation_id) THEN
                        RAISE EXCEPTION 'partner_statement_reconciliation_events: claims_count does not match the recorded claims';
                    END IF;
                END IF;
                IF NEW.action IN ('void', 'supersede') THEN
                    IF NOT EXISTS (SELECT 1 FROM partner_statement_reconciliations r
                                    WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.reconciliation_id AND r.reviewed_run_id IS NOT DISTINCT FROM NEW.run_id) THEN
                        RAISE EXCEPTION 'partner_statement_reconciliation_events: void/supersede must name the reconciliation''s recorded run';
                    END IF;
                    IF NEW.claims_count <> (SELECT COUNT(*) FROM partner_statement_unit_claims c
                                             WHERE c.tenant_id = NEW.tenant_id AND c.reconciliation_id = NEW.reconciliation_id AND c.released_at IS NULL) THEN
                        RAISE EXCEPTION 'partner_statement_reconciliation_events: claims_count must equal the active claims being released';
                    END IF;
                    -- D-PS-20: the policy recorded with the event must be the tenant's effective one (tenants.settings, strict unless exactly 'flexible'), and strict forbids the closer.
                    v_policy := CASE WHEN (SELECT t.settings::jsonb #>> '{partner_statements,void_separation}' FROM tenants t WHERE t.id = NEW.tenant_id) = 'flexible' THEN 'flexible' ELSE 'strict' END;
                    IF NEW.summary IS NULL OR (NEW.summary::jsonb ->> 'void_separation') IS DISTINCT FROM v_policy THEN
                        RAISE EXCEPTION 'partner_statement_policy_mismatch: the recorded void separation policy must equal the tenant''s effective policy';
                    END IF;
                    IF v_policy = 'strict' AND EXISTS (SELECT 1 FROM partner_statement_reconciliations r
                                                         WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.reconciliation_id AND r.closed_by IS NOT DISTINCT FROM NEW.created_by) THEN
                        RAISE EXCEPTION 'partner_statement_void_separation: under the strict policy the closer cannot void or supersede the final';
                    END IF;
                END IF;
                IF NEW.action = 'supersede' AND NOT EXISTS (
                    SELECT 1 FROM partner_statement_reconciliations o JOIN partner_statement_reconciliations n
                        ON n.tenant_id = o.tenant_id AND n.partner_id = o.partner_id AND n.role = o.role
                     WHERE o.tenant_id = NEW.tenant_id AND o.id = NEW.reconciliation_id AND n.id = NEW.related_reconciliation_id
                       AND n.id <> o.id AND n.status = 'reviewed') THEN
                    RAISE EXCEPTION 'partner_statement_reconciliation_events: the replacement must be a different reviewed reconciliation of the same partner and role';
                END IF;
                RETURN NEW;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER partner_stmt_event_insert_guard BEFORE INSERT ON partner_statement_reconciliation_events FOR EACH ROW EXECUTE FUNCTION partner_stmt_event_guard_insert()');

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION partner_stmt_recon_guard_update() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF OLD.status IN ('voided', 'superseded') THEN
                    RAISE EXCEPTION 'partner_statement_reconciliations: a voided or superseded final is immutable';
                END IF;
                IF OLD.status = 'closed' AND NEW.status NOT IN ('voided', 'superseded') THEN
                    RAISE EXCEPTION 'partner_statement_reconciliations: a closed final changes only by being voided or superseded';
                END IF;
                IF NEW.status IS NOT DISTINCT FROM OLD.status AND (NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
                    OR NEW.reviewed_run_id IS DISTINCT FROM OLD.reviewed_run_id OR NEW.closed_by IS DISTINCT FROM OLD.closed_by OR NEW.closed_at IS DISTINCT FROM OLD.closed_at
                    OR NEW.scope_key IS DISTINCT FROM OLD.scope_key) THEN
                    RAISE EXCEPTION 'partner_statement_reconciliations: review and close fields change only through a status transition';
                END IF;
                IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.partner_id IS DISTINCT FROM OLD.partner_id
                    OR NEW.role IS DISTINCT FROM OLD.role OR NEW.period_from IS DISTINCT FROM OLD.period_from OR NEW.period_to IS DISTINCT FROM OLD.period_to
                    OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.original_filename IS DISTINCT FROM OLD.original_filename
                    OR NEW.file_sha256 IS DISTINCT FROM OLD.file_sha256 OR NEW.identity_sha256 IS DISTINCT FROM OLD.identity_sha256
                    OR NEW.source_import_job_id IS DISTINCT FROM OLD.source_import_job_id OR NEW.line_count IS DISTINCT FROM OLD.line_count
                    OR NEW.total_debit_minor IS DISTINCT FROM OLD.total_debit_minor OR NEW.total_credit_minor IS DISTINCT FROM OLD.total_credit_minor
                    OR NEW.policy::text IS DISTINCT FROM OLD.policy::text OR NEW.checks::text IS DISTINCT FROM OLD.checks::text
                    OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at
                THEN
                    RAISE EXCEPTION 'partner_statement_reconciliations: the imported identity and frozen policy cannot change';
                END IF;
                IF OLD.lines_digest IS NOT NULL AND NEW.lines_digest IS DISTINCT FROM OLD.lines_digest THEN
                    RAISE EXCEPTION 'partner_statement_reconciliations: lines_digest is written once';
                END IF;
                IF NEW.status IS DISTINCT FROM OLD.status AND NOT EXISTS (
                    SELECT 1 FROM partner_statement_reconciliation_events e
                     WHERE e.tenant_id = NEW.tenant_id AND e.reconciliation_id = NEW.id
                       AND e.seq = (SELECT MAX(x.seq) FROM partner_statement_reconciliation_events x WHERE x.tenant_id = NEW.tenant_id AND x.reconciliation_id = NEW.id)
                       AND e.from_status = OLD.status AND e.to_status = NEW.status
                ) THEN
                    RAISE EXCEPTION 'partner_statement_reconciliations: a status change requires a matching audit event';
                END IF;
                IF NEW.status = 'closed' THEN
                    IF NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by OR NEW.reviewed_run_id IS DISTINCT FROM OLD.reviewed_run_id OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at THEN
                        RAISE EXCEPTION 'partner_statement_reconciliations: closing keeps the recorded review';
                    END IF;
                    IF NOT EXISTS (
                        SELECT 1 FROM partner_statement_reconciliation_events e
                         WHERE e.tenant_id = NEW.tenant_id AND e.reconciliation_id = NEW.id AND e.action = 'close'
                           AND e.seq = (SELECT MAX(x.seq) FROM partner_statement_reconciliation_events x WHERE x.tenant_id = NEW.tenant_id AND x.reconciliation_id = NEW.id)
                           AND e.created_by = NEW.closed_by AND e.reviewer_id = NEW.reviewed_by AND e.run_id = NEW.reviewed_run_id
                           AND e.claims_count = (SELECT COUNT(*) FROM partner_statement_unit_claims c WHERE c.tenant_id = NEW.tenant_id AND c.reconciliation_id = NEW.id)
                    ) THEN
                        RAISE EXCEPTION 'partner_statement_reconciliations: closing requires a matching close event (actor, reviewer, run, claims count)';
                    END IF;
                    IF EXISTS (SELECT 1 FROM partner_statement_reconciliations o
                                WHERE o.tenant_id = NEW.tenant_id AND o.id <> NEW.id AND o.partner_id = NEW.partner_id AND o.role = NEW.role
                                  AND o.period_from = NEW.period_from AND o.period_to = NEW.period_to AND o.status = 'closed'
                                  AND (o.scope_key = 'org' OR NEW.scope_key = 'org')) THEN
                        RAISE EXCEPTION 'partner_statement_reconciliations: an organisation final and any other final of the identical period cannot coexist';
                    END IF;
                END IF;
                IF OLD.status = 'closed' AND NEW.status IN ('voided', 'superseded') THEN
                    IF NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by OR NEW.reviewed_run_id IS DISTINCT FROM OLD.reviewed_run_id OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
                        OR NEW.closed_by IS DISTINCT FROM OLD.closed_by OR NEW.closed_at IS DISTINCT FROM OLD.closed_at OR NEW.scope_key IS DISTINCT FROM OLD.scope_key THEN
                        RAISE EXCEPTION 'partner_statement_reconciliations: retiring a final keeps the recorded review and close (audit history)';
                    END IF;
                    IF NOT EXISTS (
                        SELECT 1 FROM partner_statement_reconciliation_events e
                         WHERE e.tenant_id = NEW.tenant_id AND e.reconciliation_id = NEW.id
                           AND e.seq = (SELECT MAX(x.seq) FROM partner_statement_reconciliation_events x WHERE x.tenant_id = NEW.tenant_id AND x.reconciliation_id = NEW.id)
                           AND e.action = CASE NEW.status WHEN 'voided' THEN 'void' ELSE 'supersede' END
                           AND e.created_by = NEW.voided_by AND e.reason = NEW.void_reason AND e.run_id = NEW.reviewed_run_id
                           AND e.related_reconciliation_id IS NOT DISTINCT FROM NEW.superseded_by_id
                           AND e.claims_count = (SELECT COUNT(*) FROM partner_statement_unit_claims c WHERE c.tenant_id = NEW.tenant_id AND c.reconciliation_id = NEW.id AND c.released_at IS NULL)
                    ) THEN
                        RAISE EXCEPTION 'partner_statement_reconciliations: voiding or superseding requires a matching event (actor, reason, run, released claims, replacement)';
                    END IF;
                END IF;
                IF OLD.status = 'reviewed' AND NEW.status = 'draft' AND EXISTS (
                    SELECT 1 FROM partner_statement_unit_claims c WHERE c.tenant_id = NEW.tenant_id AND c.reconciliation_id = NEW.id) THEN
                    RAISE EXCEPTION 'partner_statement_reconciliations: a reconciliation with claims cannot be reopened';
                END IF;
                RETURN NEW;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER partner_stmt_recon_guard BEFORE UPDATE ON partner_statement_reconciliations FOR EACH ROW EXECUTE FUNCTION partner_stmt_recon_guard_update()');

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION partner_stmt_recon_guard_insert() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF NEW.status IN ('closed', 'voided', 'superseded') THEN
                    RAISE EXCEPTION 'partner_statement_reconciliations: a reconciliation cannot be inserted as closed, voided or superseded';
                END IF;
                RETURN NEW;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER partner_stmt_recon_insert_guard BEFORE INSERT ON partner_statement_reconciliations FOR EACH ROW EXECUTE FUNCTION partner_stmt_recon_guard_insert()');

        // الإفراج بالقاعدة: كل انتقال closed → voided|superseded يفرج مطالبات المقارنة الفعّالة بوقت الإبطال نفسه (ذرّياً مع الانتقال).
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION partner_stmt_recon_release_claims() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                UPDATE partner_statement_unit_claims SET released_at = NEW.voided_at
                 WHERE tenant_id = NEW.tenant_id AND reconciliation_id = NEW.id AND released_at IS NULL;
                RETURN NEW;
            END
            $fn$
            SQL);
        DB::unprepared("CREATE TRIGGER partner_stmt_recon_release AFTER UPDATE ON partner_statement_reconciliations FOR EACH ROW WHEN (OLD.status = 'closed' AND NEW.status IN ('voided', 'superseded')) EXECUTE FUNCTION partner_stmt_recon_release_claims()");

        // الاستبدال ذرّي: عند الالتزام يجب أن تكون المقارنة البديلة `closed` وإلا رُفضت المعاملة كلها (يتجاوز الخدمة؛ مؤجَّل لأن الإغلاق يلي الاستبدال في المعاملة).
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION partner_stmt_recon_deferred_replacement() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM partner_statement_reconciliations n
                                WHERE n.tenant_id = NEW.tenant_id AND n.id = NEW.superseded_by_id AND n.status = 'closed') THEN
                    RAISE EXCEPTION 'partner_statement_reconciliations: a superseded final needs its replacement closed in the same transaction';
                END IF;
                RETURN NULL;
            END
            $fn$
            SQL);
        DB::unprepared("CREATE CONSTRAINT TRIGGER partner_stmt_recon_deferred_replacement AFTER UPDATE ON partner_statement_reconciliations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (OLD.status = 'closed' AND NEW.status = 'superseded') EXECUTE FUNCTION partner_stmt_recon_deferred_replacement()");

        DB::statement(<<<'SQL'
            ALTER TABLE partner_statement_unit_claims
                ADD CONSTRAINT partner_stmt_claim_shape_chk CHECK (
                    role IN ('customer', 'supplier')
                    AND basis = 'decision' AND line_id IS NOT NULL
                )
            SQL);
        // إدراج المطالبة لا يكون بإفراج جاهز (A3d كان يفرضه بالقيد المشترك؛ التحديث صار مسموحاً بالإفراج فقط).
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION partner_stmt_claim_guard_insert() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF NEW.released_at IS NOT NULL THEN
                    RAISE EXCEPTION 'partner_statement_unit_claims: a claim is created active; it is released only with the void or supersede of its reconciliation';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM partner_statement_reconciliations r
                                WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.reconciliation_id AND r.status = 'reviewed'
                                  AND r.partner_id = NEW.partner_id AND r.role = NEW.role) THEN
                    RAISE EXCEPTION 'partner_statement_unit_claims: claims are written only for a reviewed reconciliation of the same partner and role';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM journal_entries je JOIN journal_lines jl ON jl.journal_entry_id = je.id AND jl.tenant_id = je.tenant_id
                                WHERE je.id = NEW.journal_entry_id AND je.tenant_id = NEW.tenant_id AND jl.partner_id = NEW.partner_id) THEN
                    RAISE EXCEPTION 'partner_statement_unit_claims: the claimed entry must belong to this tenant and carry a line for the partner';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM partner_statement_lines l
                                WHERE l.tenant_id = NEW.tenant_id AND l.id = NEW.line_id AND l.reconciliation_id = NEW.reconciliation_id) THEN
                    RAISE EXCEPTION 'partner_statement_unit_claims: the statement line must belong to the same reconciliation';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM partner_statement_review_decisions d
                                WHERE d.tenant_id = NEW.tenant_id AND d.reconciliation_id = NEW.reconciliation_id AND d.line_id = NEW.line_id
                                  AND d.action IN ('confirm', 'override', 'link_pair')
                                  AND d.revision = (SELECT MAX(x.revision) FROM partner_statement_review_decisions x WHERE x.tenant_id = d.tenant_id AND x.line_id = d.line_id)
                                  AND ((d.action = 'link_pair' AND NEW.journal_entry_id = CASE d.pair_member WHEN 'original' THEN d.pair_original_entry_id ELSE d.pair_reversal_entry_id END)
                                       OR (d.action IN ('confirm', 'override') AND d.claim_entry_ids IS NOT NULL AND jsonb_exists(d.claim_entry_ids::jsonb, NEW.journal_entry_id::text)))) THEN
                    RAISE EXCEPTION 'partner_statement_unit_claims: a claim needs the line''s effective decision and the entry must belong to it (link_pair: the chosen member; confirm/override: the entry ids recorded with the decision); dismiss and cleared lines claim nothing';
                END IF;
                RETURN NEW;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER partner_stmt_claim_insert_guard BEFORE INSERT ON partner_statement_unit_claims FOR EACH ROW EXECUTE FUNCTION partner_stmt_claim_guard_insert()');
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION partner_stmt_claim_guard_update() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF NOT (OLD.released_at IS NULL AND NEW.released_at IS NOT NULL
                        AND NEW.id = OLD.id AND NEW.tenant_id = OLD.tenant_id AND NEW.reconciliation_id = OLD.reconciliation_id AND NEW.partner_id = OLD.partner_id
                        AND NEW.role = OLD.role AND NEW.journal_entry_id = OLD.journal_entry_id AND NEW.basis = OLD.basis
                        AND NEW.line_id IS NOT DISTINCT FROM OLD.line_id AND NEW.claimed_at IS NOT DISTINCT FROM OLD.claimed_at
                        AND EXISTS (SELECT 1 FROM partner_statement_reconciliations r
                                     WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.reconciliation_id AND r.status IN ('voided', 'superseded') AND r.voided_at = NEW.released_at)) THEN
                    RAISE EXCEPTION 'partner_statement_unit_claims: a claim changes only by being released with the void or supersede of its reconciliation';
                END IF;
                RETURN NEW;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER partner_stmt_claim_release_guard BEFORE UPDATE ON partner_statement_unit_claims FOR EACH ROW EXECUTE FUNCTION partner_stmt_claim_guard_update()');
    }

    // ═══════════════════════════════ SQLite ═══════════════════════════════

    private function sqliteUp(): void
    {
        foreach (['partner_stmt_recon_lifecycle_insert', 'partner_stmt_recon_guard', 'partner_stmt_recon_insert_guard', 'partner_stmt_event_shape', 'partner_stmt_event_insert_guard', 'partner_stmt_claim_no_update', 'partner_stmt_event_void_policy', 'partner_stmt_event_void_separation'] as $trigger) {
            DB::unprepared("DROP TRIGGER IF EXISTS {$trigger}");
        }

        $noVoid = 'NEW.voided_at IS NULL AND NEW.voided_by IS NULL AND NEW.void_reason IS NULL AND NEW.superseded_by_id IS NULL';
        $reviewed = 'NEW.reviewed_at IS NOT NULL AND NEW.reviewed_by IS NOT NULL AND NEW.reviewed_run_id IS NOT NULL';
        $closed = 'NEW.closed_at IS NOT NULL AND NEW.closed_by IS NOT NULL AND NEW.scope_key IS NOT NULL AND NEW.closed_by <> NEW.reviewed_by';
        $voidedBase = 'NEW.voided_at IS NOT NULL AND NEW.voided_by IS NOT NULL AND NEW.void_reason IS NOT NULL AND length(trim(NEW.void_reason)) >= 3';
        $draftShape = "(NEW.status = 'draft' AND NEW.reviewed_at IS NULL AND NEW.reviewed_by IS NULL AND NEW.reviewed_run_id IS NULL AND NEW.closed_at IS NULL AND NEW.closed_by IS NULL AND NEW.scope_key IS NULL AND {$noVoid})";
        $reviewedShape = "(NEW.status = 'reviewed' AND {$reviewed} AND NEW.closed_at IS NULL AND NEW.closed_by IS NULL AND NEW.scope_key IS NULL AND {$noVoid})";

        DB::unprepared(<<<SQL
            CREATE TRIGGER partner_stmt_recon_lifecycle_insert BEFORE INSERT ON partner_statement_reconciliations
            WHEN NOT ({$draftShape} OR {$reviewedShape})
            BEGIN
                SELECT RAISE(ABORT, 'partner_statement_reconciliations: invalid status or review fields');
            END
            SQL);
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER partner_stmt_recon_insert_guard BEFORE INSERT ON partner_statement_reconciliations
            WHEN NEW.status IN ('closed', 'voided', 'superseded')
            BEGIN
                SELECT RAISE(ABORT, 'partner_statement_reconciliations: a reconciliation cannot be inserted as closed, voided or superseded');
            END
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER partner_stmt_event_shape BEFORE INSERT ON partner_statement_reconciliation_events
            WHEN NOT (
                NEW.seq >= 1
                AND (
                    (NEW.action = 'mark_reviewed' AND NEW.from_status = 'draft' AND NEW.to_status = 'reviewed'
                        AND NEW.run_id IS NOT NULL AND NEW.ledger_fingerprint IS NOT NULL AND NEW.statement_digest IS NOT NULL
                        AND NEW.reviewer_id IS NULL AND NEW.claims_count IS NULL AND NEW.related_reconciliation_id IS NULL)
                    OR (NEW.action = 'reopen' AND NEW.from_status = 'reviewed' AND NEW.to_status = 'draft'
                        AND NEW.reason IS NOT NULL AND length(trim(NEW.reason)) >= 3
                        AND NEW.reviewer_id IS NULL AND NEW.claims_count IS NULL AND NEW.related_reconciliation_id IS NULL)
                    OR (NEW.action = 'close' AND NEW.from_status = 'reviewed' AND NEW.to_status = 'closed'
                        AND NEW.run_id IS NOT NULL AND NEW.ledger_fingerprint IS NOT NULL AND NEW.statement_digest IS NOT NULL
                        AND NEW.reviewer_id IS NOT NULL AND NEW.claims_count IS NOT NULL AND NEW.created_by <> NEW.reviewer_id AND NEW.related_reconciliation_id IS NULL)
                    OR (NEW.action = 'void' AND NEW.from_status = 'closed' AND NEW.to_status = 'voided'
                        AND NEW.run_id IS NOT NULL AND NEW.reason IS NOT NULL AND length(trim(NEW.reason)) >= 3
                        AND NEW.claims_count IS NOT NULL AND NEW.reviewer_id IS NULL AND NEW.related_reconciliation_id IS NULL)
                    OR (NEW.action = 'supersede' AND NEW.from_status = 'closed' AND NEW.to_status = 'superseded'
                        AND NEW.run_id IS NOT NULL AND NEW.reason IS NOT NULL AND length(trim(NEW.reason)) >= 3
                        AND NEW.claims_count IS NOT NULL AND NEW.reviewer_id IS NULL AND NEW.related_reconciliation_id IS NOT NULL)
                )
            )
            BEGIN
                SELECT RAISE(ABORT, 'partner_statement_reconciliation_events: invalid event shape');
            END
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER partner_stmt_event_insert_guard BEFORE INSERT ON partner_statement_reconciliation_events
            WHEN NEW.seq <> 1 + COALESCE((SELECT MAX(e.seq) FROM partner_statement_reconciliation_events e
                                           WHERE e.tenant_id = NEW.tenant_id AND e.reconciliation_id = NEW.reconciliation_id), 0)
              OR NOT EXISTS (SELECT 1 FROM partner_statement_reconciliations r
                              WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.reconciliation_id AND r.status = NEW.from_status)
              OR (NEW.action = 'close' AND (
                    NOT EXISTS (SELECT 1 FROM partner_statement_reconciliations r
                                 WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.reconciliation_id
                                   AND r.reviewed_by IS NEW.reviewer_id AND r.reviewed_run_id IS NEW.run_id)
                    OR NOT EXISTS (SELECT 1 FROM partner_statement_reconciliation_events m
                                    WHERE m.tenant_id = NEW.tenant_id AND m.reconciliation_id = NEW.reconciliation_id AND m.action = 'mark_reviewed'
                                      AND m.seq = (SELECT MAX(x.seq) FROM partner_statement_reconciliation_events x
                                                    WHERE x.tenant_id = NEW.tenant_id AND x.reconciliation_id = NEW.reconciliation_id AND x.action = 'mark_reviewed')
                                      AND m.created_by = NEW.reviewer_id)
                    OR NEW.claims_count IS NOT (SELECT COUNT(*) FROM partner_statement_unit_claims c
                                                 WHERE c.tenant_id = NEW.tenant_id AND c.reconciliation_id = NEW.reconciliation_id)
                ))
              OR (NEW.action IN ('void', 'supersede') AND (
                    NOT EXISTS (SELECT 1 FROM partner_statement_reconciliations r
                                 WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.reconciliation_id AND r.reviewed_run_id IS NEW.run_id)
                    OR NEW.claims_count IS NOT (SELECT COUNT(*) FROM partner_statement_unit_claims c
                                                 WHERE c.tenant_id = NEW.tenant_id AND c.reconciliation_id = NEW.reconciliation_id AND c.released_at IS NULL)
                ))
              OR (NEW.action = 'supersede' AND NOT EXISTS (
                    SELECT 1 FROM partner_statement_reconciliations o JOIN partner_statement_reconciliations n
                        ON n.tenant_id = o.tenant_id AND n.partner_id = o.partner_id AND n.role = o.role
                     WHERE o.tenant_id = NEW.tenant_id AND o.id = NEW.reconciliation_id AND n.id = NEW.related_reconciliation_id
                       AND n.id <> o.id AND n.status = 'reviewed'))
            BEGIN
                SELECT RAISE(ABORT, 'partner_statement_reconciliation_events: seq, from_status, close or retire preconditions do not match the current state');
            END
            SQL);

        $effective = "(CASE WHEN (SELECT json_extract(t.settings, '$.partner_statements.void_separation') FROM tenants t WHERE t.id = NEW.tenant_id) = 'flexible' THEN 'flexible' ELSE 'strict' END)";
        DB::unprepared(<<<SQL
            CREATE TRIGGER partner_stmt_event_void_policy BEFORE INSERT ON partner_statement_reconciliation_events
            WHEN NEW.action IN ('void', 'supersede') AND (NEW.summary IS NULL OR json_extract(NEW.summary, '$.void_separation') IS NOT {$effective})
            BEGIN
                SELECT RAISE(ABORT, 'partner_statement_policy_mismatch: the recorded void separation policy must equal the tenant''s effective policy');
            END
            SQL);
        DB::unprepared(<<<SQL
            CREATE TRIGGER partner_stmt_event_void_separation BEFORE INSERT ON partner_statement_reconciliation_events
            WHEN NEW.action IN ('void', 'supersede') AND {$effective} = 'strict'
              AND EXISTS (SELECT 1 FROM partner_statement_reconciliations r WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.reconciliation_id AND r.closed_by IS NEW.created_by)
            BEGIN
                SELECT RAISE(ABORT, 'partner_statement_void_separation: under the strict policy the closer cannot void or supersede the final');
            END
            SQL);

        $closedShape = "(NEW.status = 'closed' AND {$reviewed} AND {$closed} AND {$noVoid})";
        $voidedShape = "(NEW.status = 'voided' AND {$reviewed} AND {$closed} AND {$voidedBase} AND NEW.superseded_by_id IS NULL)";
        $supersededShape = "(NEW.status = 'superseded' AND {$reviewed} AND {$closed} AND {$voidedBase} AND NEW.superseded_by_id IS NOT NULL AND NEW.superseded_by_id <> NEW.id)";
        DB::unprepared(<<<SQL
            CREATE TRIGGER partner_stmt_recon_guard BEFORE UPDATE ON partner_statement_reconciliations
            WHEN NOT ({$draftShape} OR {$reviewedShape} OR {$closedShape} OR {$voidedShape} OR {$supersededShape})
                OR NEW.id IS NOT OLD.id OR NEW.tenant_id IS NOT OLD.tenant_id OR NEW.partner_id IS NOT OLD.partner_id
                OR NEW.role IS NOT OLD.role OR NEW.period_from IS NOT OLD.period_from OR NEW.period_to IS NOT OLD.period_to
                OR NEW.currency IS NOT OLD.currency OR NEW.original_filename IS NOT OLD.original_filename
                OR NEW.file_sha256 IS NOT OLD.file_sha256 OR NEW.identity_sha256 IS NOT OLD.identity_sha256
                OR NEW.source_import_job_id IS NOT OLD.source_import_job_id OR NEW.line_count IS NOT OLD.line_count
                OR NEW.total_debit_minor IS NOT OLD.total_debit_minor OR NEW.total_credit_minor IS NOT OLD.total_credit_minor
                OR NEW.policy IS NOT OLD.policy OR NEW.checks IS NOT OLD.checks
                OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at
                OR (OLD.lines_digest IS NOT NULL AND NEW.lines_digest IS NOT OLD.lines_digest)
                OR (NEW.status IS NOT OLD.status AND NOT EXISTS (
                        SELECT 1 FROM partner_statement_reconciliation_events e
                         WHERE e.tenant_id = NEW.tenant_id AND e.reconciliation_id = NEW.id
                           AND e.seq = (SELECT MAX(x.seq) FROM partner_statement_reconciliation_events x WHERE x.tenant_id = NEW.tenant_id AND x.reconciliation_id = NEW.id)
                           AND e.from_status = OLD.status AND e.to_status = NEW.status))
                OR OLD.status IN ('voided', 'superseded')
                OR (OLD.status = 'closed' AND NEW.status NOT IN ('voided', 'superseded'))
                OR (NEW.status IS OLD.status AND (NEW.reviewed_by IS NOT OLD.reviewed_by OR NEW.reviewed_at IS NOT OLD.reviewed_at OR NEW.reviewed_run_id IS NOT OLD.reviewed_run_id
                    OR NEW.closed_by IS NOT OLD.closed_by OR NEW.closed_at IS NOT OLD.closed_at OR NEW.scope_key IS NOT OLD.scope_key))
                OR (NEW.status = 'closed' AND (
                        NEW.reviewed_by IS NOT OLD.reviewed_by OR NEW.reviewed_run_id IS NOT OLD.reviewed_run_id OR NEW.reviewed_at IS NOT OLD.reviewed_at
                        OR NOT EXISTS (
                            SELECT 1 FROM partner_statement_reconciliation_events e
                             WHERE e.tenant_id = NEW.tenant_id AND e.reconciliation_id = NEW.id AND e.action = 'close'
                               AND e.seq = (SELECT MAX(x.seq) FROM partner_statement_reconciliation_events x WHERE x.tenant_id = NEW.tenant_id AND x.reconciliation_id = NEW.id)
                               AND e.created_by IS NEW.closed_by AND e.reviewer_id IS NEW.reviewed_by AND e.run_id IS NEW.reviewed_run_id
                               AND e.claims_count IS (SELECT COUNT(*) FROM partner_statement_unit_claims c WHERE c.tenant_id = NEW.tenant_id AND c.reconciliation_id = NEW.id))
                        OR EXISTS (SELECT 1 FROM partner_statement_reconciliations o
                                    WHERE o.tenant_id = NEW.tenant_id AND o.id <> NEW.id AND o.partner_id = NEW.partner_id AND o.role = NEW.role
                                      AND o.period_from = NEW.period_from AND o.period_to = NEW.period_to AND o.status = 'closed'
                                      AND (o.scope_key = 'org' OR NEW.scope_key = 'org'))))
                OR (OLD.status = 'closed' AND NEW.status IN ('voided', 'superseded') AND (
                        NEW.reviewed_by IS NOT OLD.reviewed_by OR NEW.reviewed_run_id IS NOT OLD.reviewed_run_id OR NEW.reviewed_at IS NOT OLD.reviewed_at
                        OR NEW.closed_by IS NOT OLD.closed_by OR NEW.closed_at IS NOT OLD.closed_at OR NEW.scope_key IS NOT OLD.scope_key
                        OR NOT EXISTS (
                            SELECT 1 FROM partner_statement_reconciliation_events e
                             WHERE e.tenant_id = NEW.tenant_id AND e.reconciliation_id = NEW.id
                               AND e.seq = (SELECT MAX(x.seq) FROM partner_statement_reconciliation_events x WHERE x.tenant_id = NEW.tenant_id AND x.reconciliation_id = NEW.id)
                               AND e.action = CASE NEW.status WHEN 'voided' THEN 'void' ELSE 'supersede' END
                               AND e.created_by IS NEW.voided_by AND e.reason IS NEW.void_reason AND e.run_id IS NEW.reviewed_run_id
                               AND e.related_reconciliation_id IS NEW.superseded_by_id
                               AND e.claims_count IS (SELECT COUNT(*) FROM partner_statement_unit_claims c WHERE c.tenant_id = NEW.tenant_id AND c.reconciliation_id = NEW.id AND c.released_at IS NULL))))
                OR (OLD.status = 'reviewed' AND NEW.status = 'draft' AND EXISTS (
                        SELECT 1 FROM partner_statement_unit_claims c WHERE c.tenant_id = NEW.tenant_id AND c.reconciliation_id = NEW.id))
            BEGIN
                SELECT RAISE(ABORT, 'partner_statement_reconciliations: identity and policy are frozen; status changes only through a matching audit event; a closed final changes only by being voided or superseded');
            END
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER partner_stmt_recon_release AFTER UPDATE ON partner_statement_reconciliations
            WHEN OLD.status = 'closed' AND NEW.status IN ('voided', 'superseded')
            BEGIN
                UPDATE partner_statement_unit_claims SET released_at = NEW.voided_at
                 WHERE tenant_id = NEW.tenant_id AND reconciliation_id = NEW.id AND released_at IS NULL;
            END
            SQL);
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER partner_stmt_claim_release_guard BEFORE UPDATE ON partner_statement_unit_claims
            WHEN NOT (OLD.released_at IS NULL AND NEW.released_at IS NOT NULL
                      AND NEW.id IS OLD.id AND NEW.tenant_id IS OLD.tenant_id AND NEW.reconciliation_id IS OLD.reconciliation_id AND NEW.partner_id IS OLD.partner_id
                      AND NEW.role IS OLD.role AND NEW.journal_entry_id IS OLD.journal_entry_id AND NEW.basis IS OLD.basis
                      AND NEW.line_id IS OLD.line_id AND NEW.claimed_at IS OLD.claimed_at
                      AND EXISTS (SELECT 1 FROM partner_statement_reconciliations r
                                   WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.reconciliation_id AND r.status IN ('voided', 'superseded') AND r.voided_at IS NEW.released_at))
            BEGIN
                SELECT RAISE(ABORT, 'partner_statement_unit_claims: a claim changes only by being released with the void or supersede of its reconciliation');
            END
            SQL);
    }
};
