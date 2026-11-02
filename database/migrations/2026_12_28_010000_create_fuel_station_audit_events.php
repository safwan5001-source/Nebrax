<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * FS-22 (PR-12c) — سجل تدقيق بالفاعل للبيانات الرئيسية لمحطات الوقود وسجل الأجهزة.
 *
 * يسجّل **من** غيّر **ماذا** و**متى**: المحطات/المنتجات/الخزانات (بنقاط المعايرة)/المضخات/الفوهات/الأجهزة — إنشاءً وتعديلاً وحذفاً،
 * بلقطتَي قبل/بعد للحقول المتغيّرة فقط (بلا أي سرّ أو اعتماد: يُحجب قبل التخزين، انظر `FuelStationAuditTrail`).
 *
 * ═══ append-only في القاعدة (لا في التطبيق وحده) ═══
 *  - UPDATE ممنوع دائماً. DELETE ممنوع ما دام المستأجر موجوداً (حذف المستأجر المتسلسل يمرّ لأن صفه يزول أولاً — كنمط `zatca_chain_entries`).
 *  - لذلك لا مفاتيح أجنبية على `branch_id` / `fuel_station_id` / `actor_id`: `ON DELETE SET NULL` هو UPDATE وسيصطدم بالمنع، والتدقيق يجب
 *    أن يبقى سليماً لو حُذفت محطة أو مستخدم. المرجع الوحيد المقيَّد هو `tenant_id` (CASCADE عند حذف المستأجر).
 *  - نموذج Eloquent يرفض التعديل/الحذف أيضاً (طبقة أولى)، والمشغّلات هي الحارس الأخير ضد SQL الخام.
 *
 * التراجع يرفض متى وُجد أي صف (سجل التدقيق لا يُسقط بالتراجع).
 */
return new class extends Migration
{
    private const TABLE = 'fuel_station_audit_events';

    public function up(): void
    {
        Schema::create(self::TABLE, function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->uuid('branch_id')->nullable();
            $table->uuid('fuel_station_id')->nullable();
            // لقطة مخزن المحطة وقت الحدث: تقييد القراءة بنطاق المخزن لا يحتاج بقاء المحطة (قد تُحذف).
            $table->uuid('warehouse_id')->nullable();
            $table->uuid('actor_id')->nullable();
            $table->string('action', 80); // station.created | tank.updated | device.deleted …
            $table->string('subject_type', 120);
            $table->uuid('subject_id');
            $table->json('before')->nullable();
            $table->json('after')->nullable();
            $table->string('reason', 500)->nullable();
            $table->timestamp('occurred_at')->useCurrent();
            $table->timestamps();

            $table->index(['tenant_id', 'subject_type', 'subject_id', 'occurred_at'], 'fuel_audit_subject_idx');
            $table->index(['tenant_id', 'fuel_station_id', 'occurred_at'], 'fuel_audit_station_idx');
            $table->index(['tenant_id', 'actor_id', 'occurred_at'], 'fuel_audit_actor_idx');
        });

        if (DB::connection()->getDriverName() === 'pgsql') {
            $this->createPostgresGuards();
        } else {
            $this->createSqliteGuards();
        }
    }

    public function down(): void
    {
        if (Schema::hasTable(self::TABLE) && DB::table(self::TABLE)->exists()) {
            throw new RuntimeException('Rollback refused: fuel_station_audit_events contains audit rows. Audit trails are never dropped by rollback.');
        }

        Schema::dropIfExists(self::TABLE);
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('DROP FUNCTION IF EXISTS fuel_station_audit_events_guard_update()');
            DB::statement('DROP FUNCTION IF EXISTS fuel_station_audit_events_guard_delete()');
        }
    }

    private function createPostgresGuards(): void
    {
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION fuel_station_audit_events_guard_update() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                RAISE EXCEPTION 'fuel_station_audit_events: audit events are immutable';
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER fuel_audit_no_update BEFORE UPDATE ON fuel_station_audit_events FOR EACH ROW EXECUTE FUNCTION fuel_station_audit_events_guard_update()');

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION fuel_station_audit_events_guard_delete() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
                    RAISE EXCEPTION 'fuel_station_audit_events: audit events cannot be deleted';
                END IF;
                RETURN OLD;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER fuel_audit_no_delete BEFORE DELETE ON fuel_station_audit_events FOR EACH ROW EXECUTE FUNCTION fuel_station_audit_events_guard_delete()');
    }

    private function createSqliteGuards(): void
    {
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER fuel_audit_no_update BEFORE UPDATE ON fuel_station_audit_events
            BEGIN
                SELECT RAISE(ABORT, 'fuel_station_audit_events: audit events are immutable');
            END
            SQL);
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER fuel_audit_no_delete BEFORE DELETE ON fuel_station_audit_events
            WHEN EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id)
            BEGIN
                SELECT RAISE(ABORT, 'fuel_station_audit_events: audit events cannot be deleted');
            END
            SQL);
    }
};
