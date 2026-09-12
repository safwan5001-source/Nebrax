<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * PAY-V2-6B — استرداد العميل (Customer Refund) مستندٌ مالي مستقل.
 *
 * `مرتجع المبيعات/الإشعار الدائن ≠ استرداد العميل`: المستند التجاري يعكس
 * الإيراد والضريبة ويُنشئ رصيداً على العملاء (`accounts_receivable`) حين
 * يكون آجلاً، وهذا المستند وحده يُخرج النقد فعلاً — مدين العملاء ودائن
 * الخزينة/البنك المختار (CashBankAccount). إضافي بالكامل: لا يمسّ
 * `return_documents` ولا `credit_notes` ولا أي قيدٍ تاريخي ولا سند قبض.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('customer_refunds', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            // مستند مالي موسوم بالفرع: لا Scope عالمي حتى لا تنكسر تقارير كل الفروع.
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->string('number');
            $table->foreignUuid('partner_id')->constrained('partners')->restrictOnDelete();
            $table->date('refund_date');
            $table->bigInteger('amount')->default(0); // هللات
            $table->enum('method', ['cash', 'bank'])->default('cash');
            $table->foreignUuid('payment_method_id')->nullable()->constrained('payment_methods')->nullOnDelete();
            $table->string('payment_method_name')->nullable();
            // حساب الأستاذ للخزينة/البنك المختار — نفس اصطلاح `payments.cash_account_id`.
            $table->foreignUuid('cash_account_id')->constrained('accounts')->restrictOnDelete();
            $table->string('reference')->nullable();
            $table->text('notes')->nullable();
            $table->enum('status', ['draft', 'posted', 'reversed'])->default('draft');
            $table->foreignUuid('journal_entry_id')->nullable()->constrained('journal_entries')->restrictOnDelete();
            $table->foreignUuid('reversal_entry_id')->nullable()->constrained('journal_entries')->restrictOnDelete();
            $table->timestamp('posted_at')->nullable();
            $table->timestamp('reversed_at')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'branch_id', 'number']);
            $table->index(['tenant_id', 'partner_id']);
            $table->index(['tenant_id', 'status']);
            $table->index(['tenant_id', 'refund_date']);
        });

        // NULL لا يتصادم في الفهرس المركب؛ للمستندات غير الموسومة بالفرع قيدٌ صريح.
        DB::statement('CREATE UNIQUE INDEX customer_refunds_unbranched_number_unique ON customer_refunds (tenant_id, number) WHERE branch_id IS NULL');

        // تخصيص الاسترداد على تصحيحات تجارية مرحّلة أنشأت رصيد عميل.
        // جدول مستقل عمداً — لا يُعاد استخدام `payment_allocations` (عقدها
        // فاتورة/مشترى لا مرتجع/إشعار) ولا `supplier_refund_allocations`.
        Schema::create('customer_refund_allocations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('customer_refund_id')->constrained('customer_refunds')->cascadeOnDelete();
            $table->string('source_type');
            $table->uuid('source_id');
            $table->bigInteger('amount')->default(0); // هللات
            $table->timestamps();

            $table->unique(['customer_refund_id', 'source_type', 'source_id'], 'customer_refund_allocations_unique_target');
            $table->index(['tenant_id', 'source_type', 'source_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('customer_refund_allocations');
        DB::statement('DROP INDEX IF EXISTS customer_refunds_unbranched_number_unique');
        Schema::dropIfExists('customer_refunds');
    }
};
