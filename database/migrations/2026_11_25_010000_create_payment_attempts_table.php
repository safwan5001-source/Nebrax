<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * AWJ-PAYMENTS-HZ-01 / PAY-H1-03 — محاولات الدفع (نواة التنسيق). جدول إضافي واحد؛ لا مساس بأي جدول مالي.
 *
 * - `payment_attempts`: محاولة دفع واحدة لـ Payable عبر اتصال بوابة. CompanyWide + `branch_id` لقطة (D-07).
 *   `capture_status` و`dispute_status` بُعدان مستقلان؛ `captured_minor`/`refunded_minor` بالهللات (bigint).
 *
 * ما تفرضه القاعدة لا الكود وحده (المحرّكان):
 *  - `UNIQUE(tenant_id, idempotency_key)`: تكرار الطلب لا ينشئ محاولة ثانية.
 *  - فهرس فريد جزئي: محاولة **نشطة** واحدة (created/pending_customer/authorized) لكل Payable.
 *  - فهرس فريد جزئي `(payment_gateway_id, provider_payment_id)` حين يوجد المرجع.
 *  - CHECK: مبلغ موجب، التقاط ≥ استرداد ≥ 0، حالات معروفة فقط.
 *  - FK على البوابة بلا CASCADE: بوابة لها محاولات لا تُحذف من القاعدة (حذف المستأجر المتسلسل يمرّ).
 *
 * الانتقالات الرتيبة (لا رجوع للخلف) تفرضها `PaymentAttempt::booted()` تحت قفل الصف؛ حارسها على مستوى القاعدة
 * (مُشغّل) ضمن PAY-H8-01 مع بقية حراس الحذف. `down()` يرفض متى وُجد أي صف (إصلاح إلى الأمام فقط).
 */
return new class extends Migration
{
    private const TABLE = 'payment_attempts';

    private const CAPTURE = "'created','pending_customer','authorized','captured','cancelled','expired','failed','voided'";

    private const DISPUTE = "'none','open','won','lost'";

    public function up(): void
    {
        Schema::create(self::TABLE, function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->uuid('branch_id')->nullable();                     // لقطة وقت الإنشاء، ليست عزلاً
            $table->foreignUuid('payment_gateway_id')->constrained('payment_gateways');
            $table->string('provider', 32);                            // لقطة من البوابة
            $table->string('environment', 16);                         // لقطة: sandbox | live
            $table->string('payable_key', 160);                        // "<type>:<id>" من عقد Payable
            $table->string('idempotency_key', 128);
            $table->bigInteger('amount_minor');
            $table->char('currency', 3);
            $table->string('capture_status', 24)->default('created');
            $table->string('dispute_status', 16)->default('none');
            $table->bigInteger('captured_minor')->default(0);
            $table->bigInteger('refunded_minor')->default(0);
            $table->string('provider_payment_id', 191)->nullable();
            $table->text('checkout_url')->nullable();                  // صفحة الدفع المستضافة (ليست سراً)
            $table->string('failure_code', 64)->nullable();
            $table->text('review_reasons')->nullable();                // json: late_capture | amount_mismatch | currency_mismatch | state_conflict
            $table->timestamp('expires_at')->nullable();
            $table->timestamp('captured_at')->nullable();
            $table->timestamp('last_synced_at')->nullable();
            $table->uuid('created_by')->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'idempotency_key'], 'payment_attempts_idempotency_unique');
            $table->index(['tenant_id', 'payable_key'], 'payment_attempts_payable_idx');
            $table->index(['payment_gateway_id', 'capture_status'], 'payment_attempts_gateway_status_idx');
        });

        DB::statement("CREATE UNIQUE INDEX payment_attempts_active_payable_unique ON payment_attempts (tenant_id, payable_key) WHERE capture_status IN ('created','pending_customer','authorized')");
        DB::statement('CREATE UNIQUE INDEX payment_attempts_provider_ref_unique ON payment_attempts (payment_gateway_id, provider_payment_id) WHERE provider_payment_id IS NOT NULL');

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE payment_attempts ADD CONSTRAINT payment_attempts_shape_chk CHECK ('
                .'amount_minor > 0 AND captured_minor >= 0 AND refunded_minor >= 0 AND captured_minor >= refunded_minor '
                .'AND capture_status IN ('.self::CAPTURE.') AND dispute_status IN ('.self::DISPUTE.'))');

            return;
        }

        // SQLite لا يضيف CHECK بعد الإنشاء: مُشغّلان بالشرط نفسه.
        $invalid = 'NOT (NEW.amount_minor > 0 AND NEW.captured_minor >= 0 AND NEW.refunded_minor >= 0 AND NEW.captured_minor >= NEW.refunded_minor '
            .'AND NEW.capture_status IN ('.self::CAPTURE.') AND NEW.dispute_status IN ('.self::DISPUTE.'))';
        DB::unprepared("CREATE TRIGGER payment_attempts_shape_insert BEFORE INSERT ON payment_attempts WHEN {$invalid} BEGIN SELECT RAISE(ABORT, 'payment_attempts: invalid attempt shape'); END");
        DB::unprepared("CREATE TRIGGER payment_attempts_shape_update BEFORE UPDATE ON payment_attempts WHEN {$invalid} BEGIN SELECT RAISE(ABORT, 'payment_attempts: invalid attempt shape'); END");
    }

    public function down(): void
    {
        if (Schema::hasTable(self::TABLE) && DB::table(self::TABLE)->exists()) {
            throw new RuntimeException('Rollback refused: payment_attempts contains rows (financial references). Fix forward instead.');
        }

        Schema::dropIfExists(self::TABLE);
    }
};
