<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * AWJ-PAYMENTS-HZ-01 / PAY-H6-02 — أساس أجهزة دفع POS والتعويض (إضافي فقط؛ لا مساس بجدول مالي قائم عدا عمود سياسة على طرق الدفع).
 *
 * - `pos_payment_terminals`: جهاز دفع بطاقة معزول بالفرع (مزوّد + بيانات وصفية غير سرية). لا يُنشأ إلا لمزوّد له محوّل متاح (Fake في local/testing فقط).
 * - `pos_terminal_requests`: طلب دفع على جهاز → موافقة مؤكدة → يُستهلك في بيع POS مرة واحدة (`consumed_payment_id` فريد) أو يُلغى على الجهاز.
 *   حارس القاعدة: مبلغ > 0، حالة معروفة، **طلب نشط واحد لكل جهاز** (فهرس جزئي)، وإيجار التعويض `compensating_until`.
 *   `compensation_required` يمنع إقفال جلسة POS (يفرضه PosSessionService) حتى يُحلّ.
 * - `payment_methods.pos_terminal_required` (افتراضي false = مطفأ): طريقة تشترط موافقة جهاز مؤكدة لكل بيع POS بها. سياسة لكل طريقة لا تُفرض على أحد.
 *
 * `down()` يرفض متى وُجد أي طلب أو طريقة مشروطة (سجلات أدلة دفع؛ إصلاح إلى الأمام).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('pos_payment_terminals', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUuid('pos_device_id')->nullable()->constrained('pos_devices')->nullOnDelete();
            $table->string('name', 120);
            $table->string('code', 64)->nullable();
            $table->string('provider', 32);
            $table->json('meta')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->unique(['tenant_id', 'branch_id', 'name']);
            $table->unique(['tenant_id', 'code']);
            $table->index(['tenant_id', 'branch_id', 'is_active']);
        });

        Schema::create('pos_terminal_requests', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUuid('pos_session_id')->constrained('pos_sessions')->restrictOnDelete();
            $table->foreignUuid('pos_payment_terminal_id')->constrained('pos_payment_terminals')->restrictOnDelete();
            $table->foreignUuid('payment_method_id')->constrained('payment_methods')->restrictOnDelete();
            $table->uuid('idempotency_key');
            $table->bigInteger('amount');
            $table->string('currency', 3)->default('SAR');
            $table->string('status', 24)->default('created');
            $table->string('provider_ref', 191)->nullable();
            $table->string('approval_code', 32)->nullable();
            $table->string('rrn', 32)->nullable();
            $table->string('last4', 4)->nullable();
            $table->string('failure_code', 48)->nullable();
            $table->unsignedSmallInteger('void_attempts')->default(0);
            $table->string('last_void_error', 48)->nullable();
            $table->timestamp('compensating_until')->nullable();
            // رمز ملكية إيجار عملية المزوّد: نتيجة متأخرة من مالك منتهي الإيجار لا تُطبَّق (providerOp).
            $table->string('lease_token', 36)->nullable();
            $table->foreignUuid('consumed_payment_id')->nullable()->constrained('payments')->restrictOnDelete();
            $table->foreignUuid('consumed_invoice_id')->nullable()->constrained('invoices')->restrictOnDelete();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('resolved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->text('resolution_note')->nullable();
            $table->timestamp('approved_at')->nullable();
            $table->timestamp('consumed_at')->nullable();
            $table->timestamp('voided_at')->nullable();
            $table->timestamp('resolved_at')->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'idempotency_key']);
            $table->unique('consumed_payment_id');
            $table->index(['tenant_id', 'pos_session_id', 'status']);
            $table->index(['tenant_id', 'status', 'approved_at']);
        });

        DB::statement("CREATE UNIQUE INDEX pos_terminal_requests_one_active_per_terminal ON pos_terminal_requests (pos_payment_terminal_id) WHERE status IN ('created', 'sent', 'approved')");
        $statuses = "'created','sent','approved','declined','cancelled','expired','error','consumed','voided','compensation_required','compensated'";
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE pos_terminal_requests ADD CONSTRAINT pos_terminal_requests_amount_positive CHECK (amount > 0)');
            DB::statement("ALTER TABLE pos_terminal_requests ADD CONSTRAINT pos_terminal_requests_status_known CHECK (status IN ({$statuses}))");
        } else {
            // SQLite لا يضيف CHECK بعد الإنشاء: مُشغّلان يعطيان الضمانة نفسها.
            foreach (['INSERT', 'UPDATE'] as $event) {
                $name = 'pos_terminal_requests_guard_'.strtolower($event);
                DB::statement("CREATE TRIGGER {$name} BEFORE {$event} ON pos_terminal_requests FOR EACH ROW WHEN NEW.amount <= 0 OR NEW.status NOT IN ({$statuses}) BEGIN SELECT RAISE(ABORT, 'pos_terminal_requests: invalid amount or status'); END");
            }
        }

        Schema::table('payment_methods', function (Blueprint $table) {
            $table->boolean('pos_terminal_required')->default(false)->after('pos_clearing_gateway_id');
        });
    }

    public function down(): void
    {
        if (DB::table('pos_terminal_requests')->exists() || DB::table('payment_methods')->where('pos_terminal_required', true)->exists()) {
            throw new RuntimeException('لا يمكن التراجع: توجد طلبات أجهزة دفع أو طرق دفع تشترط الموافقة (إصلاح إلى الأمام فقط).');
        }

        Schema::table('payment_methods', function (Blueprint $table) {
            $table->dropColumn('pos_terminal_required');
        });
        DB::statement('DROP INDEX IF EXISTS pos_terminal_requests_one_active_per_terminal');
        DB::statement('DROP TRIGGER IF EXISTS pos_terminal_requests_guard_insert');
        DB::statement('DROP TRIGGER IF EXISTS pos_terminal_requests_guard_update');
        Schema::dropIfExists('pos_terminal_requests');
        Schema::dropIfExists('pos_payment_terminals');
    }
};
