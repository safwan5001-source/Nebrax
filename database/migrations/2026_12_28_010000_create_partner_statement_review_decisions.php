<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * IMP-PS-A3a — قرارات مراجعة نتائج مطابقة كشوف الأطراف (`CompanyWide`). **جدول إضافي واحد، بلا مساس بأي جدول قائم ولا بالأستاذ ولا مفتاح أجنبي إلى القيود.**
 *
 * سجل **append-only**: كل إجراء مراجعة (confirm | override | clear) صفٌّ جديد برقم نسخة متسلسل لكل سطر كشف (`revision`)؛ القرار الفعّال لسطر = أعلى نسخة له
 * (و`clear` يعني «لا قرار»). لا UPDATE ولا DELETE (إلا بحذف المستأجر المتسلسل)، ولا TRUNCATE (PostgreSQL).
 *
 * الحراس في القاعدة (PostgreSQL وSQLite، شبكة أمان لما تفرضه الخدمة):
 *  - شكل الصف: الإجراء ضمن القائمة؛ confirm/override ≥ 1 وحدة و≤ 50؛ clear = بلا وحدات؛ override يتطلب سبباً (≥ 3 محارف بعد التشذيب)؛ النسخة ≥ 1.
 *  - تسلسل النسخ: النسخة = 1 + أعلى نسخة قائمة لسطر الكشف نفسه (لا ثقوب ولا تكرار ولا إعادة ترتيب)، فوق الفهرس الفريد.
 *  - عدم التعديل والحذف والتفريغ.
 * `down()` يرفض إن وُجد أي صف.
 */
return new class extends Migration
{
    private const TABLE = 'partner_statement_review_decisions';

    public function up(): void
    {
        Schema::create(self::TABLE, function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->uuid('reconciliation_id');
            $table->uuid('run_id');
            $table->foreignUuid('line_id')->constrained('partner_statement_lines')->cascadeOnDelete();
            $table->unsignedInteger('revision');
            $table->string('action', 12);                     // confirm | override | clear
            $table->json('unit_keys');                        // الوحدات الدفترية المسندة للسطر (فارغة عند clear)
            $table->string('engine_outcome', 32)->nullable(); // ما اقترحه المحرّك لهذا السطر في التشغيلة وقت القرار
            $table->bigInteger('expected_net_minor')->nullable();
            $table->bigInteger('set_net_minor')->nullable();
            $table->bigInteger('difference_minor')->nullable();
            $table->boolean('accepted_difference')->default(false);
            $table->string('reason', 500)->nullable();
            $table->char('ledger_fingerprint', 64);           // بصمة الدفتر التي بُني عليها القرار
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->timestamp('created_at')->nullable();      // لا updated_at: السجل لا يتغيّر

            $table->unique(['tenant_id', 'reconciliation_id', 'line_id', 'revision'], 'partner_stmt_decision_rev_unique');
            $table->index(['tenant_id', 'reconciliation_id', 'created_at'], 'partner_stmt_decision_recon_idx');
            $table->foreign(['tenant_id', 'reconciliation_id'], 'partner_stmt_decision_recon_fk')
                ->references(['tenant_id', 'id'])->on('partner_statement_reconciliations')->cascadeOnDelete();
            $table->foreign(['tenant_id', 'run_id'], 'partner_stmt_decision_run_fk')
                ->references(['tenant_id', 'id'])->on('partner_statement_match_runs')->cascadeOnDelete();
        });

        if (DB::connection()->getDriverName() === 'pgsql') {
            $this->postgresGuards();
        } else {
            $this->sqliteGuards();
        }
    }

    public function down(): void
    {
        if (Schema::hasTable(self::TABLE) && DB::table(self::TABLE)->exists()) {
            throw new RuntimeException('لا يُتراجع عن سجل قرارات مراجعة كشوف الأطراف وفيه صفوف (سجل تدقيق لا يُحذف).');
        }
        Schema::dropIfExists(self::TABLE);

        if (DB::connection()->getDriverName() === 'pgsql') {
            foreach (['partner_stmt_decision_guard_insert', 'partner_stmt_decision_guard_update', 'partner_stmt_decision_guard_delete', 'partner_stmt_decision_guard_truncate'] as $function) {
                DB::statement("DROP FUNCTION IF EXISTS {$function}()");
            }
        }
    }

    private function postgresGuards(): void
    {
        DB::statement(<<<'SQL'
            ALTER TABLE partner_statement_review_decisions
                ADD CONSTRAINT partner_stmt_decision_shape_chk CHECK (
                    revision >= 1
                    AND action IN ('confirm','override','clear')
                    AND (
                        (action = 'clear' AND json_array_length(unit_keys) = 0)
                        OR (action IN ('confirm','override') AND json_array_length(unit_keys) BETWEEN 1 AND 50)
                    )
                    AND (action <> 'override' OR (reason IS NOT NULL AND char_length(btrim(reason)) >= 3))
                )
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION partner_stmt_decision_guard_insert() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF NEW.revision <> 1 + COALESCE((
                    SELECT MAX(d.revision) FROM partner_statement_review_decisions d
                     WHERE d.tenant_id = NEW.tenant_id AND d.reconciliation_id = NEW.reconciliation_id AND d.line_id = NEW.line_id
                ), 0) THEN
                    RAISE EXCEPTION 'partner_statement_review_decisions: revision must follow the previous revision of the same line';
                END IF;
                RETURN NEW;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER partner_stmt_decision_revision BEFORE INSERT ON partner_statement_review_decisions FOR EACH ROW EXECUTE FUNCTION partner_stmt_decision_guard_insert()');

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION partner_stmt_decision_guard_update() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                RAISE EXCEPTION 'partner_statement_review_decisions: review decisions are immutable';
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER partner_stmt_decision_no_update BEFORE UPDATE ON partner_statement_review_decisions FOR EACH ROW EXECUTE FUNCTION partner_stmt_decision_guard_update()');

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION partner_stmt_decision_guard_delete() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
                    RAISE EXCEPTION 'partner_statement_review_decisions: review decisions cannot be deleted';
                END IF;
                RETURN OLD;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER partner_stmt_decision_no_delete BEFORE DELETE ON partner_statement_review_decisions FOR EACH ROW EXECUTE FUNCTION partner_stmt_decision_guard_delete()');

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION partner_stmt_decision_guard_truncate() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                RAISE EXCEPTION 'partner_statement_review_decisions cannot be truncated';
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER partner_stmt_decision_no_truncate BEFORE TRUNCATE ON partner_statement_review_decisions FOR EACH STATEMENT EXECUTE FUNCTION partner_stmt_decision_guard_truncate()');
    }

    private function sqliteGuards(): void
    {
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER partner_stmt_decision_shape BEFORE INSERT ON partner_statement_review_decisions
            WHEN NOT (
                NEW.revision >= 1
                AND NEW.action IN ('confirm','override','clear')
                AND (
                    (NEW.action = 'clear' AND json_array_length(NEW.unit_keys) = 0)
                    OR (NEW.action IN ('confirm','override') AND json_array_length(NEW.unit_keys) BETWEEN 1 AND 50)
                )
                AND (NEW.action <> 'override' OR (NEW.reason IS NOT NULL AND length(trim(NEW.reason)) >= 3))
            )
            BEGIN
                SELECT RAISE(ABORT, 'partner_statement_review_decisions: invalid decision shape');
            END
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER partner_stmt_decision_revision BEFORE INSERT ON partner_statement_review_decisions
            WHEN NEW.revision <> 1 + COALESCE((
                SELECT MAX(d.revision) FROM partner_statement_review_decisions d
                 WHERE d.tenant_id = NEW.tenant_id AND d.reconciliation_id = NEW.reconciliation_id AND d.line_id = NEW.line_id
            ), 0)
            BEGIN
                SELECT RAISE(ABORT, 'partner_statement_review_decisions: revision must follow the previous revision of the same line');
            END
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER partner_stmt_decision_no_update BEFORE UPDATE ON partner_statement_review_decisions
            BEGIN
                SELECT RAISE(ABORT, 'partner_statement_review_decisions: review decisions are immutable');
            END
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER partner_stmt_decision_no_delete BEFORE DELETE ON partner_statement_review_decisions
            WHEN EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id)
            BEGIN
                SELECT RAISE(ABORT, 'partner_statement_review_decisions: review decisions cannot be deleted');
            END
            SQL);
    }
};
