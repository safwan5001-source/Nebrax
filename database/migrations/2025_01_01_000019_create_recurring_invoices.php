<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // ═══════════════════════════════════════════════════════
        // الفواتير الدورية (Recurring Invoices) — قالب + جدولة.
        // القالب غير محاسبي؛ توليد فاتورة منه ينتج فاتورة draft عبر
        // InvoiceService (الأثر المحاسبي يبدأ عند ترحيلها لاحقاً).
        // كل المبالغ بالهللات كـ bigint.
        // ═══════════════════════════════════════════════════════
        Schema::create('recurring_invoices', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('title')->nullable();
            $table->foreignUuid('partner_id')->constrained('partners')->restrictOnDelete();
            $table->enum('payment_type', ['cash', 'credit'])->default('credit');
            $table->enum('frequency', ['weekly', 'monthly', 'quarterly', 'yearly'])->default('monthly');
            $table->date('start_date');
            $table->date('next_run_date');
            $table->date('end_date')->nullable();
            $table->boolean('active')->default(true);
            $table->unsignedInteger('generated_count')->default(0);
            $table->bigInteger('subtotal')->default(0);
            $table->bigInteger('tax_amount')->default(0);
            $table->bigInteger('total')->default(0);
            $table->string('notes')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['tenant_id', 'partner_id']);
            $table->index(['tenant_id', 'active']);
        });

        Schema::create('recurring_invoice_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('recurring_invoice_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('product_id')->nullable()->constrained('products')->nullOnDelete();
            $table->string('description')->nullable();
            $table->integer('quantity')->default(1);
            $table->bigInteger('unit_price')->default(0);
            $table->unsignedSmallInteger('tax_rate')->default(15);
            $table->bigInteger('line_subtotal')->default(0);
            $table->bigInteger('line_tax')->default(0);
            $table->bigInteger('line_total')->default(0);
            $table->timestamps();

            $table->index(['tenant_id', 'recurring_invoice_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('recurring_invoice_lines');
        Schema::dropIfExists('recurring_invoices');
    }
};
