<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * ACC-RET-1 — استرداد المورّد (Supplier Refund) مستندٌ مالي مستقل.
 *
 * `مرتجع المشتريات ≠ استرداد المورّد`: المرتجع يعكس الالتزام تجارياً على
 * الموردين (2110)، وهذا المستند وحده يسجّل عودة النقد فعلاً — مدين الخزينة/
 * البنك المختار (CashBankAccount) ودائن الموردين. إضافي بالكامل: لا يمسّ
 * `return_documents` ولا أي قيدٍ تاريخي.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('supplier_refunds', function (Blueprint $table) {
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
        DB::statement('CREATE UNIQUE INDEX supplier_refunds_unbranched_number_unique ON supplier_refunds (tenant_id, number) WHERE branch_id IS NULL');

        // تخصيص الاسترداد على مرتجعات مشتريات مرحّلة. جدول مستقل عمداً — لا
        // يُعاد استخدام `payment_allocations` (عقدها فاتورة/مشترى لا مرتجع).
        Schema::create('supplier_refund_allocations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('supplier_refund_id')->constrained('supplier_refunds')->cascadeOnDelete();
            $table->foreignUuid('purchase_return_id')->constrained('return_documents')->restrictOnDelete();
            $table->bigInteger('amount')->default(0); // هللات
            $table->timestamps();

            // صفٌّ واحد لكل (استرداد، مرتجع): تكرارهما تخصيصٌ مضاعف لا حالة عمل.
            $table->unique(['supplier_refund_id', 'purchase_return_id'], 'supplier_refund_allocations_unique_target');
            // مصدر حساب الرصيد القابل للاسترداد لكل مرتجع.
            $table->index(['tenant_id', 'purchase_return_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('supplier_refund_allocations');
        DB::statement('DROP INDEX IF EXISTS supplier_refunds_unbranched_number_unique');
        Schema::dropIfExists('supplier_refunds');
    }
};
