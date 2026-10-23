<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * AWJ-PAYMENTS-HZ-01 / PAY-H2-02a — مخطط طلبات دفع الفواتير وترحيل الالتقاط (ADR-0006). **إضافي فقط؛ لا ترحيل ولا مساس بجدول مالي قائم.**
 *
 * - `invoice_payment_requests`: طلب (رابط) دفع لفاتورة مرحَّلة. `allow_partial` افتراضه false (D-16)، ثابت بعد الإنشاء.
 *   فهرس فريد جزئي: طلب **مفتوح** واحد لكل فاتورة (لا ازدواج تحصيل عبر روابط متوازية). `token_hash` فقط (لا رمز خام) للـAPI العام لاحقاً.
 * - `payment_attempt_postings`: مجموعة ترحيل الالتقاط (ADR-0006 M1–M4). `UNIQUE(payment_attempt_id, role)` يمنع سندين لدور واحد،
 *   و`UNIQUE(payment_id)` يمنع ربط سند بمجموعتين. أدوار: `allocated` (مخصّص بالفاتورة) و`excess` (دفعة زائدة غير مخصصة، D-26).
 * - أعمدة على `payment_attempts`: `posting_status` (pending|posted|blocked_period|not_postable)، `accounting_date`، `posting_blocked_reason`، `posted_at`.
 *
 * ما تفرضه القاعدة: CHECK لشكل الحالات والمبالغ (PostgreSQL بقيد، SQLite بمُشغّلات مكافئة). FK بلا CASCADE على الفاتورة/السند/البوابة
 * (حذف المستأجر المتسلسل يمرّ لأن الفحص عند نهاية العبارة). `down()` يرفض متى وُجد أي صف (إصلاح إلى الأمام فقط).
 */
return new class extends Migration
{
    private const REQUESTS = 'invoice_payment_requests';

    private const POSTINGS = 'payment_attempt_postings';

    private const REQUEST_STATUS = "'open','cancelled','completed','expired'";

    private const POSTING_STATUS = "'pending','posted','blocked_period','not_postable'";

    private const ROLES = "'allocated','excess'";

    public function up(): void
    {
        Schema::create(self::REQUESTS, function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->uuid('branch_id')->nullable();                       // لقطة وقت الإنشاء، ليست عزلاً
            $table->foreignUuid('invoice_id')->constrained('invoices');
            $table->uuid('partner_id')->nullable();                      // لقطة طرف الفاتورة (null ⇒ لا ترحيل محاسبي، D-05)
            $table->foreignUuid('payment_gateway_id')->constrained('payment_gateways');
            $table->char('currency', 3);
            $table->boolean('allow_partial')->default(false);            // D-16: ممنوع افتراضياً، يُفعَّل لكل رابط
            $table->string('status', 16)->default('open');
            $table->char('token_hash', 64)->nullable();                  // SHA-256 للرمز العام (H2-02e)؛ لا رمز خام
            $table->timestamp('expires_at')->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->uuid('cancelled_by')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->uuid('created_by')->nullable();
            $table->timestamps();

            $table->unique('token_hash', 'invoice_payment_requests_token_unique');
            $table->index(['tenant_id', 'invoice_id'], 'invoice_payment_requests_invoice_idx');
        });

        DB::statement("CREATE UNIQUE INDEX invoice_payment_requests_open_unique ON invoice_payment_requests (tenant_id, invoice_id) WHERE status = 'open'");

        Schema::create(self::POSTINGS, function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('payment_attempt_id')->constrained('payment_attempts');
            $table->string('role', 16);
            $table->foreignUuid('payment_id')->constrained('payments');
            $table->bigInteger('amount_minor');
            $table->timestamp('created_at')->nullable();

            $table->unique(['payment_attempt_id', 'role'], 'payment_attempt_postings_role_unique');
            $table->unique('payment_id', 'payment_attempt_postings_payment_unique');
        });

        Schema::table('payment_attempts', function (Blueprint $table) {
            $table->string('posting_status', 16)->nullable();
            $table->date('accounting_date')->nullable();                 // تاريخ التقاط المزوّد بتوقيت الرياض؛ ثابت بعد تثبيته
            $table->text('posting_blocked_reason')->nullable();          // json: {kind: period|year, id, ...} بلا مضمون حساس
            $table->timestamp('posted_at')->nullable();
            $table->index(['tenant_id', 'posting_status'], 'payment_attempts_posting_status_idx');
        });

        $this->addChecks();
    }

    private function addChecks(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE '.self::REQUESTS.' ADD CONSTRAINT invoice_payment_requests_status_chk CHECK (status IN ('.self::REQUEST_STATUS.'))');
            DB::statement('ALTER TABLE '.self::POSTINGS.' ADD CONSTRAINT payment_attempt_postings_shape_chk CHECK (amount_minor > 0 AND role IN ('.self::ROLES.'))');
            DB::statement('ALTER TABLE payment_attempts ADD CONSTRAINT payment_attempts_posting_chk CHECK ('
                .'(posting_status IS NULL OR posting_status IN ('.self::POSTING_STATUS.')) '
                ."AND (posting_status IS NULL OR capture_status = 'captured'))");

            return;
        }

        // SQLite لا يضيف CHECK بعد الإنشاء: مُشغّلات بالشرط نفسه.
        $triggers = [
            ['invoice_payment_requests_status', self::REQUESTS, 'NOT (NEW.status IN ('.self::REQUEST_STATUS.'))'],
            ['payment_attempt_postings_shape', self::POSTINGS, 'NOT (NEW.amount_minor > 0 AND NEW.role IN ('.self::ROLES.'))'],
            ['payment_attempts_posting', 'payment_attempts', 'NOT ((NEW.posting_status IS NULL OR NEW.posting_status IN ('.self::POSTING_STATUS.')) '
                ."AND (NEW.posting_status IS NULL OR NEW.capture_status = 'captured'))"],
        ];
        foreach ($triggers as [$name, $table, $invalid]) {
            foreach (['INSERT', 'UPDATE'] as $event) {
                DB::unprepared('CREATE TRIGGER '.$name.'_'.strtolower($event)." BEFORE {$event} ON {$table} WHEN {$invalid} BEGIN SELECT RAISE(ABORT, '{$table}: invalid shape'); END");
            }
        }
    }

    public function down(): void
    {
        foreach ([self::POSTINGS, self::REQUESTS] as $table) {
            if (Schema::hasTable($table) && DB::table($table)->exists()) {
                throw new RuntimeException("Rollback refused: {$table} contains rows (financial references). Fix forward instead.");
            }
        }
        if (Schema::hasColumn('payment_attempts', 'posting_status') && DB::table('payment_attempts')->whereNotNull('posting_status')->exists()) {
            throw new RuntimeException('Rollback refused: payment_attempts carries posting state. Fix forward instead.');
        }

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE payment_attempts DROP CONSTRAINT IF EXISTS payment_attempts_posting_chk');
        } else {
            foreach (['payment_attempts_posting_insert', 'payment_attempts_posting_update'] as $trigger) {
                DB::unprepared("DROP TRIGGER IF EXISTS {$trigger}");
            }
        }

        Schema::table('payment_attempts', function (Blueprint $table) {
            $table->dropIndex('payment_attempts_posting_status_idx');
            $table->dropColumn(['posting_status', 'accounting_date', 'posting_blocked_reason', 'posted_at']);
        });
        Schema::dropIfExists(self::POSTINGS);
        Schema::dropIfExists(self::REQUESTS);
    }
};
