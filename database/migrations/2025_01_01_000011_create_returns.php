<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // ═══════════════════════════════════════════════════════
        // المرتجعات (Returns) — مبيعات (إشعار دائن) ومشتريات (إشعار مدين)
        // المبالغ بالـ minor units (هللات) كـ bigint
        // ═══════════════════════════════════════════════════════
        Schema::create('return_documents', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('number');                              // SRET-2025-00001 | PRET-2025-00001
            $table->enum('type', ['sales', 'purchase']);
            $table->foreignUuid('partner_id')->constrained('partners')->restrictOnDelete();
            $table->enum('payment_type', ['credit', 'cash'])->default('credit'); // credit=تعديل الذمم، cash=رد نقدي
            $table->date('return_date');
            $table->enum('status', ['draft', 'posted', 'cancelled'])->default('draft');
            $table->bigInteger('subtotal')->default(0);
            $table->bigInteger('tax_amount')->default(0);
            $table->bigInteger('total')->default(0);
            $table->string('notes')->nullable();
            // المستند الأصلي (اختياري للتتبّع): فاتورة مبيعات أو مشتريات
            $table->nullableUuidMorphs('original');
            $table->foreignUuid('journal_entry_id')->nullable()->constrained('journal_entries')->nullOnDelete();
            $table->uuid('cogs_entry_id')->nullable();             // قيد عكس التكلفة (مرتجع مبيعات مخزني)
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'number']);
            $table->index(['tenant_id', 'type']);
            $table->index(['tenant_id', 'partner_id']);
        });

        Schema::create('return_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('return_id')->constrained('return_documents')->cascadeOnDelete();
            $table->foreignUuid('product_id')->nullable()->constrained('products')->nullOnDelete();
            $table->string('description')->nullable();
            $table->integer('quantity')->default(1);
            $table->bigInteger('unit_price')->default(0);
            $table->unsignedSmallInteger('tax_rate')->default(15);
            $table->bigInteger('line_subtotal')->default(0);
            $table->bigInteger('line_tax')->default(0);
            $table->bigInteger('line_total')->default(0);
            $table->timestamps();

            $table->index(['tenant_id', 'return_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('return_lines');
        Schema::dropIfExists('return_documents');
    }
};
