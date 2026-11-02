<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * IMP-PS-A3d — المطالبات النهائية بالحركات + الإغلاق الفعلي `reviewed → closed` لمقارنة كشف الطرف. **إضافي: لا مساس بالأستاذ ولا بأي مستند، ولا مفتاح أجنبي إلى جداول الأستاذ.**
 *
 *  - `partner_statement_unit_claims`: مطالبة واحدة لكل **قيد يومية** (`journal_entry_id`) **استعمله قرار مراجعة فعّال** (`basis = decision` + سطر الكشف) — لا قيود الفترة لمجرد تاريخها (قرار المالك 2026-11-02).
 *    فهرس فريد جزئي `(tenant, partner, role, journal_entry_id) WHERE released_at IS NULL` يمنع مطالبتين فعّالتين على الحركة نفسها **حتى عبر فترات أو فروع مختلفة وحتى بـSQL خام**. مُشغّل الإدراج يشترط أن يكون
 *    للسطر قرارٌ فعّال (أحدث نسخة) من نوع confirm/override/link_pair — فلا مطالبة لسطر dismiss/مسحوب — وأن يكون القيد في link_pair هو **العضو المحدَّد صراحةً** فقط. الجدول append-only في A3d (لا UPDATE ولا DELETE
 *    ولا TRUNCATE)؛ `released_at` موجود لإفراج A3e ويبقى فارغاً هنا.
 *  - `partner_statement_reconciliations`: `closed_at/closed_by/scope_key` (`org` أو معرّف الفرع)، وحالة `closed` الطرفية. حراس القاعدة: الإدراج لا يكون `closed` أبداً؛ لا تحديث لصف `closed`؛ الانتقال
 *    إلى `closed` يتطلب **حدث `close` مطابقاً** (الفاعل = المُغلِق، المراجِع = `reviewed_by` المسجَّل بحدث المراجعة، التشغيلة نفسها، وعدد المطالبات = المسجَّل بالحدث)، **المُغلِق ≠ المراجِع** (D-PS-17)،
 *    وفهرس فريد جزئي لنفس النطاق/الفترة (`WHERE status='closed'`) + قاعدة التطابق التام للفترة (مؤسسة ⇄ فرع) — خطة PS-A2 §5.3–5.4. لا تُدرج مطالبات إلا لمقارنة `reviewed` بالطرف/الدور نفسيهما
 *    ولقيد له سطر لهذا الطرف في المستأجر؛ وإعادة الفتح ترفض متى وُجدت مطالبات.
 *  - `partner_statement_reconciliation_events`: عمودا `reviewer_id` و`claims_count` وإجراء `close`.
 *  - كل شرط على عمود قابل للفراغ مصحوب بـ`IS NOT NULL` صريح (`CHECK` يقبل ناتج NULL).
 * `down()` يرفض إن وُجدت مطالبات أو حدث إغلاق أو مقارنة `closed`، ثم يعيد أجسام حراس A3c.
 */
return new class extends Migration
{
    private const RECON = 'partner_statement_reconciliations';

    private const EVENTS = 'partner_statement_reconciliation_events';

    private const CLAIMS = 'partner_statement_unit_claims';

    public function up(): void
    {
        Schema::table(self::RECON, function (Blueprint $table) {
            $table->timestamp('closed_at')->nullable();
            $table->uuid('closed_by')->nullable();        // مرجع تدقيق بلا مفتاح أجنبي (كـ reviewed_by)
            $table->string('scope_key', 64)->nullable();  // 'org' | معرّف الفرع — يُكتب عند الإغلاق فقط
        });
        Schema::table(self::EVENTS, function (Blueprint $table) {
            $table->uuid('reviewer_id')->nullable();
            $table->unsignedInteger('claims_count')->nullable();
        });

        Schema::create(self::CLAIMS, function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->uuid('reconciliation_id');
            $table->uuid('partner_id');
            $table->string('role', 16);
            $table->uuid('journal_entry_id');             // قيد اليومية المُطالَب به (بلا مفتاح أجنبي للأستاذ عمداً؛ يتحقق المُشغّل من وجوده وارتباطه بالطرف)
            $table->string('basis', 16);                  // decision دائماً (A3d)
            $table->uuid('line_id');                      // سطر الكشف الذي استعمل القيد
            $table->timestamp('claimed_at')->nullable();
            $table->timestamp('released_at')->nullable(); // A3e فقط؛ يبقى فارغاً في A3d

            $table->index(['tenant_id', 'reconciliation_id'], 'partner_stmt_claim_recon_idx');
            $table->foreign(['tenant_id', 'reconciliation_id'], 'partner_stmt_claim_recon_fk')
                ->references(['tenant_id', 'id'])->on(self::RECON)->cascadeOnDelete();
        });
        DB::statement('CREATE UNIQUE INDEX partner_stmt_claim_active_uq ON '.self::CLAIMS.' (tenant_id, partner_id, role, journal_entry_id) WHERE released_at IS NULL');
        DB::statement('CREATE UNIQUE INDEX partner_stmt_recon_final_scope_uq ON '.self::RECON." (tenant_id, partner_id, role, period_from, period_to, scope_key) WHERE status = 'closed'");

        if (DB::connection()->getDriverName() === 'pgsql') {
            $this->postgresGuards(true);
        } else {
            $this->sqliteGuards(true);
        }
    }

    public function down(): void
    {
        if (Schema::hasTable(self::CLAIMS) && DB::table(self::CLAIMS)->exists()) {
            throw new RuntimeException('لا يُتراجع عن المطالبات النهائية لكشوف الأطراف وفيها صفوف (سجل تدقيق لا يُحذف).');
        }
        if (DB::table(self::EVENTS)->where('action', 'close')->exists() || DB::table(self::RECON)->where('status', 'closed')->exists()) {
            throw new RuntimeException('لا يُتراجع عن الإغلاق النهائي وفيه مقارنات closed أو أحداث إغلاق.');
        }

        DB::statement('DROP INDEX IF EXISTS partner_stmt_recon_final_scope_uq');
        if (DB::connection()->getDriverName() === 'pgsql') {
            $this->dropPostgres();
            Schema::dropIfExists(self::CLAIMS);
            foreach (['partner_stmt_claim_guard_insert', 'partner_stmt_claim_guard_update', 'partner_stmt_claim_guard_delete', 'partner_stmt_claim_guard_truncate', 'partner_stmt_recon_guard_insert'] as $function) {
                DB::statement("DROP FUNCTION IF EXISTS {$function}()");
            }
            $this->postgresGuards(false);
        } else {
            $this->dropSqlite();
            Schema::dropIfExists(self::CLAIMS);
            $this->sqliteGuards(false);
        }

        Schema::table(self::EVENTS, fn (Blueprint $table) => $table->dropColumn(['reviewer_id', 'claims_count']));
        Schema::table(self::RECON, fn (Blueprint $table) => $table->dropColumn(['closed_at', 'closed_by', 'scope_key']));
    }

    private function dropPostgres(): void
    {
        DB::statement('DROP TRIGGER IF EXISTS partner_stmt_recon_guard ON '.self::RECON);
        DB::statement('DROP TRIGGER IF EXISTS partner_stmt_recon_insert_guard ON '.self::RECON);
        DB::statement('ALTER TABLE '.self::RECON.' DROP CONSTRAINT IF EXISTS partner_stmt_recon_lifecycle_chk');
        DB::statement('ALTER TABLE '.self::EVENTS.' DROP CONSTRAINT IF EXISTS partner_stmt_event_shape_chk');
        DB::statement('DROP TRIGGER IF EXISTS partner_stmt_event_insert_guard ON '.self::EVENTS);
    }

    private function dropSqlite(): void
    {
        foreach (['partner_stmt_recon_lifecycle_insert', 'partner_stmt_recon_guard', 'partner_stmt_recon_insert_guard', 'partner_stmt_event_shape', 'partner_stmt_event_insert_guard'] as $trigger) {
            DB::unprepared("DROP TRIGGER IF EXISTS {$trigger}");
        }
    }

    /** @param bool $a3d true = أجسام A3d (مع الإغلاق)، false = استعادة أجسام A3c حرفياً عند التراجع. */
    private function postgresGuards(bool $a3d): void
    {
        if ($a3d) {
            $this->dropPostgres();
        }

        $closedLifecycle = $a3d
            ? "OR (status = 'closed' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL AND reviewed_run_id IS NOT NULL
                    AND closed_at IS NOT NULL AND closed_by IS NOT NULL AND scope_key IS NOT NULL AND closed_by <> reviewed_by)"
            : '';
        $draftNoClose = $a3d ? 'AND closed_at IS NULL AND closed_by IS NULL AND scope_key IS NULL' : '';
        DB::statement(<<<SQL
            ALTER TABLE partner_statement_reconciliations
                ADD CONSTRAINT partner_stmt_recon_lifecycle_chk CHECK (
                    (status = 'draft' AND reviewed_at IS NULL AND reviewed_by IS NULL AND reviewed_run_id IS NULL {$draftNoClose})
                    OR (status = 'reviewed' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL AND reviewed_run_id IS NOT NULL {$draftNoClose})
                    {$closedLifecycle}
                )
            SQL);

        $closeShape = $a3d
            ? "OR (action = 'close' AND from_status = 'reviewed' AND to_status = 'closed'
                    AND run_id IS NOT NULL AND ledger_fingerprint IS NOT NULL AND statement_digest IS NOT NULL
                    AND reviewer_id IS NOT NULL AND claims_count IS NOT NULL AND created_by <> reviewer_id)"
            : '';
        $noExtras = $a3d ? 'AND reviewer_id IS NULL AND claims_count IS NULL' : '';
        DB::statement(<<<SQL
            ALTER TABLE partner_statement_reconciliation_events
                ADD CONSTRAINT partner_stmt_event_shape_chk CHECK (
                    seq >= 1
                    AND (
                        (action = 'mark_reviewed' AND from_status = 'draft' AND to_status = 'reviewed'
                            AND run_id IS NOT NULL AND ledger_fingerprint IS NOT NULL AND statement_digest IS NOT NULL {$noExtras})
                        OR (action = 'reopen' AND from_status = 'reviewed' AND to_status = 'draft'
                            AND reason IS NOT NULL AND char_length(btrim(reason)) >= 3 {$noExtras})
                        {$closeShape}
                    )
                )
            SQL);

        $eventClose = $a3d ? <<<'PLPGSQL'
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
            PLPGSQL : '';
        DB::unprepared(<<<SQL
            CREATE OR REPLACE FUNCTION partner_stmt_event_guard_insert() RETURNS trigger LANGUAGE plpgsql AS \$fn\$
            BEGIN
                IF NEW.seq <> 1 + COALESCE((SELECT MAX(e.seq) FROM partner_statement_reconciliation_events e
                                             WHERE e.tenant_id = NEW.tenant_id AND e.reconciliation_id = NEW.reconciliation_id), 0) THEN
                    RAISE EXCEPTION 'partner_statement_reconciliation_events: seq must follow the previous event';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM partner_statement_reconciliations r
                                WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.reconciliation_id AND r.status = NEW.from_status) THEN
                    RAISE EXCEPTION 'partner_statement_reconciliation_events: from_status does not match the current reconciliation status';
                END IF;
                {$eventClose}
                RETURN NEW;
            END
            \$fn\$
            SQL);
        DB::unprepared('CREATE TRIGGER partner_stmt_event_insert_guard BEFORE INSERT ON partner_statement_reconciliation_events FOR EACH ROW EXECUTE FUNCTION partner_stmt_event_guard_insert()');

        $closedGuards = $a3d ? <<<'PLPGSQL'
                IF OLD.status = 'closed' THEN
                    RAISE EXCEPTION 'partner_statement_reconciliations: a closed final is immutable';
                END IF;
                IF NEW.status IS NOT DISTINCT FROM OLD.status AND (NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
                    OR NEW.reviewed_run_id IS DISTINCT FROM OLD.reviewed_run_id OR NEW.closed_by IS DISTINCT FROM OLD.closed_by OR NEW.closed_at IS DISTINCT FROM OLD.closed_at
                    OR NEW.scope_key IS DISTINCT FROM OLD.scope_key) THEN
                    RAISE EXCEPTION 'partner_statement_reconciliations: review and close fields change only through a status transition';
                END IF;
            PLPGSQL : '';
        $closedTransition = $a3d ? <<<'PLPGSQL'
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
                IF OLD.status = 'reviewed' AND NEW.status = 'draft' AND EXISTS (
                    SELECT 1 FROM partner_statement_unit_claims c WHERE c.tenant_id = NEW.tenant_id AND c.reconciliation_id = NEW.id) THEN
                    RAISE EXCEPTION 'partner_statement_reconciliations: a reconciliation with claims cannot be reopened';
                END IF;
            PLPGSQL : '';
        DB::unprepared(<<<SQL
            CREATE OR REPLACE FUNCTION partner_stmt_recon_guard_update() RETURNS trigger LANGUAGE plpgsql AS \$fn\$
            BEGIN
                {$closedGuards}
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
                {$closedTransition}
                RETURN NEW;
            END
            \$fn\$
            SQL);
        DB::unprepared('CREATE TRIGGER partner_stmt_recon_guard BEFORE UPDATE ON partner_statement_reconciliations FOR EACH ROW EXECUTE FUNCTION partner_stmt_recon_guard_update()');

        if (! $a3d) {
            return;
        }

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION partner_stmt_recon_guard_insert() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF NEW.status = 'closed' THEN
                    RAISE EXCEPTION 'partner_statement_reconciliations: a reconciliation cannot be inserted as closed';
                END IF;
                RETURN NEW;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER partner_stmt_recon_insert_guard BEFORE INSERT ON partner_statement_reconciliations FOR EACH ROW EXECUTE FUNCTION partner_stmt_recon_guard_insert()');

        DB::statement(<<<'SQL'
            ALTER TABLE partner_statement_unit_claims
                ADD CONSTRAINT partner_stmt_claim_shape_chk CHECK (
                    role IN ('customer', 'supplier')
                    AND released_at IS NULL
                    AND basis = 'decision' AND line_id IS NOT NULL
                )
            SQL);
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION partner_stmt_claim_guard_insert() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
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
                                  AND (d.action <> 'link_pair' OR NEW.journal_entry_id = CASE d.pair_member WHEN 'original' THEN d.pair_original_entry_id ELSE d.pair_reversal_entry_id END)) THEN
                    RAISE EXCEPTION 'partner_statement_unit_claims: a claim needs the line''s effective confirm/override/link_pair decision (link_pair: the chosen member only); dismiss and cleared lines claim nothing';
                END IF;
                RETURN NEW;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER partner_stmt_claim_insert_guard BEFORE INSERT ON partner_statement_unit_claims FOR EACH ROW EXECUTE FUNCTION partner_stmt_claim_guard_insert()');
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION partner_stmt_claim_guard_update() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                RAISE EXCEPTION 'partner_statement_unit_claims: claims are immutable (release arrives with PS-A3e)';
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER partner_stmt_claim_no_update BEFORE UPDATE ON partner_statement_unit_claims FOR EACH ROW EXECUTE FUNCTION partner_stmt_claim_guard_update()');
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION partner_stmt_claim_guard_delete() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
                    RAISE EXCEPTION 'partner_statement_unit_claims: claims cannot be deleted';
                END IF;
                RETURN OLD;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER partner_stmt_claim_no_delete BEFORE DELETE ON partner_statement_unit_claims FOR EACH ROW EXECUTE FUNCTION partner_stmt_claim_guard_delete()');
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION partner_stmt_claim_guard_truncate() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                RAISE EXCEPTION 'partner_statement_unit_claims cannot be truncated';
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER partner_stmt_claim_no_truncate BEFORE TRUNCATE ON partner_statement_unit_claims FOR EACH STATEMENT EXECUTE FUNCTION partner_stmt_claim_guard_truncate()');
    }

    /** @param bool $a3d true = أجسام A3d، false = استعادة أجسام A3c حرفياً. */
    private function sqliteGuards(bool $a3d): void
    {
        if ($a3d) {
            $this->dropSqlite();
        }

        $draftNoClose = $a3d ? 'AND NEW.closed_at IS NULL AND NEW.closed_by IS NULL AND NEW.scope_key IS NULL' : '';
        DB::unprepared(<<<SQL
            CREATE TRIGGER partner_stmt_recon_lifecycle_insert BEFORE INSERT ON partner_statement_reconciliations
            WHEN NOT (
                (NEW.status = 'draft' AND NEW.reviewed_at IS NULL AND NEW.reviewed_by IS NULL AND NEW.reviewed_run_id IS NULL {$draftNoClose})
                OR (NEW.status = 'reviewed' AND NEW.reviewed_at IS NOT NULL AND NEW.reviewed_by IS NOT NULL AND NEW.reviewed_run_id IS NOT NULL {$draftNoClose})
            )
            BEGIN
                SELECT RAISE(ABORT, 'partner_statement_reconciliations: invalid status or review fields');
            END
            SQL);

        $closeShape = $a3d
            ? "OR (NEW.action = 'close' AND NEW.from_status = 'reviewed' AND NEW.to_status = 'closed'
                    AND NEW.run_id IS NOT NULL AND NEW.ledger_fingerprint IS NOT NULL AND NEW.statement_digest IS NOT NULL
                    AND NEW.reviewer_id IS NOT NULL AND NEW.claims_count IS NOT NULL AND NEW.created_by <> NEW.reviewer_id)"
            : '';
        $noExtras = $a3d ? 'AND NEW.reviewer_id IS NULL AND NEW.claims_count IS NULL' : '';
        DB::unprepared(<<<SQL
            CREATE TRIGGER partner_stmt_event_shape BEFORE INSERT ON partner_statement_reconciliation_events
            WHEN NOT (
                NEW.seq >= 1
                AND (
                    (NEW.action = 'mark_reviewed' AND NEW.from_status = 'draft' AND NEW.to_status = 'reviewed'
                        AND NEW.run_id IS NOT NULL AND NEW.ledger_fingerprint IS NOT NULL AND NEW.statement_digest IS NOT NULL {$noExtras})
                    OR (NEW.action = 'reopen' AND NEW.from_status = 'reviewed' AND NEW.to_status = 'draft'
                        AND NEW.reason IS NOT NULL AND length(trim(NEW.reason)) >= 3 {$noExtras})
                    {$closeShape}
                )
            )
            BEGIN
                SELECT RAISE(ABORT, 'partner_statement_reconciliation_events: invalid event shape');
            END
            SQL);

        $eventClose = $a3d
            ? "OR (NEW.action = 'close' AND (
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
                ))"
            : '';
        DB::unprepared(<<<SQL
            CREATE TRIGGER partner_stmt_event_insert_guard BEFORE INSERT ON partner_statement_reconciliation_events
            WHEN NEW.seq <> 1 + COALESCE((SELECT MAX(e.seq) FROM partner_statement_reconciliation_events e
                                           WHERE e.tenant_id = NEW.tenant_id AND e.reconciliation_id = NEW.reconciliation_id), 0)
              OR NOT EXISTS (SELECT 1 FROM partner_statement_reconciliations r
                              WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.reconciliation_id AND r.status = NEW.from_status)
              {$eventClose}
            BEGIN
                SELECT RAISE(ABORT, 'partner_statement_reconciliation_events: seq, from_status or close preconditions do not match the current state');
            END
            SQL);

        $lifecycleClosed = $a3d
            ? "OR (NEW.status = 'closed' AND NEW.reviewed_at IS NOT NULL AND NEW.reviewed_by IS NOT NULL AND NEW.reviewed_run_id IS NOT NULL
                    AND NEW.closed_at IS NOT NULL AND NEW.closed_by IS NOT NULL AND NEW.scope_key IS NOT NULL AND NEW.closed_by <> NEW.reviewed_by)"
            : '';
        $closedExtras = $a3d ? <<<'SQLX'
                OR OLD.status = 'closed'
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
                OR (OLD.status = 'reviewed' AND NEW.status = 'draft' AND EXISTS (
                        SELECT 1 FROM partner_statement_unit_claims c WHERE c.tenant_id = NEW.tenant_id AND c.reconciliation_id = NEW.id))
            SQLX : '';
        DB::unprepared(<<<SQL
            CREATE TRIGGER partner_stmt_recon_guard BEFORE UPDATE ON partner_statement_reconciliations
            WHEN NOT (
                    (NEW.status = 'draft' AND NEW.reviewed_at IS NULL AND NEW.reviewed_by IS NULL AND NEW.reviewed_run_id IS NULL {$draftNoClose})
                    OR (NEW.status = 'reviewed' AND NEW.reviewed_at IS NOT NULL AND NEW.reviewed_by IS NOT NULL AND NEW.reviewed_run_id IS NOT NULL {$draftNoClose})
                    {$lifecycleClosed}
                )
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
                {$closedExtras}
            BEGIN
                SELECT RAISE(ABORT, 'partner_statement_reconciliations: identity and policy are frozen; status changes only through a matching audit event');
            END
            SQL);

        if (! $a3d) {
            return;
        }

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER partner_stmt_recon_insert_guard BEFORE INSERT ON partner_statement_reconciliations
            WHEN NEW.status = 'closed'
            BEGIN
                SELECT RAISE(ABORT, 'partner_statement_reconciliations: a reconciliation cannot be inserted as closed');
            END
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER partner_stmt_claim_shape BEFORE INSERT ON partner_statement_unit_claims
            WHEN NOT (
                NEW.role IN ('customer', 'supplier')
                AND NEW.released_at IS NULL
                AND NEW.basis = 'decision' AND NEW.line_id IS NOT NULL
            )
            BEGIN
                SELECT RAISE(ABORT, 'partner_statement_unit_claims: invalid claim shape');
            END
            SQL);
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER partner_stmt_claim_insert_guard BEFORE INSERT ON partner_statement_unit_claims
            WHEN NOT EXISTS (SELECT 1 FROM partner_statement_reconciliations r
                              WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.reconciliation_id AND r.status = 'reviewed'
                                AND r.partner_id = NEW.partner_id AND r.role = NEW.role)
              OR NOT EXISTS (SELECT 1 FROM journal_entries je JOIN journal_lines jl ON jl.journal_entry_id = je.id AND jl.tenant_id = je.tenant_id
                              WHERE je.id = NEW.journal_entry_id AND je.tenant_id = NEW.tenant_id AND jl.partner_id = NEW.partner_id)
              OR NOT EXISTS (SELECT 1 FROM partner_statement_lines l
                              WHERE l.tenant_id = NEW.tenant_id AND l.id = NEW.line_id AND l.reconciliation_id = NEW.reconciliation_id)
              OR NOT EXISTS (SELECT 1 FROM partner_statement_review_decisions d
                              WHERE d.tenant_id = NEW.tenant_id AND d.reconciliation_id = NEW.reconciliation_id AND d.line_id = NEW.line_id
                                AND d.action IN ('confirm', 'override', 'link_pair')
                                AND d.revision = (SELECT MAX(x.revision) FROM partner_statement_review_decisions x WHERE x.tenant_id = d.tenant_id AND x.line_id = d.line_id)
                                AND (d.action <> 'link_pair' OR NEW.journal_entry_id = CASE d.pair_member WHEN 'original' THEN d.pair_original_entry_id ELSE d.pair_reversal_entry_id END))
            BEGIN
                SELECT RAISE(ABORT, 'partner_statement_unit_claims: claims need a reviewed reconciliation of the same partner and role, a ledger entry of this tenant for the partner, a line of the same reconciliation and that line''s effective confirm/override/link_pair decision (link_pair: the chosen member only)');
            END
            SQL);
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER partner_stmt_claim_no_update BEFORE UPDATE ON partner_statement_unit_claims
            BEGIN
                SELECT RAISE(ABORT, 'partner_statement_unit_claims: claims are immutable (release arrives with PS-A3e)');
            END
            SQL);
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER partner_stmt_claim_no_delete BEFORE DELETE ON partner_statement_unit_claims
            WHEN EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id)
            BEGIN
                SELECT RAISE(ABORT, 'partner_statement_unit_claims: claims cannot be deleted');
            END
            SQL);
    }
};
