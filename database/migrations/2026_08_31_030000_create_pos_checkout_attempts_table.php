<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * مرساة idempotency لإتمام بيع POS.
 * لا تمثّل قيداً ولا فاتورة — تربط مفتاح محاولة منطقية بفاتورة واحدة بعد نجاح checkout.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('pos_checkout_attempts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained('branches')->restrictOnDelete();
            $table->string('idempotency_key', 128);
            $table->string('request_checksum', 64);
            $table->foreignUuid('invoice_id')->constrained('invoices')->restrictOnDelete();
            $table->uuid('cart_id')->nullable();
            $table->foreignUuid('pos_session_id')->constrained('pos_sessions')->restrictOnDelete();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('created_at');

            $table->unique(['tenant_id', 'branch_id', 'idempotency_key'], 'pos_checkout_attempts_idempotency_unique');
            $table->unique('invoice_id');
            $table->index(['tenant_id', 'branch_id', 'pos_session_id']);
            $table->index(['tenant_id', 'cart_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pos_checkout_attempts');
    }
};
