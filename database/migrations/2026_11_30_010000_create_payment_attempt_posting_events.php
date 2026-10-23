<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * PAY-H2-02d (ADR-0006 M5-R1) — سجل قرارات إعادة ترحيل التقاط محجوب بفترة مقفلة: الفاعل والسبب والنتيجة. **ثابت** (append-only)
 * بمُشغّلات تمنع UPDATE/DELETE (PostgreSQL وSQLite)؛ حذف المستأجر المتسلسل يمرّ لأن الفحص يستثني المستأجر المحذوف في العبارة نفسها.
 * إضافي بالكامل: جدول جديد بلا تعديل لأي موجود. `down()` يرفض عند وجود صفوف (إصلاح إلى الأمام فقط).
 */
return new class extends Migration
{
    private const TABLE = 'payment_attempt_posting_events';

    public function up(): void
    {
        Schema::create(self::TABLE, function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('payment_attempt_id')->constrained('payment_attempts');
            $table->string('action', 16);          // repost
            $table->string('outcome', 16);         // posted | still_blocked
            $table->uuid('actor_id');              // المستخدم الذي قرّر (لا مسار نظامي لهذا الفعل)
            $table->string('reason', 500);
            $table->timestamp('created_at')->nullable();

            $table->index(['tenant_id', 'payment_attempt_id'], 'payment_attempt_posting_events_attempt_idx');
        });

        $this->addGuards();
    }

    public function down(): void
    {
        if (Schema::hasTable(self::TABLE) && DB::table(self::TABLE)->exists()) {
            throw new RuntimeException('Rollback refused: payment_attempt_posting_events holds audit rows. Fix forward instead.');
        }
        $this->dropGuards();
        Schema::dropIfExists(self::TABLE);
    }

    private function addGuards(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::unprepared("CREATE OR REPLACE FUNCTION payment_attempt_posting_events_immutable() RETURNS trigger AS \$\$
BEGIN
    IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'payment_attempt_posting_events is append-only';
END;
\$\$ LANGUAGE plpgsql");
            DB::unprepared('CREATE TRIGGER payment_attempt_posting_events_immutable BEFORE UPDATE OR DELETE ON '.self::TABLE
                .' FOR EACH ROW EXECUTE FUNCTION payment_attempt_posting_events_immutable()');

            return;
        }
        foreach (['UPDATE', 'DELETE'] as $event) {
            DB::unprepared('CREATE TRIGGER payment_attempt_posting_events_no_'.strtolower($event).' BEFORE '.$event.' ON '.self::TABLE
                ." BEGIN SELECT RAISE(ABORT, 'payment_attempt_posting_events is append-only'); END");
        }
    }

    private function dropGuards(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::unprepared('DROP TRIGGER IF EXISTS payment_attempt_posting_events_immutable ON '.self::TABLE);
            DB::unprepared('DROP FUNCTION IF EXISTS payment_attempt_posting_events_immutable()');

            return;
        }
        foreach (['update', 'delete'] as $event) {
            DB::unprepared('DROP TRIGGER IF EXISTS payment_attempt_posting_events_no_'.$event);
        }
    }
};
