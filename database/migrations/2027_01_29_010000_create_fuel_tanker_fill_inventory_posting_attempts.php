<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * TANKER-PR6B-2 — سجل **محاولات** ترحيل/عكس سند تعبئة الصهريج مخزنياً (دليل تدقيقي append-only). **الجدول فارغ ولا كاتب له في هذه الشريحة:** لا خدمة تسجّل محاولة فعلية
 * ولا مسار يستدعيه؛ الكاتب الأول هو PR-6B-3 (خدمة الترحيل). النموذج `FuelTankerFillInventoryPostingAttempt` يرفض أي كتابة برمجياً حتى ذلك الحين.
 *
 * يضمن في القاعدة (PostgreSQL وSQLite): ربط صحيح بالسند (المؤسسة والمحطة والفرع نفسها)، نوع العملية `post|reverse` ونتيجتها `succeeded|rejected|failed`، رمز سبب إلزامي لغير الناجحة
 * وممنوع للناجحة، منفّذ ووقت إلزاميان، ولا تعديل ولا حذف (يُحذف مع المستأجر وحده). محاولة **ناجحة** تشترط ترحيلاً مطابقاً (`post` ⇒ ترحيل للسند، `reverse` ⇒ ترحيل معكوس)،
 * وغير الناجحة بلا ترحيل. فهرسان جزئيان فريدان: نجاح واحد لكل (سند، عملية)، وللمفتاح الدلالي نجاح واحد فقط (المحاولات الفاشلة المتكررة بالمفتاح نفسه مسموحة: سجل لا قيد).
 */
return new class extends Migration
{
    private const TABLE = 'fuel_tanker_fill_inventory_posting_attempts';

    public function up(): void
    {
        Schema::create(self::TABLE, function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained();
            $table->foreignUuid('fuel_tanker_fill_id')->constrained('fuel_tanker_fills');
            $table->foreignUuid('fuel_station_id')->constrained('fuel_stations');
            $table->foreignUuid('posting_id')->nullable()->constrained('fuel_tanker_fill_inventory_postings');
            $table->string('operation_type', 16);
            $table->string('outcome', 16);
            $table->string('reason_code', 64)->nullable();
            $table->string('idempotency_key', 128)->nullable();
            $table->foreignUuid('actor_id')->constrained('users');
            $table->timestamp('attempted_at');
            $table->timestamp('created_at')->nullable();

            $table->index(['tenant_id', 'fuel_tanker_fill_id', 'attempted_at'], 'fuel_tanker_fill_attempt_fill_idx');
            $table->index(['tenant_id', 'idempotency_key'], 'fuel_tanker_fill_attempt_key_idx');
        });

        DB::statement("CREATE UNIQUE INDEX fuel_tanker_fill_attempt_success_unique ON fuel_tanker_fill_inventory_posting_attempts (fuel_tanker_fill_id, operation_type) WHERE outcome = 'succeeded'");
        DB::statement("CREATE UNIQUE INDEX fuel_tanker_fill_attempt_success_key_unique ON fuel_tanker_fill_inventory_posting_attempts (tenant_id, operation_type, idempotency_key) WHERE outcome = 'succeeded' AND idempotency_key IS NOT NULL");

        $driver = DB::connection()->getDriverName();
        if ($driver === 'pgsql') {
            $this->postgresGuards();
        } elseif ($driver === 'sqlite') {
            $this->sqliteGuards();
        }
    }

    public function down(): void
    {
        if (Schema::hasTable(self::TABLE) && DB::table(self::TABLE)->exists()) {
            throw new RuntimeException('Rollback refused: fuel_tanker_fill_inventory_posting_attempts contains attempt records.');
        }

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('DROP FUNCTION IF EXISTS fuel_tanker_fill_attempts_guard_insert() CASCADE');
            DB::statement('DROP FUNCTION IF EXISTS fuel_tanker_fill_attempts_guard_update() CASCADE');
            DB::statement('DROP FUNCTION IF EXISTS fuel_tanker_fill_attempts_guard_delete() CASCADE');
        }
        Schema::dropIfExists(self::TABLE);
    }

    private function postgresGuards(): void
    {
        DB::statement("ALTER TABLE fuel_tanker_fill_inventory_posting_attempts
            ADD CONSTRAINT fuel_tanker_fill_attempt_shape CHECK (
                operation_type IN ('post', 'reverse')
                AND outcome IN ('succeeded', 'rejected', 'failed')
                AND (outcome = 'succeeded' OR (reason_code IS NOT NULL AND posting_id IS NULL))
                AND (outcome <> 'succeeded' OR (reason_code IS NULL AND posting_id IS NOT NULL))
            )");

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION fuel_tanker_fill_attempts_guard_insert() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM fuel_tanker_fills f
                    WHERE f.id = NEW.fuel_tanker_fill_id AND f.tenant_id = NEW.tenant_id AND f.branch_id = NEW.branch_id AND f.fuel_station_id = NEW.fuel_station_id
                ) THEN
                    RAISE EXCEPTION 'fuel_tanker_fill_inventory_posting_attempts: attempt must reference a fill of the same tenant, branch and station';
                END IF;
                IF NEW.outcome = 'succeeded' AND NOT EXISTS (
                    SELECT 1 FROM fuel_tanker_fill_inventory_postings p
                    WHERE p.id = NEW.posting_id AND p.tenant_id = NEW.tenant_id AND p.fuel_tanker_fill_id = NEW.fuel_tanker_fill_id
                        AND ((NEW.operation_type = 'post') OR (NEW.operation_type = 'reverse' AND p.status = 'reversed'))
                ) THEN
                    RAISE EXCEPTION 'fuel_tanker_fill_inventory_posting_attempts: a succeeded attempt requires a matching (reversed, for reverse) posting of the same fill';
                END IF;
                RETURN NEW;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER fuel_tanker_fill_attempt_guard_insert BEFORE INSERT ON fuel_tanker_fill_inventory_posting_attempts FOR EACH ROW EXECUTE FUNCTION fuel_tanker_fill_attempts_guard_insert()');

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION fuel_tanker_fill_attempts_guard_update() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                RAISE EXCEPTION 'fuel_tanker_fill_inventory_posting_attempts: attempts are append-only';
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER fuel_tanker_fill_attempt_no_update BEFORE UPDATE ON fuel_tanker_fill_inventory_posting_attempts FOR EACH ROW EXECUTE FUNCTION fuel_tanker_fill_attempts_guard_update()');

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION fuel_tanker_fill_attempts_guard_delete() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
                    RAISE EXCEPTION 'fuel_tanker_fill_inventory_posting_attempts: attempts cannot be deleted (audit trail)';
                END IF;
                RETURN OLD;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER fuel_tanker_fill_attempt_no_delete BEFORE DELETE ON fuel_tanker_fill_inventory_posting_attempts FOR EACH ROW EXECUTE FUNCTION fuel_tanker_fill_attempts_guard_delete()');
    }

    private function sqliteGuards(): void
    {
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER fuel_tanker_fill_attempt_shape BEFORE INSERT ON fuel_tanker_fill_inventory_posting_attempts
            WHEN NEW.operation_type NOT IN ('post', 'reverse')
                OR NEW.outcome NOT IN ('succeeded', 'rejected', 'failed')
                OR (NEW.outcome <> 'succeeded' AND (NEW.reason_code IS NULL OR NEW.posting_id IS NOT NULL))
                OR (NEW.outcome = 'succeeded' AND (NEW.reason_code IS NOT NULL OR NEW.posting_id IS NULL))
                OR NOT EXISTS (
                    SELECT 1 FROM fuel_tanker_fills f
                    WHERE f.id = NEW.fuel_tanker_fill_id AND f.tenant_id = NEW.tenant_id AND f.branch_id = NEW.branch_id AND f.fuel_station_id = NEW.fuel_station_id
                )
                OR (NEW.outcome = 'succeeded' AND NOT EXISTS (
                    SELECT 1 FROM fuel_tanker_fill_inventory_postings p
                    WHERE p.id = NEW.posting_id AND p.tenant_id = NEW.tenant_id AND p.fuel_tanker_fill_id = NEW.fuel_tanker_fill_id
                        AND ((NEW.operation_type = 'post') OR (NEW.operation_type = 'reverse' AND p.status = 'reversed'))
                ))
            BEGIN
                SELECT RAISE(ABORT, 'fuel_tanker_fill_inventory_posting_attempts: invalid attempt shape or no matching fill/posting');
            END
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER fuel_tanker_fill_attempt_no_update BEFORE UPDATE ON fuel_tanker_fill_inventory_posting_attempts
            BEGIN
                SELECT RAISE(ABORT, 'fuel_tanker_fill_inventory_posting_attempts: attempts are append-only');
            END
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER fuel_tanker_fill_attempt_no_delete BEFORE DELETE ON fuel_tanker_fill_inventory_posting_attempts
            WHEN EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id)
            BEGIN
                SELECT RAISE(ABORT, 'fuel_tanker_fill_inventory_posting_attempts: attempts cannot be deleted (audit trail)');
            END
            SQL);
    }
};
