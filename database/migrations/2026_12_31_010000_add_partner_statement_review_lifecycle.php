<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * IMP-PS-A3c — دورة حالات مطابقة كشف الطرف `draft ⇄ reviewed` (الإغلاق `closed` محجوب عمداً حتى مطالبات PS-A3d) + بصمة سطور الكشف + سجل أحداث append-only.
 * **إضافي بالكامل: لا مساس بالأستاذ ولا بأي مستند ولا مفتاح أجنبي إلى القيود.**
 *
 *  - `partner_statement_reconciliations`: `lines_digest` (بصمة سطور الكشف عند الاستيراد، تُكتب مرة واحدة)، و`reviewed_at/by/run_id` (تُملأ فقط في `reviewed`). حراس القاعدة:
 *    الحالة ∈ {draft, reviewed} (**لا `closed` ولا غيرها** — يوسّعها A3d بهجرته)، تناسق حقول المراجعة مع الحالة، تجميد أعمدة الهوية والسياسة بعد الإنشاء، وتغيّر الحالة **لا يكون إلا
 *    بعد حدث تدقيق مطابق** (آخر حدث للمقارنة يحمل الحافة نفسها).
 *  - `partner_statement_match_runs.statement_digest`: بصمة سطور الكشف وقت التشغيلة (فيكتشف أي تغيير خارج التطبيق بعدها).
 *  - `partner_statement_reconciliation_events`: سجل أحداث `mark_reviewed | reopen` append-only (فاعل، سبب، تشغيلة، بصمة الدفتر والكشف، ملخص عدّادات)، نسخ متسلسلة بلا ثقوب،
 *    ولا UPDATE/DELETE (إلا بحذف المستأجر المتسلسل) ولا TRUNCATE (PostgreSQL).
 *  - كل شرط على عمود قابل للفراغ مصحوب بـ`IS NOT NULL` صريح (`CHECK` يقبل ناتج NULL).
 * `down()` يرفض إن وُجد حدث أو مقارنة ليست `draft`.
 */
return new class extends Migration
{
    private const RECON = 'partner_statement_reconciliations';

    private const RUNS = 'partner_statement_match_runs';

    private const EVENTS = 'partner_statement_reconciliation_events';

    public function up(): void
    {
        Schema::table(self::RECON, function (Blueprint $table) {
            $table->char('lines_digest', 64)->nullable();
            $table->timestamp('reviewed_at')->nullable();
            $table->uuid('reviewed_by')->nullable();      // مرجع تدقيق بلا مفتاح أجنبي (يُعاد بناء الجدول في SQLite عند إضافته)
            $table->uuid('reviewed_run_id')->nullable();
        });
        Schema::table(self::RUNS, function (Blueprint $table) {
            $table->char('statement_digest', 64)->nullable();
        });

        Schema::create(self::EVENTS, function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->uuid('reconciliation_id');
            $table->unsignedInteger('seq');
            $table->string('action', 16);                       // mark_reviewed | reopen
            $table->string('from_status', 16);
            $table->string('to_status', 16);
            $table->uuid('run_id')->nullable();
            $table->char('ledger_fingerprint', 64)->nullable();
            $table->char('statement_digest', 64)->nullable();
            $table->json('summary')->nullable();
            $table->string('reason', 500)->nullable();
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->timestamp('created_at')->nullable();        // لا updated_at: السجل لا يتغيّر

            $table->unique(['tenant_id', 'reconciliation_id', 'seq'], 'partner_stmt_event_seq_unique');
            $table->foreign(['tenant_id', 'reconciliation_id'], 'partner_stmt_event_recon_fk')
                ->references(['tenant_id', 'id'])->on(self::RECON)->cascadeOnDelete();
            $table->foreign(['tenant_id', 'run_id'], 'partner_stmt_event_run_fk')
                ->references(['tenant_id', 'id'])->on(self::RUNS)->cascadeOnDelete();
        });

        if (DB::connection()->getDriverName() === 'pgsql') {
            $this->postgresGuards();
        } else {
            $this->sqliteGuards();
        }
    }

    public function down(): void
    {
        if (Schema::hasTable(self::EVENTS) && DB::table(self::EVENTS)->exists()) {
            throw new RuntimeException('لا يُتراجع عن دورة حالات كشوف الأطراف وفي سجل أحداثها صفوف (سجل تدقيق لا يُحذف).');
        }
        if (Schema::hasTable(self::RECON) && Schema::hasColumn(self::RECON, 'reviewed_at') && DB::table(self::RECON)->where('status', '<>', 'draft')->exists()) {
            throw new RuntimeException('لا يُتراجع عن دورة الحالات وفيها مقارنات ليست draft.');
        }

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('DROP TRIGGER IF EXISTS partner_stmt_recon_guard ON '.self::RECON);
            DB::statement('ALTER TABLE '.self::RECON.' DROP CONSTRAINT IF EXISTS partner_stmt_recon_lifecycle_chk');
            Schema::dropIfExists(self::EVENTS);
            foreach (['partner_stmt_event_guard_insert', 'partner_stmt_event_guard_update', 'partner_stmt_event_guard_delete', 'partner_stmt_event_guard_truncate', 'partner_stmt_recon_guard_update'] as $function) {
                DB::statement("DROP FUNCTION IF EXISTS {$function}()");
            }
        } else {
            foreach (['partner_stmt_recon_lifecycle_insert', 'partner_stmt_recon_guard'] as $trigger) {
                DB::unprepared("DROP TRIGGER IF EXISTS {$trigger}");
            }
            Schema::dropIfExists(self::EVENTS);
        }

        Schema::table(self::RUNS, fn (Blueprint $table) => $table->dropColumn('statement_digest'));
        Schema::table(self::RECON, fn (Blueprint $table) => $table->dropColumn(['lines_digest', 'reviewed_at', 'reviewed_by', 'reviewed_run_id']));
    }

    private function postgresGuards(): void
    {
        DB::statement(<<<'SQL'
            ALTER TABLE partner_statement_reconciliations
                ADD CONSTRAINT partner_stmt_recon_lifecycle_chk CHECK (
                    (status = 'draft' AND reviewed_at IS NULL AND reviewed_by IS NULL AND reviewed_run_id IS NULL)
                    OR (status = 'reviewed' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL AND reviewed_run_id IS NOT NULL)
                )
            SQL);
        DB::statement(<<<'SQL'
            ALTER TABLE partner_statement_reconciliation_events
                ADD CONSTRAINT partner_stmt_event_shape_chk CHECK (
                    seq >= 1
                    AND (
                        (action = 'mark_reviewed' AND from_status = 'draft' AND to_status = 'reviewed'
                            AND run_id IS NOT NULL AND ledger_fingerprint IS NOT NULL AND statement_digest IS NOT NULL)
                        OR (action = 'reopen' AND from_status = 'reviewed' AND to_status = 'draft'
                            AND reason IS NOT NULL AND char_length(btrim(reason)) >= 3)
                    )
                )
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION partner_stmt_event_guard_insert() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF NEW.seq <> 1 + COALESCE((SELECT MAX(e.seq) FROM partner_statement_reconciliation_events e
                                             WHERE e.tenant_id = NEW.tenant_id AND e.reconciliation_id = NEW.reconciliation_id), 0) THEN
                    RAISE EXCEPTION 'partner_statement_reconciliation_events: seq must follow the previous event';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM partner_statement_reconciliations r
                                WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.reconciliation_id AND r.status = NEW.from_status) THEN
                    RAISE EXCEPTION 'partner_statement_reconciliation_events: from_status does not match the current reconciliation status';
                END IF;
                RETURN NEW;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER partner_stmt_event_insert_guard BEFORE INSERT ON partner_statement_reconciliation_events FOR EACH ROW EXECUTE FUNCTION partner_stmt_event_guard_insert()');

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION partner_stmt_event_guard_update() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                RAISE EXCEPTION 'partner_statement_reconciliation_events: events are immutable';
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER partner_stmt_event_no_update BEFORE UPDATE ON partner_statement_reconciliation_events FOR EACH ROW EXECUTE FUNCTION partner_stmt_event_guard_update()');

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION partner_stmt_event_guard_delete() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
                    RAISE EXCEPTION 'partner_statement_reconciliation_events: events cannot be deleted';
                END IF;
                RETURN OLD;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER partner_stmt_event_no_delete BEFORE DELETE ON partner_statement_reconciliation_events FOR EACH ROW EXECUTE FUNCTION partner_stmt_event_guard_delete()');

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION partner_stmt_event_guard_truncate() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                RAISE EXCEPTION 'partner_statement_reconciliation_events cannot be truncated';
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER partner_stmt_event_no_truncate BEFORE TRUNCATE ON partner_statement_reconciliation_events FOR EACH STATEMENT EXECUTE FUNCTION partner_stmt_event_guard_truncate()');

        // الحالة ∈ {draft, reviewed} (القيد أعلاه يحصرها)، تجميد الهوية، وتغيّر الحالة بعد حدث مطابق لآخر حافة.
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION partner_stmt_recon_guard_update() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
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
                RETURN NEW;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER partner_stmt_recon_guard BEFORE UPDATE ON partner_statement_reconciliations FOR EACH ROW EXECUTE FUNCTION partner_stmt_recon_guard_update()');
    }

    private function sqliteGuards(): void
    {
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER partner_stmt_recon_lifecycle_insert BEFORE INSERT ON partner_statement_reconciliations
            WHEN NOT (
                (NEW.status = 'draft' AND NEW.reviewed_at IS NULL AND NEW.reviewed_by IS NULL AND NEW.reviewed_run_id IS NULL)
                OR (NEW.status = 'reviewed' AND NEW.reviewed_at IS NOT NULL AND NEW.reviewed_by IS NOT NULL AND NEW.reviewed_run_id IS NOT NULL)
            )
            BEGIN
                SELECT RAISE(ABORT, 'partner_statement_reconciliations: invalid status or review fields');
            END
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER partner_stmt_event_shape BEFORE INSERT ON partner_statement_reconciliation_events
            WHEN NOT (
                NEW.seq >= 1
                AND (
                    (NEW.action = 'mark_reviewed' AND NEW.from_status = 'draft' AND NEW.to_status = 'reviewed'
                        AND NEW.run_id IS NOT NULL AND NEW.ledger_fingerprint IS NOT NULL AND NEW.statement_digest IS NOT NULL)
                    OR (NEW.action = 'reopen' AND NEW.from_status = 'reviewed' AND NEW.to_status = 'draft'
                        AND NEW.reason IS NOT NULL AND length(trim(NEW.reason)) >= 3)
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
            BEGIN
                SELECT RAISE(ABORT, 'partner_statement_reconciliation_events: seq or from_status does not match the current state');
            END
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER partner_stmt_event_no_update BEFORE UPDATE ON partner_statement_reconciliation_events
            BEGIN
                SELECT RAISE(ABORT, 'partner_statement_reconciliation_events: events are immutable');
            END
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER partner_stmt_event_no_delete BEFORE DELETE ON partner_statement_reconciliation_events
            WHEN EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id)
            BEGIN
                SELECT RAISE(ABORT, 'partner_statement_reconciliation_events: events cannot be deleted');
            END
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER partner_stmt_recon_guard BEFORE UPDATE ON partner_statement_reconciliations
            WHEN NOT (
                    (NEW.status = 'draft' AND NEW.reviewed_at IS NULL AND NEW.reviewed_by IS NULL AND NEW.reviewed_run_id IS NULL)
                    OR (NEW.status = 'reviewed' AND NEW.reviewed_at IS NOT NULL AND NEW.reviewed_by IS NOT NULL AND NEW.reviewed_run_id IS NOT NULL)
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
            BEGIN
                SELECT RAISE(ABORT, 'partner_statement_reconciliations: identity and policy are frozen; status changes only through a matching audit event');
            END
            SQL);
    }
};
