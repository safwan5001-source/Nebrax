<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * FUEL-B3 — سجل تدقيق تغييرات الأدوار والصلاحيات ونطاق الوصول (الأدوار، المستخدمون، موظفو الوقود، نطاق المحطات).
 *
 * يسجّل **من** (الفاعل) غيّر **من** (المستخدم المستهدف) **ماذا** (لقطتا قبل/بعد) و**متى**، وكذلك **المحاولات المرفوضة** (`outcome = denied`)
 * برمز الرفض فقط. لا كلمات مرور ولا رموز ولا أسرار: تُحجب قبل التخزين (انظر `AccessChangeAuditor`).
 *
 * ═══ append-only في القاعدة (لا في التطبيق وحده) ═══ — نمط `fuel_station_audit_events` نفسه:
 *  - UPDATE ممنوع دائماً. DELETE ممنوع ما دام المستأجر موجوداً (حذف المستأجر المتسلسل يمرّ).
 *  - لا مفاتيح أجنبية على الفاعل/المستهدف/الموضوع: التدقيق يبقى سليماً لو حُذف مستخدم أو دور. المرجع المقيَّد الوحيد `tenant_id`.
 *
 * التراجع يرفض متى وُجد أي صف (سجل التدقيق لا يُسقط بالتراجع).
 */
return new class extends Migration
{
    private const TABLE = 'access_change_events';

    public function up(): void
    {
        Schema::create(self::TABLE, function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->uuid('actor_id')->nullable();
            $table->uuid('target_user_id')->nullable();
            $table->string('subject_type', 40); // role | user | fuel_staff
            $table->uuid('subject_id')->nullable();
            $table->string('action', 80); // role.created | user.role_changed | fuel_staff.updated …
            $table->string('outcome', 12)->default('applied'); // applied | denied
            $table->json('before')->nullable();
            $table->json('after')->nullable();
            $table->string('reason', 500)->nullable();
            $table->string('denial_reason', 255)->nullable();
            $table->timestamp('occurred_at')->useCurrent();
            $table->timestamps();

            $table->index(['tenant_id', 'subject_type', 'subject_id', 'occurred_at'], 'access_audit_subject_idx');
            $table->index(['tenant_id', 'target_user_id', 'occurred_at'], 'access_audit_target_idx');
            $table->index(['tenant_id', 'actor_id', 'occurred_at'], 'access_audit_actor_idx');
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
            throw new RuntimeException('Rollback refused: access_change_events contains audit rows. Audit trails are never dropped by rollback.');
        }

        Schema::dropIfExists(self::TABLE);
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('DROP FUNCTION IF EXISTS access_change_events_guard_update()');
            DB::statement('DROP FUNCTION IF EXISTS access_change_events_guard_delete()');
        }
    }

    private function createPostgresGuards(): void
    {
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION access_change_events_guard_update() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                RAISE EXCEPTION 'access_change_events: audit events are immutable';
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER access_audit_no_update BEFORE UPDATE ON access_change_events FOR EACH ROW EXECUTE FUNCTION access_change_events_guard_update()');

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION access_change_events_guard_delete() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
                    RAISE EXCEPTION 'access_change_events: audit events cannot be deleted';
                END IF;
                RETURN OLD;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER access_audit_no_delete BEFORE DELETE ON access_change_events FOR EACH ROW EXECUTE FUNCTION access_change_events_guard_delete()');
    }

    private function createSqliteGuards(): void
    {
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER access_audit_no_update BEFORE UPDATE ON access_change_events
            BEGIN
                SELECT RAISE(ABORT, 'access_change_events: audit events are immutable');
            END
            SQL);
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER access_audit_no_delete BEFORE DELETE ON access_change_events
            WHEN EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id)
            BEGIN
                SELECT RAISE(ABORT, 'access_change_events: audit events cannot be deleted');
            END
            SQL);
    }
};
