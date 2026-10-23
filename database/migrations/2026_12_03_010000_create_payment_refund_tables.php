<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * AWJ-PAYMENTS-HZ-01 / PAY-H3-01b — مخطط استرداد البوابة (ADR-0007، accepted). **إضافي فقط؛ لا ترحيل ولا قيد ولا مساس بجدول مالي قائم.**
 *
 * - `payment_refunds`: مستند الاسترداد (طلب ← اعتماد مستقل ← مزوّد ← ترحيل لاحقاً). الفصل (الطالب ≠ المعتمِد) يُفرض في القاعدة، وكذا لزوم معتمِد
 *   لكل حالة بعد الموافقة، وانتقالات الحالة المشروعة، وتجميد الحقول الهوياتية، وتساوي Σ التخصيصات مع المبلغ عند الاعتماد. فهرس جزئي فريد: إرسال واحد
 *   في الطيران لكل دفعة (`submitting`/`unknown`). لا حذف.
 * - `payment_refund_allocations`: تخصيص الاسترداد على إشعار دائن/مرتجع مبيعات (نمط `customer_refund_allocations`)، ثابت بعد مغادرة `requested`.
 * - `payment_refund_attempts` (سجل الاستدعاء) و`payment_refund_attempt_results` (النتيجة): ثابتان append-only؛ نتيجة نهائية واحدة لكل محاولة.
 * - `payment_refund_events`: تدقيق ثابت لكل انتقال وقرار بشري (على الاسترداد أو على الدفعة كعلم الاسترداد الخارجي).
 * - أعمدة على `payment_attempts`: `unrecognized_refund_at`/`unrecognized_refund_minor` (علم المراجعة، ADR-0007 §3/§5).
 *
 * `down()` يرفض متى وُجد أي صف أو علم (إصلاح إلى الأمام فقط).
 */
return new class extends Migration
{
    private const REFUNDS = 'payment_refunds';

    private const ALLOCATIONS = 'payment_refund_allocations';

    private const ATTEMPTS = 'payment_refund_attempts';

    private const RESULTS = 'payment_refund_attempt_results';

    private const EVENTS = 'payment_refund_events';

    private const STATUS = "'requested','approved','rejected','cancelled','submitting','confirmed','failed','unknown'";

    private const POSTING = "'pending','posted','blocked_period'";

    private const OUTCOMES = "'confirmed','rejected','unknown'";

    /** شكل صف الاسترداد (CHECK في PostgreSQL، مُشغّلات مكافئة في SQLite). */
    private const REFUND_SHAPE = "amount_minor > 0 AND status IN (%s) AND retry_count BETWEEN 0 AND 1 AND excess_minor >= 0 "
        .'AND (approved_by IS NULL OR approved_by <> requested_by) '
        ."AND (status NOT IN ('approved','submitting','confirmed','failed','unknown') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)) "
        ."AND (status <> 'confirmed' OR (confirmed_at IS NOT NULL AND provider_refunded_minor IS NOT NULL AND posting_status IS NOT NULL)) "
        ."AND (posting_status IS NULL OR (status = 'confirmed' AND posting_status IN (%s))) "
        ."AND (posting_status IS DISTINCT_FROM_PLACEHOLDER 'posted' OR (journal_entry_id IS NOT NULL AND posted_at IS NOT NULL AND accounting_date IS NOT NULL))";

    public function up(): void
    {
        Schema::create(self::REFUNDS, function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();   // يُورَّث من الالتقاط والمصادر (ADR §5-1)
            $table->string('number');
            $table->foreignUuid('partner_id')->constrained('partners');                              // يُشتق من الالتقاط المرحَّل؛ بلا CASCADE (حذف المستأجر المتسلسل يمرّ لأن الفحص عند نهاية العبارة)
            $table->foreignUuid('payment_attempt_id')->constrained('payment_attempts');
            $table->foreignUuid('payment_gateway_id')->constrained('payment_gateways');
            $table->bigInteger('amount_minor');
            $table->char('currency', 3);
            $table->string('status', 16)->default('requested');
            $table->string('idempotency_key', 128);
            $table->uuid('requested_by');
            $table->timestamp('requested_at');
            $table->uuid('approved_by')->nullable();
            $table->timestamp('approved_at')->nullable();
            $table->uuid('rejected_by')->nullable();
            $table->timestamp('rejected_at')->nullable();
            $table->string('reject_reason', 500)->nullable();
            $table->uuid('cancelled_by')->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->string('cancel_reason', 500)->nullable();
            $table->string('provider_refund_ref', 191)->nullable();
            $table->bigInteger('provider_refunded_minor')->nullable();      // التراكمي لدى المزوّد عند التأكيد
            $table->timestamp('provider_refunded_at')->nullable();          // تاريخ المزوّد الأصلي — يُحفظ ولا يؤرَّخ به القيد (قرار المالك 3)
            $table->timestamp('confirmed_at')->nullable();                  // لحظة التأكيد المحلي — منها التاريخ المحاسبي
            $table->string('failure_code', 64)->nullable();
            $table->unsignedSmallInteger('retry_count')->default(0);
            $table->bigInteger('excess_minor')->default(0);                 // فائض خارجي رُصد في الردّ المباشر (ADR §5-4)
            $table->string('posting_status', 16)->nullable();               // يضعه التأكيد؛ الترحيل شريحة 01c
            $table->date('accounting_date')->nullable();
            $table->timestamp('posted_at')->nullable();
            $table->foreignUuid('journal_entry_id')->nullable()->constrained('journal_entries');
            $table->text('posting_blocked_reason')->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'idempotency_key'], 'payment_refunds_idempotency_unique');
            $table->unique(['tenant_id', 'branch_id', 'number'], 'payment_refunds_number_unique');
            $table->index(['tenant_id', 'payment_attempt_id', 'status'], 'payment_refunds_attempt_status_idx');
            $table->index(['tenant_id', 'status'], 'payment_refunds_status_idx');
            $table->index(['tenant_id', 'partner_id'], 'payment_refunds_partner_idx');
            $table->index(['tenant_id', 'posting_status'], 'payment_refunds_posting_idx');
        });

        // NULL لا يتصادم في الفهرس المركب؛ للمستندات بلا فرع قيدٌ صريح (كـ customer_refunds).
        DB::statement('CREATE UNIQUE INDEX payment_refunds_unbranched_number_unique ON payment_refunds (tenant_id, number) WHERE branch_id IS NULL');
        // إرسال واحد في الطيران لكل دفعة: يجعل خط الأساس لدى المزوّد معلوماً دائماً (ADR §5-3).
        DB::statement("CREATE UNIQUE INDEX payment_refunds_inflight_unique ON payment_refunds (payment_attempt_id) WHERE status IN ('submitting','unknown')");
        // مفتاح الترحيل الفريد لكل استرداد (01c): قيد واحد.
        DB::statement('CREATE UNIQUE INDEX payment_refunds_journal_unique ON payment_refunds (journal_entry_id) WHERE journal_entry_id IS NOT NULL');

        Schema::create(self::ALLOCATIONS, function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('payment_refund_id')->constrained(self::REFUNDS);
            $table->string('source_type');
            $table->uuid('source_id');
            $table->bigInteger('amount_minor');
            $table->timestamps();

            $table->unique(['payment_refund_id', 'source_type', 'source_id'], 'payment_refund_allocations_unique_target');
            $table->index(['tenant_id', 'source_type', 'source_id'], 'payment_refund_allocations_source_idx');
        });

        Schema::create(self::ATTEMPTS, function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('payment_refund_id')->constrained(self::REFUNDS);
            $table->unsignedSmallInteger('seq');
            $table->bigInteger('baseline_refunded_minor');      // التراكمي لدى المزوّد قبل الاستدعاء
            $table->bigInteger('amount_minor');
            $table->timestamp('created_at')->nullable();

            $table->unique(['payment_refund_id', 'seq'], 'payment_refund_attempts_seq_unique');
        });

        Schema::create(self::RESULTS, function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('payment_refund_attempt_id')->constrained(self::ATTEMPTS);
            $table->string('outcome', 16);
            $table->bigInteger('observed_refunded_minor')->nullable();
            $table->string('provider_ref', 191)->nullable();
            $table->string('error_code', 64)->nullable();
            $table->bigInteger('excess_minor')->default(0);
            $table->timestamp('created_at')->nullable();

            $table->index(['tenant_id', 'payment_refund_attempt_id'], 'payment_refund_results_attempt_idx');
        });
        // نتيجة نهائية واحدة (confirmed|rejected) ونتيجة unknown واحدة كحد أقصى لكل محاولة.
        DB::statement("CREATE UNIQUE INDEX payment_refund_results_final_unique ON payment_refund_attempt_results (payment_refund_attempt_id) WHERE outcome IN ('confirmed','rejected')");
        DB::statement("CREATE UNIQUE INDEX payment_refund_results_unknown_unique ON payment_refund_attempt_results (payment_refund_attempt_id) WHERE outcome = 'unknown'");

        Schema::create(self::EVENTS, function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->uuid('payment_refund_id')->nullable();       // null ⇒ حدث على مستوى الدفعة (علم الاسترداد الخارجي)
            $table->foreignUuid('payment_attempt_id')->constrained('payment_attempts');
            $table->string('action', 40);
            $table->string('from_status', 16)->nullable();
            $table->string('to_status', 16)->nullable();
            $table->uuid('actor_id')->nullable();                // null ⇒ مسار نظامي (مطابِق/مزامنة)
            $table->string('reason', 500)->nullable();
            $table->text('meta')->nullable();                    // json بلا أسرار
            $table->timestamp('created_at')->nullable();

            $table->index(['tenant_id', 'payment_attempt_id'], 'payment_refund_events_attempt_idx');
            $table->index(['tenant_id', 'payment_refund_id'], 'payment_refund_events_refund_idx');
        });

        Schema::table('payment_attempts', function (Blueprint $table) {
            $table->timestamp('unrecognized_refund_at')->nullable();
            $table->bigInteger('unrecognized_refund_minor')->nullable();   // التراكمي المرصود لدى المزوّد وقت الوسم
        });

        $this->addShapeGuards();
        $this->addBehaviourGuards();
    }

    public function down(): void
    {
        foreach ([self::EVENTS, self::RESULTS, self::ATTEMPTS, self::ALLOCATIONS, self::REFUNDS] as $table) {
            if (Schema::hasTable($table) && DB::table($table)->exists()) {
                throw new RuntimeException("Rollback refused: {$table} contains rows (financial references). Fix forward instead.");
            }
        }
        if (Schema::hasColumn('payment_attempts', 'unrecognized_refund_at') && DB::table('payment_attempts')->whereNotNull('unrecognized_refund_at')->exists()) {
            throw new RuntimeException('Rollback refused: payment_attempts carries refund review flags. Fix forward instead.');
        }

        $this->dropGuards();
        Schema::table('payment_attempts', function (Blueprint $table) {
            $table->dropColumn(['unrecognized_refund_at', 'unrecognized_refund_minor']);
        });
        Schema::dropIfExists(self::EVENTS);
        Schema::dropIfExists(self::RESULTS);
        Schema::dropIfExists(self::ATTEMPTS);
        Schema::dropIfExists(self::ALLOCATIONS);
        Schema::dropIfExists(self::REFUNDS);
    }

    private function pgsql(): bool
    {
        return DB::connection()->getDriverName() === 'pgsql';
    }

    // ───────────────────────── الشكل (CHECK / مُشغّلات الشكل) ─────────────────────────

    private function addShapeGuards(): void
    {
        $refundShape = sprintf(str_replace('IS DISTINCT_FROM_PLACEHOLDER', 'IS DISTINCT FROM', self::REFUND_SHAPE), self::STATUS, self::POSTING);

        if ($this->pgsql()) {
            DB::statement('ALTER TABLE '.self::REFUNDS.' ADD CONSTRAINT payment_refunds_shape_chk CHECK ('.$refundShape.')');
            DB::statement('ALTER TABLE '.self::ALLOCATIONS.' ADD CONSTRAINT payment_refund_allocations_shape_chk CHECK (amount_minor > 0)');
            DB::statement('ALTER TABLE '.self::ATTEMPTS.' ADD CONSTRAINT payment_refund_attempts_shape_chk CHECK (amount_minor > 0 AND baseline_refunded_minor >= 0 AND seq >= 1)');
            DB::statement('ALTER TABLE '.self::RESULTS.' ADD CONSTRAINT payment_refund_results_shape_chk CHECK (outcome IN ('.self::OUTCOMES.') AND excess_minor >= 0)');

            return;
        }

        // SQLite لا يضيف CHECK بعد الإنشاء: مُشغّلات بالشرط نفسه (IS NOT يقابل IS DISTINCT FROM).
        $sqliteShape = sprintf(str_replace('IS DISTINCT_FROM_PLACEHOLDER', 'IS NOT', self::REFUND_SHAPE), self::STATUS, self::POSTING);
        $this->sqliteShapeTrigger('payment_refunds_shape', self::REFUNDS, $this->prefixNew($sqliteShape));
        $this->sqliteShapeTrigger('payment_refund_allocations_shape', self::ALLOCATIONS, 'NEW.amount_minor > 0');
        $this->sqliteShapeTrigger('payment_refund_attempts_shape', self::ATTEMPTS, 'NEW.amount_minor > 0 AND NEW.baseline_refunded_minor >= 0 AND NEW.seq >= 1');
        $this->sqliteShapeTrigger('payment_refund_results_shape', self::RESULTS, 'NEW.outcome IN ('.self::OUTCOMES.') AND NEW.excess_minor >= 0');
    }

    /** يضيف البادئة NEW. لأسماء أعمدة شكل الاسترداد المعروفة (قائمة مغلقة، لا تحليل نصي حر). */
    private function prefixNew(string $expression): string
    {
        $columns = ['amount_minor', 'status', 'retry_count', 'excess_minor', 'approved_by', 'requested_by', 'approved_at', 'confirmed_at',
            'provider_refunded_minor', 'posting_status', 'journal_entry_id', 'posted_at', 'accounting_date'];
        foreach ($columns as $column) {
            $expression = preg_replace('/(?<![A-Za-z_.])'.$column.'(?![A-Za-z_])/', 'NEW.'.$column, $expression);
        }

        return $expression;
    }

    private function sqliteShapeTrigger(string $name, string $table, string $valid): void
    {
        foreach (['INSERT', 'UPDATE'] as $event) {
            DB::unprepared('CREATE TRIGGER '.$name.'_'.strtolower($event)." BEFORE {$event} ON {$table} WHEN NOT ({$valid}) BEGIN SELECT RAISE(ABORT, '{$table}: invalid shape'); END");
        }
    }

    // ───────────────────────── السلوك (انتقالات/تجميد/ثبات) ─────────────────────────

    /** @return list<array{0:string,1:string,2:string}> [اسم القاعدة، الحدث، شرط الرفض بصياغة مشتركة] */
    private function refundRules(): array
    {
        $changed = fn (string $column): string => $this->pgsql()
            ? "NEW.{$column} IS DISTINCT FROM OLD.{$column}"
            : "NEW.{$column} IS NOT OLD.{$column}";

        $frozen = [];
        foreach (['tenant_id', 'number', 'partner_id', 'payment_attempt_id', 'payment_gateway_id', 'amount_minor', 'currency', 'requested_by', 'requested_at', 'idempotency_key'] as $column) {
            $frozen[] = $changed($column);
        }
        $onceSet = [];
        foreach (['approved_by', 'approved_at', 'confirmed_at', 'provider_refunded_at', 'provider_refund_ref', 'journal_entry_id', 'accounting_date', 'posted_at', 'rejected_by', 'cancelled_by'] as $column) {
            $onceSet[] = "(OLD.{$column} IS NOT NULL AND ".$changed($column).')';
        }

        $legal = "(OLD.status = 'requested' AND NEW.status IN ('approved','rejected','cancelled')) "
            ."OR (OLD.status = 'approved' AND NEW.status IN ('submitting','cancelled')) "
            ."OR (OLD.status = 'submitting' AND NEW.status IN ('confirmed','failed','unknown','approved')) "
            ."OR (OLD.status = 'unknown' AND NEW.status IN ('confirmed','failed','approved'))";

        $sum = '(SELECT COALESCE(SUM(amount_minor), 0) FROM '.self::ALLOCATIONS.' WHERE payment_refund_id = NEW.id)';

        return [
            ['payment_refunds_frozen', 'UPDATE', '('.implode(' OR ', $frozen).')'],
            ['payment_refunds_once_set', 'UPDATE', '('.implode(' OR ', $onceSet).')'],
            ['payment_refunds_transition', 'UPDATE', "NEW.status <> OLD.status AND NOT ({$legal})"],
            // الاعتماد يشترط Σ التخصيصات = المبلغ (ADR §4.1).
            ['payment_refunds_allocation_sum', 'UPDATE', "NEW.status = 'approved' AND OLD.status = 'requested' AND {$sum} <> NEW.amount_minor"],
        ];
    }

    private function addBehaviourGuards(): void
    {
        $tenantGone = 'NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id)';

        if ($this->pgsql()) {
            foreach ($this->refundRules() as [$name, $event, $condition]) {
                DB::unprepared("CREATE OR REPLACE FUNCTION {$name}() RETURNS trigger AS \$\$
BEGIN
    IF {$condition} THEN
        RAISE EXCEPTION '{$name}';
    END IF;
    RETURN NEW;
END;
\$\$ LANGUAGE plpgsql");
                DB::unprepared("CREATE TRIGGER {$name} BEFORE {$event} ON ".self::REFUNDS." FOR EACH ROW EXECUTE FUNCTION {$name}()");
            }

            // لا حذف للاسترداد ولا للتخصيصات خارج حذف المستأجر المتسلسل؛ التخصيصات ثابتة بعد مغادرة requested.
            DB::unprepared("CREATE OR REPLACE FUNCTION payment_refunds_no_delete() RETURNS trigger AS \$\$
BEGIN
    IF {$tenantGone} THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'payment refund records are never deleted';
END;
\$\$ LANGUAGE plpgsql");
            DB::unprepared('CREATE TRIGGER payment_refunds_no_delete BEFORE DELETE ON '.self::REFUNDS.' FOR EACH ROW EXECUTE FUNCTION payment_refunds_no_delete()');

            DB::unprepared("CREATE OR REPLACE FUNCTION payment_refund_allocations_guard() RETURNS trigger AS \$\$
DECLARE parent_status text;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF {$tenantGone} THEN
            RETURN OLD;
        END IF;
        RAISE EXCEPTION 'payment refund allocations are immutable';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'payment refund allocations are immutable';
    END IF;
    SELECT status INTO parent_status FROM payment_refunds WHERE id = NEW.payment_refund_id;
    IF parent_status IS DISTINCT FROM 'requested' THEN
        RAISE EXCEPTION 'allocations can only be added while the refund is requested';
    END IF;
    RETURN NEW;
END;
\$\$ LANGUAGE plpgsql");
            DB::unprepared('CREATE TRIGGER payment_refund_allocations_guard BEFORE INSERT OR UPDATE OR DELETE ON '.self::ALLOCATIONS.' FOR EACH ROW EXECUTE FUNCTION payment_refund_allocations_guard()');

            foreach ([self::ATTEMPTS, self::RESULTS, self::EVENTS] as $table) {
                DB::unprepared("CREATE OR REPLACE FUNCTION {$table}_immutable() RETURNS trigger AS \$\$
BEGIN
    IF TG_OP = 'DELETE' AND {$tenantGone} THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION '{$table} is append-only';
END;
\$\$ LANGUAGE plpgsql");
                DB::unprepared("CREATE TRIGGER {$table}_immutable BEFORE UPDATE OR DELETE ON {$table} FOR EACH ROW EXECUTE FUNCTION {$table}_immutable()");
            }

            return;
        }

        foreach ($this->refundRules() as [$name, $event, $condition]) {
            DB::unprepared("CREATE TRIGGER {$name} BEFORE {$event} ON ".self::REFUNDS." WHEN {$condition} BEGIN SELECT RAISE(ABORT, '{$name}'); END");
        }
        DB::unprepared('CREATE TRIGGER payment_refunds_no_delete BEFORE DELETE ON '.self::REFUNDS
            ." WHEN EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) BEGIN SELECT RAISE(ABORT, 'payment refund records are never deleted'); END");

        DB::unprepared('CREATE TRIGGER payment_refund_allocations_no_update BEFORE UPDATE ON '.self::ALLOCATIONS
            ." BEGIN SELECT RAISE(ABORT, 'payment refund allocations are immutable'); END");
        DB::unprepared('CREATE TRIGGER payment_refund_allocations_no_delete BEFORE DELETE ON '.self::ALLOCATIONS
            ." WHEN EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) BEGIN SELECT RAISE(ABORT, 'payment refund allocations are immutable'); END");
        DB::unprepared('CREATE TRIGGER payment_refund_allocations_insert_status BEFORE INSERT ON '.self::ALLOCATIONS
            ." WHEN (SELECT status FROM payment_refunds WHERE id = NEW.payment_refund_id) IS NOT 'requested' BEGIN SELECT RAISE(ABORT, 'allocations can only be added while the refund is requested'); END");

        foreach ([self::ATTEMPTS, self::RESULTS, self::EVENTS] as $table) {
            DB::unprepared("CREATE TRIGGER {$table}_no_update BEFORE UPDATE ON {$table} BEGIN SELECT RAISE(ABORT, '{$table} is append-only'); END");
            DB::unprepared("CREATE TRIGGER {$table}_no_delete BEFORE DELETE ON {$table} WHEN EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) BEGIN SELECT RAISE(ABORT, '{$table} is append-only'); END");
        }
    }

    private function dropGuards(): void
    {
        if ($this->pgsql()) {
            foreach ([self::REFUNDS => ['payment_refunds_frozen', 'payment_refunds_once_set', 'payment_refunds_transition', 'payment_refunds_allocation_sum', 'payment_refunds_no_delete'],
                self::ALLOCATIONS => ['payment_refund_allocations_guard'],
                self::ATTEMPTS => [self::ATTEMPTS.'_immutable'], self::RESULTS => [self::RESULTS.'_immutable'], self::EVENTS => [self::EVENTS.'_immutable']] as $table => $triggers) {
                foreach ($triggers as $trigger) {
                    DB::unprepared("DROP TRIGGER IF EXISTS {$trigger} ON {$table}");
                    DB::unprepared("DROP FUNCTION IF EXISTS {$trigger}()");
                }
            }
            DB::statement('ALTER TABLE '.self::REFUNDS.' DROP CONSTRAINT IF EXISTS payment_refunds_shape_chk');

            return;
        }

        foreach (['payment_refunds_frozen', 'payment_refunds_once_set', 'payment_refunds_transition', 'payment_refunds_allocation_sum', 'payment_refunds_no_delete',
            'payment_refund_allocations_no_update', 'payment_refund_allocations_no_delete', 'payment_refund_allocations_insert_status'] as $trigger) {
            DB::unprepared("DROP TRIGGER IF EXISTS {$trigger}");
        }
        foreach ([self::ATTEMPTS, self::RESULTS, self::EVENTS] as $table) {
            DB::unprepared("DROP TRIGGER IF EXISTS {$table}_no_update");
            DB::unprepared("DROP TRIGGER IF EXISTS {$table}_no_delete");
        }
        foreach (['payment_refunds_shape', 'payment_refund_allocations_shape', 'payment_refund_attempts_shape', 'payment_refund_results_shape'] as $shape) {
            DB::unprepared("DROP TRIGGER IF EXISTS {$shape}_insert");
            DB::unprepared("DROP TRIGGER IF EXISTS {$shape}_update");
        }
    }
};
