<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // ═══════════════════════════════════════════════════════
        // عروض الأسعار (Quotes) — مستند تجاري غير محاسبي.
        // لا يولّد قيوداً؛ يُحوَّل إلى فاتورة عند القبول.
        // كل المبالغ بالـ minor units (هللات) كـ bigint.
        // ═══════════════════════════════════════════════════════
        Schema::create('quotes', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('number');                                   // QUO-2025-00001
            $table->foreignUuid('partner_id')->constrained('partners')->restrictOnDelete();
            $table->date('quote_date');
            $table->date('valid_until')->nullable();
            $table->enum('status', ['draft', 'sent', 'accepted', 'rejected', 'converted'])->default('draft');
            $table->bigInteger('subtotal')->default(0);
            $table->bigInteger('tax_amount')->default(0);
            $table->bigInteger('total')->default(0);
            $table->string('notes')->nullable();
            // الفاتورة الناتجة عند التحويل (إن وُجدت)
            $table->foreignUuid('converted_invoice_id')->nullable()->constrained('invoices')->nullOnDelete();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'number']);
            $table->index(['tenant_id', 'partner_id']);
            $table->index(['tenant_id', 'status']);
        });

        Schema::create('quote_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('quote_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('product_id')->nullable()->constrained('products')->nullOnDelete();
            $table->string('description')->nullable();
            $table->integer('quantity')->default(1);
            $table->bigInteger('unit_price')->default(0);
            $table->unsignedSmallInteger('tax_rate')->default(15);
            $table->bigInteger('line_subtotal')->default(0);
            $table->bigInteger('line_tax')->default(0);
            $table->bigInteger('line_total')->default(0);
            $table->timestamps();

            $table->index(['tenant_id', 'quote_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('quote_lines');
        Schema::dropIfExists('quotes');
    }
};
