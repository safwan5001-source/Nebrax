<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * AWJ-PAYMENTS-HZ-01 / PAY-H3-02b (ADR-0008، A6-1..5 + D-21) — بنود التسوية غير التحصيلية وحالة `unreconciled`. **إضافية فقط.**
 *
 * - `payment_gateway_settlement_lines`: بنود استرداد مخصومة من الصرف (`line_type=refund` في 02b؛ أنواع D-22 تُضاف في 02c).
 * - ترويسة التسوية: `refunds_total` و`unreconciled_minor` (الفرق الموقَّع للتسوية غير المفسَّرة) وقيمة الحالة `unreconciled`.
 * - مُشغّلات القاعدة (PostgreSQL وSQLite): حذف التسوية المرحَّلة وبنودها (تحصيل/استرداد) مرفوض ما دام المستأجر موجوداً؛ بند الاسترداد يشترط استرداداً مرحَّلاً (A5) لنفس المستأجر والبوابة والعملة ولا يتجاوز مجموع المستهلَك
 *   مبلغه؛ البنود ثابتة بعد الترحيل؛ `posted` نهائية و`unreconciled` لا تحمل قيداً ولا فرقاً صفرياً (الفرق الصفري يُرحَّل).
 * `down()` يرفض متى وُجدت بنود أو تسوية `unreconciled` (إصلاح إلى الأمام فقط).
 */
return new class extends Migration
{
    private const LINE_FN = 'pgsl_line_guard';

    private const LINE_UPD_FN = 'pgsl_line_immutable';

    private const SET_INS_FN = 'pgs_status_insert_guard';

    private const SET_UPD_FN = 'pgs_status_update_guard';

    private const LINE_DEL_FN = 'pgsl_line_delete_guard';

    private const ITEM_DEL_FN = 'pgsi_item_delete_guard';

    private const SET_DEL_FN = 'pgs_settlement_delete_guard';

    public function up(): void
    {
        Schema::create('payment_gateway_settlement_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('settlement_id')->constrained('payment_gateway_settlements')->cascadeOnDelete();
            $table->string('line_type', 32);
            $table->foreignUuid('payment_refund_id')->nullable()->constrained('payment_refunds')->cascadeOnDelete();
            $table->unsignedBigInteger('amount_minor');
            $table->string('provider_event_ref')->nullable();
            $table->string('evidence_ref')->nullable();
            $table->text('reason')->nullable();
            $table->timestamps();

            $table->unique(['settlement_id', 'payment_refund_id'], 'pgsl_settlement_refund_unique');
            $table->index(['tenant_id', 'payment_refund_id'], 'pgsl_tenant_refund_idx');
        });

        Schema::table('payment_gateway_settlements', function (Blueprint $table) {
            $table->unsignedBigInteger('refunds_total')->default(0)->after('provider_credits');
            $table->bigInteger('unreconciled_minor')->nullable()->after('refunds_total');
        });

        $this->createTriggers();
    }

    public function down(): void
    {
        if (DB::table('payment_gateway_settlement_lines')->exists() || DB::table('payment_gateway_settlements')->where('status', 'unreconciled')->exists()) {
            throw new RuntimeException('Rollback refused: settlement lines or unreconciled settlements exist. Fix forward instead.');
        }
        $this->dropTriggers();
        Schema::table('payment_gateway_settlements', function (Blueprint $table) {
            $table->dropColumn(['refunds_total', 'unreconciled_minor']);
        });
        Schema::dropIfExists('payment_gateway_settlement_lines');
    }

    /** @return array<string, string> شروط الرفض لإدراج بند (اسم ⇒ تعبير SQL على NEW). */
    private function lineInsertRules(): array
    {
        $over = "EXISTS (SELECT 1 FROM payment_refunds r WHERE r.id = NEW.payment_refund_id AND NEW.amount_minor + COALESCE((SELECT SUM(l.amount_minor) "
            ."FROM payment_gateway_settlement_lines l JOIN payment_gateway_settlements ps ON ps.id = l.settlement_id "
            ."WHERE l.payment_refund_id = NEW.payment_refund_id AND ps.status = 'posted' AND ps.id <> NEW.settlement_id), 0) > r.amount_minor)";

        return [
            'pgsl_parent_not_open' => 'NOT EXISTS (SELECT 1 FROM payment_gateway_settlements s WHERE s.id = NEW.settlement_id AND s.tenant_id = NEW.tenant_id AND s.journal_entry_id IS NULL)',
            'pgsl_type_unsupported' => "NEW.line_type <> 'refund'",
            'pgsl_amount_invalid' => 'NEW.amount_minor <= 0',
            'pgsl_refund_required' => 'NEW.payment_refund_id IS NULL',
            'pgsl_refund_ineligible' => 'NOT EXISTS (SELECT 1 FROM payment_refunds r JOIN payment_gateway_settlements s ON s.id = NEW.settlement_id '
                .'WHERE r.id = NEW.payment_refund_id AND r.tenant_id = NEW.tenant_id AND r.payment_gateway_id = s.payment_gateway_id '
                ."AND r.posting_status = 'posted' AND r.journal_entry_id IS NOT NULL AND r.currency = s.currency)",
            'pgsl_refund_overused' => $over,
        ];
    }

    /** @return array<string, string> شروط رفض تحديث بند: ثابتة متى رُحّلت التسوية. */
    private function lineUpdateRules(): array
    {
        return [
            'pgsl_posted_immutable' => "EXISTS (SELECT 1 FROM payment_gateway_settlements s WHERE s.id = OLD.settlement_id AND s.status = 'posted' AND s.journal_entry_id IS NOT NULL)",
        ];
    }

    /** @return array<string, string> */
    private function settlementInsertRules(): array
    {
        return [
            'pgs_status_invalid' => "NEW.status NOT IN ('posted', 'unreconciled')",
            'pgs_unreconciled_shape' => "NEW.status = 'unreconciled' AND (NEW.journal_entry_id IS NOT NULL OR NEW.posted_at IS NOT NULL OR NEW.unreconciled_minor IS NULL OR NEW.unreconciled_minor = 0)",
        ];
    }

    /** @return array<string, string> */
    private function settlementUpdateRules(): array
    {
        $over = "EXISTS (SELECT 1 FROM payment_gateway_settlement_lines l JOIN payment_refunds r ON r.id = l.payment_refund_id WHERE l.settlement_id = NEW.id "
            ."AND l.amount_minor + COALESCE((SELECT SUM(l2.amount_minor) FROM payment_gateway_settlement_lines l2 JOIN payment_gateway_settlements ps ON ps.id = l2.settlement_id "
            ."WHERE l2.payment_refund_id = l.payment_refund_id AND ps.status = 'posted' AND ps.id <> NEW.id), 0) > r.amount_minor)";

        return [
            'pgs_status_invalid' => "NEW.status NOT IN ('posted', 'unreconciled')",
            'pgs_posted_is_final' => "OLD.status = 'posted' AND NEW.status <> 'posted'",
            'pgs_post_requires_entry' => "OLD.status = 'unreconciled' AND NEW.status = 'posted' AND NEW.journal_entry_id IS NULL",
            'pgs_unreconciled_shape' => "NEW.status = 'unreconciled' AND (NEW.journal_entry_id IS NOT NULL OR NEW.posted_at IS NOT NULL OR NEW.unreconciled_minor IS NULL OR NEW.unreconciled_minor = 0)",
            'pgs_refund_overused' => "NEW.status = 'posted' AND OLD.status <> 'posted' AND {$over}",
        ];
    }

    /**
     * حذف مرحَّل مرفوض ما دام المستأجر موجوداً (حذف المستأجر النهائي يزيل سلاسله بالتتالي كسائر الجداول). استبدال أبناء المسودة مسموح.
     *
     * @return array<string, string>
     */
    private function deleteRules(string $table): array
    {
        $tenantAlive = 'EXISTS (SELECT 1 FROM tenants t WHERE t.id = OLD.tenant_id)';

        return match ($table) {
            'payment_gateway_settlements' => ['pgs_posted_no_delete' => "OLD.status = 'posted' AND {$tenantAlive}"],
            default => ['pgs_child_posted_no_delete' => "EXISTS (SELECT 1 FROM payment_gateway_settlements s WHERE s.id = OLD.settlement_id AND s.status = 'posted' AND s.journal_entry_id IS NOT NULL) AND {$tenantAlive}"],
        };
    }

    private function createTriggers(): void
    {
        $pg = DB::connection()->getDriverName() === 'pgsql';
        $this->createTrigger($pg, 'payment_gateway_settlement_lines', 'BEFORE INSERT', self::LINE_FN, $this->lineInsertRules());
        $this->createTrigger($pg, 'payment_gateway_settlement_lines', 'BEFORE UPDATE', self::LINE_UPD_FN, $this->lineUpdateRules());
        $this->createTrigger($pg, 'payment_gateway_settlements', 'BEFORE INSERT', self::SET_INS_FN, $this->settlementInsertRules());
        $this->createTrigger($pg, 'payment_gateway_settlements', 'BEFORE UPDATE', self::SET_UPD_FN, $this->settlementUpdateRules());
        $this->createTrigger($pg, 'payment_gateway_settlement_lines', 'BEFORE DELETE', self::LINE_DEL_FN, $this->deleteRules('payment_gateway_settlement_lines'), 'OLD');
        $this->createTrigger($pg, 'payment_gateway_settlement_items', 'BEFORE DELETE', self::ITEM_DEL_FN, $this->deleteRules('payment_gateway_settlement_items'), 'OLD');
        $this->createTrigger($pg, 'payment_gateway_settlements', 'BEFORE DELETE', self::SET_DEL_FN, $this->deleteRules('payment_gateway_settlements'), 'OLD');
    }

    /** @param  array<string, string>  $rules */
    private function createTrigger(bool $pg, string $table, string $when, string $name, array $rules, string $returns = 'NEW'): void
    {
        if ($pg) {
            $body = '';
            foreach ($rules as $code => $expr) {
                $body .= "    IF {$expr} THEN RAISE EXCEPTION '{$code}'; END IF;\n";
            }
            DB::unprepared("CREATE OR REPLACE FUNCTION {$name}() RETURNS trigger AS \$\$\nBEGIN\n{$body}    RETURN {$returns};\nEND;\n\$\$ LANGUAGE plpgsql");
            DB::unprepared("CREATE TRIGGER {$name} {$when} ON {$table} FOR EACH ROW EXECUTE FUNCTION {$name}()");

            return;
        }

        $body = '';
        foreach ($rules as $code => $expr) {
            $body .= " SELECT RAISE(ABORT, '{$code}') WHERE {$expr};";
        }
        DB::unprepared("CREATE TRIGGER {$name} {$when} ON {$table} FOR EACH ROW BEGIN{$body} END");
    }

    private function dropTriggers(): void
    {
        $pg = DB::connection()->getDriverName() === 'pgsql';
        $map = [
            self::LINE_FN => 'payment_gateway_settlement_lines',
            self::LINE_UPD_FN => 'payment_gateway_settlement_lines',
            self::SET_INS_FN => 'payment_gateway_settlements',
            self::SET_UPD_FN => 'payment_gateway_settlements',
            self::LINE_DEL_FN => 'payment_gateway_settlement_lines',
            self::ITEM_DEL_FN => 'payment_gateway_settlement_items',
            self::SET_DEL_FN => 'payment_gateway_settlements',
        ];
        foreach ($map as $name => $table) {
            if ($pg) {
                DB::unprepared("DROP TRIGGER IF EXISTS {$name} ON {$table}");
                DB::unprepared("DROP FUNCTION IF EXISTS {$name}()");
            } else {
                DB::unprepared("DROP TRIGGER IF EXISTS {$name}");
            }
        }
    }
};
