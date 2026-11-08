<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * P1-3b-1 — مهام تسوية الورديات المسجَّلة (D-S2): بنية تقنية آمنة **بلا أي أثر محاسبي**.
 *
 * جدول واحد إضافي `fuel_shift_settlement_jobs`: مهمة واحدة لكل وردية مغلقة (قيد فريد) تحمل حالة التنفيذ والإيجار (lease) وإعادة المحاولة، كي يستردّها عاملٌ آخر
 * بعد سقوط العامل أو انقطاع الاتصال دون ازدواج تنفيذ. **لا فاتورة ولا سند ولا قيد ولا حركة مخزون هنا** — المحرك الفعلي يأتي مع P1-3b-2 بموافقة جديدة.
 *
 * ═══ الحراس (في القاعدة لا في التطبيق وحده، PostgreSQL وSQLite) ═══
 *  - قيد فريد `(tenant_id, fuel_shift_id)`: لا مهمتان لوردية واحدة.
 *  - الحالات والنتائج وعدّادات الإعادة بقيم صالحة فقط (CHECK على PostgreSQL، مُشغّلات على SQLite).
 *  - هوية المهمة (المستأجر/الفرع/المحطة/الوردية) ثابتة؛ وإدراجها يتحقق من اتساقها مع الوردية.
 *  - `completed` حالة نهائية: لا تحديث بعدها. لا DELETE ما دام المستأجر موجوداً.
 *
 * التراجع يرفض متى وُجد أي صف.
 */
return new class extends Migration
{
    private const TABLE = 'fuel_shift_settlement_jobs';

    private const STATUSES = ['queued', 'running', 'completed', 'failed'];

    private const OUTCOMES = ['blocked', 'awaiting_engine', 'disabled', 'posted'];

    public function up(): void
    {
        Schema::create(self::TABLE, function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained();
            $table->foreignUuid('fuel_station_id')->constrained('fuel_stations');
            $table->foreignUuid('fuel_shift_id')->constrained('fuel_shifts');

            $table->string('status', 16)->default('queued');
            $table->string('last_outcome', 24)->nullable();
            $table->json('blocked_reasons')->nullable();           // رموز ثابتة غير مالية فقط (لا قيم ولا PII)

            // `attempts` = تنفيذات انتهت بخطأ أو انهيار عامل (ميزانية الإعادة)؛ `checks` = تقييمات اكتملت (محجوب/بانتظار المحرك) ولا تُستهلك بها الميزانية.
            $table->unsignedSmallInteger('attempts')->default(0);
            $table->unsignedSmallInteger('max_attempts')->default(5);
            $table->unsignedInteger('checks')->default(0);

            $table->timestamp('next_attempt_at');
            $table->string('locked_by', 64)->nullable();            // رمز العامل الحامل للإيجار (حاجز fencing)
            $table->timestamp('locked_until')->nullable();

            $table->string('last_error_code', 40)->nullable();      // رمز ثابت (connection_lost, deadlock, lock_timeout, worker_lost, unexpected)
            $table->timestamp('last_error_at')->nullable();
            $table->timestamp('last_checked_at')->nullable();
            $table->timestamp('completed_at')->nullable();

            $table->foreignUuid('triggered_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'fuel_shift_id'], 'fuel_shift_settlement_jobs_shift_unique');
            $table->index(['status', 'next_attempt_at'], 'fuel_shift_settlement_jobs_due_index');
            $table->index(['tenant_id', 'fuel_station_id', 'status'], 'fuel_shift_settlement_jobs_station_index');
        });

        if (DB::getDriverName() === 'pgsql') {
            $this->createPostgresGuards();
        } else {
            $this->createSqliteGuards();
        }
    }

    public function down(): void
    {
        if (Schema::hasTable(self::TABLE) && DB::table(self::TABLE)->exists()) {
            throw new RuntimeException('لا يمكن التراجع: جدول مهام تسوية الورديات يحتوي صفوفاً.');
        }
        Schema::dropIfExists(self::TABLE);
        if (DB::getDriverName() === 'pgsql') {
            foreach (['fuel_settlement_job_guard_update', 'fuel_settlement_job_guard_delete', 'fuel_settlement_job_check_insert'] as $fn) {
                DB::statement("DROP FUNCTION IF EXISTS {$fn}() CASCADE");
            }
        }
    }

    private function createPostgresGuards(): void
    {
        $statuses = "'".implode("','", self::STATUSES)."'";
        $outcomes = "'".implode("','", self::OUTCOMES)."'";
        DB::statement("ALTER TABLE fuel_shift_settlement_jobs ADD CONSTRAINT fuel_shift_settlement_jobs_check CHECK (
            status IN ({$statuses})
            AND (last_outcome IS NULL OR last_outcome IN ({$outcomes}))
            AND attempts >= 0 AND max_attempts >= 1 AND checks >= 0
            AND ((status = 'running') = (locked_by IS NOT NULL AND locked_until IS NOT NULL))
            AND ((status IN ('completed','failed')) = (completed_at IS NOT NULL))
        )");

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION fuel_settlement_job_check_insert() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM fuel_shifts s
                    WHERE s.id = NEW.fuel_shift_id AND s.tenant_id = NEW.tenant_id AND s.branch_id = NEW.branch_id AND s.fuel_station_id = NEW.fuel_station_id
                ) THEN
                    RAISE EXCEPTION 'fuel_shift_settlement_jobs: shift does not belong to the same tenant, branch and station';
                END IF;
                RETURN NEW;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER fuel_shift_settlement_jobs_check_insert BEFORE INSERT ON fuel_shift_settlement_jobs FOR EACH ROW EXECUTE FUNCTION fuel_settlement_job_check_insert()');

        // الهوية ثابتة؛ `completed` نهائية (لا تحديث بعدها).
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION fuel_settlement_job_guard_update() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF OLD.status = 'completed' THEN
                    RAISE EXCEPTION 'fuel_shift_settlement_jobs: a completed job is final';
                END IF;
                IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
                   OR NEW.fuel_station_id IS DISTINCT FROM OLD.fuel_station_id OR NEW.fuel_shift_id IS DISTINCT FROM OLD.fuel_shift_id
                   OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
                    RAISE EXCEPTION 'fuel_shift_settlement_jobs: job identity is immutable';
                END IF;
                RETURN NEW;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER fuel_shift_settlement_jobs_guard_update BEFORE UPDATE ON fuel_shift_settlement_jobs FOR EACH ROW EXECUTE FUNCTION fuel_settlement_job_guard_update()');

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION fuel_settlement_job_guard_delete() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
                    RAISE EXCEPTION 'fuel_shift_settlement_jobs: jobs cannot be deleted';
                END IF;
                RETURN OLD;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER fuel_shift_settlement_jobs_guard_delete BEFORE DELETE ON fuel_shift_settlement_jobs FOR EACH ROW EXECUTE FUNCTION fuel_settlement_job_guard_delete()');
    }

    private function createSqliteGuards(): void
    {
        $t = self::TABLE;
        $statuses = "'".implode("','", self::STATUSES)."'";
        $outcomes = "'".implode("','", self::OUTCOMES)."'";
        $bad = "NEW.status NOT IN ({$statuses}) OR (NEW.last_outcome IS NOT NULL AND NEW.last_outcome NOT IN ({$outcomes})) OR NEW.attempts < 0 OR NEW.max_attempts < 1 OR NEW.checks < 0 "
            ."OR ((NEW.status = 'running') <> (NEW.locked_by IS NOT NULL AND NEW.locked_until IS NOT NULL)) OR ((NEW.status IN ('completed','failed')) <> (NEW.completed_at IS NOT NULL))";
        DB::unprepared("CREATE TRIGGER {$t}_check_values_insert BEFORE INSERT ON {$t} WHEN {$bad} BEGIN SELECT RAISE(ABORT, '{$t}: invalid status, outcome or counters'); END");
        DB::unprepared("CREATE TRIGGER {$t}_check_values_update BEFORE UPDATE ON {$t} WHEN {$bad} BEGIN SELECT RAISE(ABORT, '{$t}: invalid status, outcome or counters'); END");
        DB::unprepared("CREATE TRIGGER {$t}_check_insert BEFORE INSERT ON {$t} WHEN NOT EXISTS (SELECT 1 FROM fuel_shifts s WHERE s.id = NEW.fuel_shift_id AND s.tenant_id = NEW.tenant_id AND s.branch_id = NEW.branch_id AND s.fuel_station_id = NEW.fuel_station_id) BEGIN SELECT RAISE(ABORT, '{$t}: shift does not belong to the same tenant, branch and station'); END");
        DB::unprepared("CREATE TRIGGER {$t}_guard_update_final BEFORE UPDATE ON {$t} WHEN OLD.status = 'completed' BEGIN SELECT RAISE(ABORT, '{$t}: a completed job is final'); END");
        DB::unprepared("CREATE TRIGGER {$t}_guard_update_identity BEFORE UPDATE ON {$t} WHEN OLD.tenant_id IS NOT NEW.tenant_id OR OLD.branch_id IS NOT NEW.branch_id OR OLD.fuel_station_id IS NOT NEW.fuel_station_id OR OLD.fuel_shift_id IS NOT NEW.fuel_shift_id OR OLD.created_at IS NOT NEW.created_at BEGIN SELECT RAISE(ABORT, '{$t}: job identity is immutable'); END");
        DB::unprepared("CREATE TRIGGER {$t}_guard_delete BEFORE DELETE ON {$t} WHEN EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) BEGIN SELECT RAISE(ABORT, '{$t}: jobs cannot be deleted'); END");
    }
};
