<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * مرساتا idempotency لمرتجع POS واستبدال POS (R4).
 * على نمط `pos_checkout_attempts` تماماً: لا تمثّلان قيداً ولا مستنداً — تربط
 * مفتاح محاولة منطقية بمستندٍ واحد بعد نجاح `create()` الناجح، فيعيد أي طلبٍ
 * لاحق بالمفتاح نفسه المستندَ الأصلي بدل تكراره مالياً أو مخزنياً.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('pos_return_attempts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained('branches')->restrictOnDelete();
            $table->string('idempotency_key', 128);
            $table->string('request_checksum', 64);
            $table->foreignUuid('return_id')->constrained('return_documents')->restrictOnDelete();
            $table->foreignUuid('pos_session_id')->constrained('pos_sessions')->restrictOnDelete();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('created_at');

            $table->unique(['tenant_id', 'branch_id', 'idempotency_key'], 'pos_return_attempts_idempotency_unique');
            $table->unique('return_id');
            $table->index(['tenant_id', 'branch_id', 'pos_session_id']);
        });

        Schema::create('pos_exchange_attempts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained('branches')->restrictOnDelete();
            $table->string('idempotency_key', 128);
            $table->string('request_checksum', 64);
            $table->foreignUuid('exchange_id')->constrained('pos_exchanges')->restrictOnDelete();
            $table->foreignUuid('pos_session_id')->constrained('pos_sessions')->restrictOnDelete();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('created_at');

            $table->unique(['tenant_id', 'branch_id', 'idempotency_key'], 'pos_exchange_attempts_idempotency_unique');
            $table->unique('exchange_id');
            $table->index(['tenant_id', 'branch_id', 'pos_session_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pos_exchange_attempts');
        Schema::dropIfExists('pos_return_attempts');
    }
};
