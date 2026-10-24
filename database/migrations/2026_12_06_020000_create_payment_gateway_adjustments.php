<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * AWJ-PAYMENTS-HZ-01 / PAY-H3-02c (ADR-0008 D-22، A6-7..10) — تعديلات المزوّد غير العمولة: احتجاز/إفراج احتياطي وتعديل مدين/دائن. **إضافية فقط.**
 *
 * - `payment_gateway_adjustments`: مستند بسبب ومرجع دليل ومبلغ، **موافقة مستقلة** (المعتمِد ≠ الطالب، يُفرض في القاعدة)، تُستهلك مرة واحدة بتسوية مرحَّلة.
 * - `payment_gateway_adjustment_events`: سجل تدقيق append-only (الفاعل والحالتان والسبب).
 * - بنود التسوية تقبل الأنواع الأربعة عبر `adjustment_id`؛ مُشغّلات الإدراج تشترط مستنداً معتمداً من المستأجر والبوابة والعملة والنوع والمبلغ نفسها
 *   (وهذا هو الحارس الأساسي للمسار العادي مع أقفال الصفوف)، وانتقال مسودة `unreconciled` إلى `posted` يشترط بقاءه معتمداً. الاستهلاك `consumed`
 *   يشترط تسوية مرحَّلة بقيد لنفس المستأجر والبوابة، وقرارات الاعتماد/الرفض/الإلغاء/الاستهلاك ثابتة بعد تسجيلها.
 * `down()` يرفض متى وُجدت مستندات أو بنود تعديل (إصلاح إلى الأمام فقط) ثم يعيد مُشغّلات 02b.
 */
return new class extends Migration
{
    private const KINDS = "'reserve_hold', 'reserve_release', 'adjustment_debit', 'adjustment_credit'";

    private const LINE_TYPES = "'refund', 'reserve_hold', 'reserve_release', 'adjustment_debit', 'adjustment_credit'";

    public function up(): void
    {
        Schema::create('payment_gateway_adjustments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('payment_gateway_id')->constrained('payment_gateways')->cascadeOnDelete();
            $table->string('kind', 24);
            $table->unsignedBigInteger('amount_minor');
            $table->string('currency', 3);
            $table->text('reason');
            $table->string('evidence_ref', 191);
            $table->string('provider_event_ref', 191)->nullable();
            $table->string('status', 16)->default('requested');
            $table->foreignUuid('requested_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('requested_at')->nullable();
            $table->foreignUuid('approved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('approved_at')->nullable();
            $table->foreignUuid('rejected_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('rejected_at')->nullable();
            $table->text('reject_reason')->nullable();
            $table->foreignUuid('cancelled_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('cancelled_at')->nullable();
            $table->text('cancel_reason')->nullable();
            $table->foreignUuid('settlement_id')->nullable()->constrained('payment_gateway_settlements')->cascadeOnDelete();
            $table->timestamps();

            $table->index(['tenant_id', 'payment_gateway_id', 'status'], 'pga_tenant_gateway_status_idx');
            $table->unique(['tenant_id', 'payment_gateway_id', 'provider_event_ref'], 'pga_provider_event_unique');
        });

        Schema::create('payment_gateway_adjustment_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('adjustment_id')->constrained('payment_gateway_adjustments')->cascadeOnDelete();
            $table->string('action', 24);
            $table->string('from_status', 16)->nullable();
            $table->string('to_status', 16)->nullable();
            $table->foreignUuid('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->text('reason')->nullable();
            $table->json('meta')->nullable();
            $table->timestamp('created_at')->nullable();

            $table->index(['tenant_id', 'adjustment_id'], 'pgae_tenant_adjustment_idx');
        });

        // SQLite يعيد بناء الجدول عند إضافة عمود بمفتاح أجنبي فيُسقط مُشغّلاته ويفشل إن أشار مُشغّل جدول آخر إليه: نُسقط مُشغّل التسوية أولاً ونعيد تركيب الكل.
        $this->dropSqliteSettlementGuard();
        Schema::table('payment_gateway_settlement_lines', function (Blueprint $table) {
            $table->foreignUuid('adjustment_id')->nullable()->after('payment_refund_id')->constrained('payment_gateway_adjustments')->cascadeOnDelete();
            $table->unique(['settlement_id', 'adjustment_id'], 'pgsl_settlement_adjustment_unique');
        });

        $this->install($this->adjustmentTriggers());
        $this->install($this->settlementTriggers(true));
        $this->install($this->lineGuardTriggers());
    }

    public function down(): void
    {
        if (DB::table('payment_gateway_adjustments')->exists() || DB::table('payment_gateway_settlement_lines')->whereNotNull('adjustment_id')->exists()) {
            throw new RuntimeException('Rollback refused: gateway adjustments or adjustment settlement lines exist. Fix forward instead.');
        }
        $this->drop($this->adjustmentTriggers());
        $this->dropSqliteSettlementGuard();
        Schema::table('payment_gateway_settlement_lines', function (Blueprint $table) {
            $table->dropUnique('pgsl_settlement_adjustment_unique');
            $table->dropConstrainedForeignId('adjustment_id');
        });
        Schema::dropIfExists('payment_gateway_adjustment_events');
        Schema::dropIfExists('payment_gateway_adjustments');
        $this->install($this->settlementTriggers(false));
        $this->install($this->lineGuardTriggers());
    }

    private function dropSqliteSettlementGuard(): void
    {
        if (DB::connection()->getDriverName() !== 'pgsql') {
            DB::unprepared('DROP TRIGGER IF EXISTS pgs_status_update_guard');
        }
    }

    /**
     * مُشغّلات بنود التسوية التي أنشأتها 02b ولا تتغير هنا (ثبات المرحَّل، حذفه): تُعاد دائماً لأن إعادة بناء الجدول في SQLite تُسقطها.
     *
     * @return list<array{table: string, when: string, name: string, rules: array<string, string>, returns: string}>
     */
    private function lineGuardTriggers(): array
    {
        $tenantAlive = 'EXISTS (SELECT 1 FROM tenants t WHERE t.id = OLD.tenant_id)';

        return [
            ['table' => 'payment_gateway_settlement_lines', 'when' => 'BEFORE UPDATE', 'name' => 'pgsl_line_immutable', 'returns' => 'NEW', 'rules' => [
                'pgsl_posted_immutable' => "EXISTS (SELECT 1 FROM payment_gateway_settlements s WHERE s.id = OLD.settlement_id AND s.status = 'posted' AND s.journal_entry_id IS NOT NULL)",
            ]],
            ['table' => 'payment_gateway_settlement_lines', 'when' => 'BEFORE DELETE', 'name' => 'pgsl_line_delete_guard', 'returns' => 'OLD', 'rules' => [
                'pgs_child_posted_no_delete' => "EXISTS (SELECT 1 FROM payment_gateway_settlements s WHERE s.id = OLD.settlement_id AND s.status = 'posted' AND s.journal_entry_id IS NOT NULL) AND {$tenantAlive}",
            ]],
        ];
    }

    // ───────────────────────── قواعد المُشغّلات ─────────────────────────

    /** @return list<array{table: string, when: string, name: string, rules: array<string, string>, returns: string}> */
    private function adjustmentTriggers(): array
    {
        $immutable = collect(['tenant_id', 'payment_gateway_id', 'kind', 'amount_minor', 'currency', 'reason', 'evidence_ref', 'provider_event_ref', 'requested_by', 'requested_at'])
            ->map(fn ($c) => $this->changed("NEW.{$c}", "OLD.{$c}"))->implode(' OR ');
        $legalTransition = "(OLD.status = 'requested' AND NEW.status IN ('approved', 'rejected', 'cancelled')) OR (OLD.status = 'approved' AND NEW.status IN ('consumed', 'cancelled'))";
        $tenantAlive = 'EXISTS (SELECT 1 FROM tenants t WHERE t.id = OLD.tenant_id)';

        return [
            ['table' => 'payment_gateway_adjustments', 'when' => 'BEFORE INSERT', 'name' => 'pga_insert_guard', 'returns' => 'NEW', 'rules' => [
                'pga_insert_shape' => "NEW.status <> 'requested' OR NEW.kind NOT IN (".self::KINDS.') OR NEW.amount_minor <= 0 OR NEW.requested_by IS NULL OR NEW.approved_by IS NOT NULL OR NEW.settlement_id IS NOT NULL '
                ."OR length(trim(NEW.reason)) < 5 OR length(trim(NEW.evidence_ref)) < 3",
            ]],
            ['table' => 'payment_gateway_adjustments', 'when' => 'BEFORE UPDATE', 'name' => 'pga_update_guard', 'returns' => 'NEW', 'rules' => [
                'pga_identity_immutable' => $immutable,
                'pga_illegal_transition' => "NEW.status <> OLD.status AND NOT ({$legalTransition})",
                'pga_self_approval' => "NEW.status = 'approved' AND (NEW.approved_by IS NULL OR NEW.approved_at IS NULL OR NEW.approved_by = NEW.requested_by)",
                'pga_self_reject' => "NEW.status = 'rejected' AND (NEW.rejected_by IS NULL OR NEW.rejected_by = NEW.requested_by)",
                'pga_cancel_actor' => "NEW.status = 'cancelled' AND NEW.cancelled_by IS NULL",
                'pga_consumed_shape' => "(NEW.status = 'consumed') <> (NEW.settlement_id IS NOT NULL)",
                // قرار اعتماد/رفض/إلغاء/استهلاك مسجَّل لا يُعاد كتابته (فاعل المعتمِد ومرجع التسوية ثابتان بعد تسجيلهما).
                'pga_decision_frozen' => '('.collect(['approved_by', 'approved_at', 'rejected_by', 'rejected_at', 'cancelled_by', 'cancelled_at', 'settlement_id'])
                    ->map(fn ($c) => "(OLD.{$c} IS NOT NULL AND ".$this->changed("NEW.{$c}", "OLD.{$c}").')')->implode(' OR ').')',
                'pga_consumed_by_posted' => "NEW.status = 'consumed' AND NOT EXISTS (SELECT 1 FROM payment_gateway_settlements s WHERE s.id = NEW.settlement_id "
                    ."AND s.tenant_id = NEW.tenant_id AND s.payment_gateway_id = NEW.payment_gateway_id AND s.status = 'posted' AND s.journal_entry_id IS NOT NULL)",
            ]],
            ['table' => 'payment_gateway_adjustment_events', 'when' => 'BEFORE UPDATE', 'name' => 'pgae_no_update', 'returns' => 'NEW', 'rules' => ['pgae_append_only' => '1 = 1']],
            ['table' => 'payment_gateway_adjustment_events', 'when' => 'BEFORE DELETE', 'name' => 'pgae_no_delete', 'returns' => 'OLD', 'rules' => ['pgae_append_only' => $tenantAlive]],
        ];
    }

    /**
     * @return list<array{table: string, when: string, name: string, rules: array<string, string>, returns: string}>
     */
    private function settlementTriggers(bool $withAdjustments): array
    {
        $over = "EXISTS (SELECT 1 FROM payment_refunds r WHERE r.id = NEW.payment_refund_id AND NEW.amount_minor + COALESCE((SELECT SUM(l.amount_minor) "
            ."FROM payment_gateway_settlement_lines l JOIN payment_gateway_settlements ps ON ps.id = l.settlement_id "
            ."WHERE l.payment_refund_id = NEW.payment_refund_id AND ps.status = 'posted' AND ps.id <> NEW.settlement_id), 0) > r.amount_minor)";
        $refundEligible = 'NOT EXISTS (SELECT 1 FROM payment_refunds r JOIN payment_gateway_settlements s ON s.id = NEW.settlement_id '
            .'WHERE r.id = NEW.payment_refund_id AND r.tenant_id = NEW.tenant_id AND r.payment_gateway_id = s.payment_gateway_id '
            ."AND r.posting_status = 'posted' AND r.journal_entry_id IS NOT NULL AND r.currency = s.currency)";

        $lineRules = [
            'pgsl_parent_not_open' => 'NOT EXISTS (SELECT 1 FROM payment_gateway_settlements s WHERE s.id = NEW.settlement_id AND s.tenant_id = NEW.tenant_id AND s.journal_entry_id IS NULL)',
            'pgsl_amount_invalid' => 'NEW.amount_minor <= 0',
        ];
        if ($withAdjustments) {
            $lineRules += [
                'pgsl_type_unsupported' => 'NEW.line_type NOT IN ('.self::LINE_TYPES.')',
                'pgsl_refund_required' => "NEW.line_type = 'refund' AND (NEW.payment_refund_id IS NULL OR NEW.adjustment_id IS NOT NULL)",
                'pgsl_adjustment_required' => "NEW.line_type <> 'refund' AND (NEW.adjustment_id IS NULL OR NEW.payment_refund_id IS NOT NULL)",
                'pgsl_refund_ineligible' => "NEW.line_type = 'refund' AND {$refundEligible}",
                'pgsl_refund_overused' => "NEW.line_type = 'refund' AND {$over}",
                'pgsl_adjustment_ineligible' => "NEW.line_type <> 'refund' AND NOT EXISTS (SELECT 1 FROM payment_gateway_adjustments a JOIN payment_gateway_settlements s ON s.id = NEW.settlement_id "
                    .'WHERE a.id = NEW.adjustment_id AND a.tenant_id = NEW.tenant_id AND a.payment_gateway_id = s.payment_gateway_id AND a.currency = s.currency '
                    ."AND a.kind = NEW.line_type AND a.amount_minor = NEW.amount_minor AND a.status = 'approved')",
            ];
        } else {
            $lineRules += [
                'pgsl_type_unsupported' => "NEW.line_type <> 'refund'",
                'pgsl_refund_required' => 'NEW.payment_refund_id IS NULL',
                'pgsl_refund_ineligible' => $refundEligible,
                'pgsl_refund_overused' => $over,
            ];
        }

        $overOnPost = "EXISTS (SELECT 1 FROM payment_gateway_settlement_lines l JOIN payment_refunds r ON r.id = l.payment_refund_id WHERE l.settlement_id = NEW.id "
            ."AND l.amount_minor + COALESCE((SELECT SUM(l2.amount_minor) FROM payment_gateway_settlement_lines l2 JOIN payment_gateway_settlements ps ON ps.id = l2.settlement_id "
            ."WHERE l2.payment_refund_id = l.payment_refund_id AND ps.status = 'posted' AND ps.id <> NEW.id), 0) > r.amount_minor)";
        $setRules = [
            'pgs_status_invalid' => "NEW.status NOT IN ('posted', 'unreconciled')",
            'pgs_posted_is_final' => "OLD.status = 'posted' AND NEW.status <> 'posted'",
            'pgs_post_requires_entry' => "OLD.status = 'unreconciled' AND NEW.status = 'posted' AND NEW.journal_entry_id IS NULL",
            'pgs_unreconciled_shape' => "NEW.status = 'unreconciled' AND (NEW.journal_entry_id IS NOT NULL OR NEW.posted_at IS NOT NULL OR NEW.unreconciled_minor IS NULL OR NEW.unreconciled_minor = 0)",
            'pgs_refund_overused' => "NEW.status = 'posted' AND OLD.status <> 'posted' AND {$overOnPost}",
        ];
        if ($withAdjustments) {
            $setRules['pgs_adjustment_not_approved'] = "NEW.status = 'posted' AND OLD.status <> 'posted' AND EXISTS (SELECT 1 FROM payment_gateway_settlement_lines l "
                ."JOIN payment_gateway_adjustments a ON a.id = l.adjustment_id WHERE l.settlement_id = NEW.id AND a.status <> 'approved')";
        }

        return [
            ['table' => 'payment_gateway_settlement_lines', 'when' => 'BEFORE INSERT', 'name' => 'pgsl_line_guard', 'returns' => 'NEW', 'rules' => $lineRules],
            ['table' => 'payment_gateway_settlements', 'when' => 'BEFORE UPDATE', 'name' => 'pgs_status_update_guard', 'returns' => 'NEW', 'rules' => $setRules],
        ];
    }

    private function changed(string $new, string $old): string
    {
        return DB::connection()->getDriverName() === 'pgsql' ? "{$new} IS DISTINCT FROM {$old}" : "{$new} IS NOT {$old}";
    }

    // ───────────────────────── التركيب ─────────────────────────

    /** @param  list<array{table: string, when: string, name: string, rules: array<string, string>, returns: string}>  $triggers */
    private function install(array $triggers): void
    {
        $pg = DB::connection()->getDriverName() === 'pgsql';
        foreach ($triggers as $t) {
            if ($pg) {
                $body = '';
                foreach ($t['rules'] as $code => $expr) {
                    $body .= "    IF {$expr} THEN RAISE EXCEPTION '{$code}'; END IF;\n";
                }
                DB::unprepared("CREATE OR REPLACE FUNCTION {$t['name']}() RETURNS trigger AS \$\$\nBEGIN\n{$body}    RETURN {$t['returns']};\nEND;\n\$\$ LANGUAGE plpgsql");
                DB::unprepared("DROP TRIGGER IF EXISTS {$t['name']} ON {$t['table']}");
                DB::unprepared("CREATE TRIGGER {$t['name']} {$t['when']} ON {$t['table']} FOR EACH ROW EXECUTE FUNCTION {$t['name']}()");

                continue;
            }
            $body = '';
            foreach ($t['rules'] as $code => $expr) {
                $body .= " SELECT RAISE(ABORT, '{$code}') WHERE {$expr};";
            }
            DB::unprepared("DROP TRIGGER IF EXISTS {$t['name']}");
            DB::unprepared("CREATE TRIGGER {$t['name']} {$t['when']} ON {$t['table']} FOR EACH ROW BEGIN{$body} END");
        }
    }

    /** @param  list<array{table: string, when: string, name: string, rules: array<string, string>, returns: string}>  $triggers */
    private function drop(array $triggers): void
    {
        $pg = DB::connection()->getDriverName() === 'pgsql';
        foreach ($triggers as $t) {
            if ($pg) {
                DB::unprepared("DROP TRIGGER IF EXISTS {$t['name']} ON {$t['table']}");
                DB::unprepared("DROP FUNCTION IF EXISTS {$t['name']}()");
            } else {
                DB::unprepared("DROP TRIGGER IF EXISTS {$t['name']}");
            }
        }
    }
};
