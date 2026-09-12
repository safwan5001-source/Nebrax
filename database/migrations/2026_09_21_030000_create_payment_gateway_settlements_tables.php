<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payment_gateway_settlements', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('payment_gateway_id')->constrained('payment_gateways')->restrictOnDelete();
            $table->foreignUuid('cash_bank_account_id')->constrained('cash_bank_accounts')->restrictOnDelete();
            $table->string('provider_settlement_ref');
            $table->date('settlement_date');
            $table->string('status')->default('posted');
            $table->unsignedBigInteger('gross_amount');
            $table->unsignedBigInteger('net_bank_amount');
            $table->unsignedBigInteger('provider_fee_ex_tax')->default(0);
            $table->unsignedBigInteger('provider_fee_tax')->default(0);
            $table->unsignedBigInteger('provider_deductions')->default(0);
            $table->unsignedBigInteger('provider_credits')->default(0);
            $table->string('currency')->default('SAR');
            $table->string('gateway_provider')->nullable();
            $table->string('gateway_name')->nullable();
            $table->uuid('clearing_account_id')->nullable();
            $table->uuid('fee_expense_account_id')->nullable();
            $table->uuid('bank_account_id')->nullable();
            $table->foreignUuid('journal_entry_id')->nullable()->constrained('journal_entries')->nullOnDelete();
            $table->timestamp('posted_at')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(
                ['tenant_id', 'payment_gateway_id', 'provider_settlement_ref'],
                'pgs_tenant_gateway_ref_unique'
            );
            $table->index(['tenant_id', 'settlement_date'], 'pgs_tenant_date_idx');
        });

        Schema::create('payment_gateway_settlement_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('settlement_id')->constrained('payment_gateway_settlements')->cascadeOnDelete();
            $table->foreignUuid('payment_id')->constrained('payments')->restrictOnDelete();
            $table->string('provider_event_ref')->nullable();
            $table->unsignedBigInteger('gross_amount');
            $table->timestamps();

            $table->unique(['settlement_id', 'payment_id'], 'pgsi_settlement_payment_unique');
            $table->index(['tenant_id', 'payment_id'], 'pgsi_tenant_payment_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payment_gateway_settlement_items');
        Schema::dropIfExists('payment_gateway_settlements');
    }
};
