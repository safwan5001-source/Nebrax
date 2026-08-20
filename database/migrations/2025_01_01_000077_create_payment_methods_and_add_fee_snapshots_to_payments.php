<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * طرق الدفع إعدادات مشتركة للمؤسسة؛ لا تخص فرعاً ولا تنشئ قيداً مستقلاً.
     * تحفظ السندات لقطة الطريقة ورسومها وحساب مصروفها حتى تبقى الوثيقة التاريخية
     * صادقة إذا عُدلت الطريقة أو عُطلت لاحقاً.
     */
    public function up(): void
    {
        Schema::create('payment_methods', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->string('name_en')->nullable();
            $table->string('settlement_type', 16)->default('cash'); // cash | bank
            $table->foreignUuid('cash_bank_account_id')->nullable()->constrained('cash_bank_accounts')->restrictOnDelete();
            $table->string('instructions', 1000)->nullable();
            $table->boolean('available_online')->default(false);
            $table->boolean('is_active')->default(true);
            $table->boolean('is_default')->default(false);
            $table->boolean('fees_enabled')->default(false);
            // 0.7% = 70 نقطة أساس؛ المال والرسوم الثابتة بالهللات.
            $table->unsignedInteger('fee_rate_bps')->default(0);
            $table->bigInteger('fee_fixed_amount')->default(0);
            $table->bigInteger('fee_min_amount')->default(0);
            $table->unsignedInteger('fee_tax_rate')->default(0);
            $table->foreignUuid('fee_expense_account_id')->nullable()->constrained('accounts')->restrictOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'name']);
            $table->index(['tenant_id', 'is_active']);
            $table->index(['tenant_id', 'is_default']);
        });

        Schema::table('payments', function (Blueprint $table) {
            $table->foreignUuid('payment_method_id')->nullable()->after('method')->constrained('payment_methods')->restrictOnDelete();
            // لقطة الاسم تجعل السند مقروءاً بعد تغيير اسم الطريقة أو تعطيلها.
            $table->string('payment_method_name')->nullable()->after('payment_method_id');
            $table->bigInteger('fee_amount')->default(0)->after('amount');
            $table->bigInteger('fee_tax_amount')->default(0)->after('fee_amount');
            $table->foreignUuid('fee_expense_account_id')->nullable()->after('fee_tax_amount')->constrained('accounts')->restrictOnDelete();
            $table->index(['tenant_id', 'payment_method_id']);
        });
    }

    public function down(): void
    {
        Schema::table('payments', function (Blueprint $table) {
            $table->dropIndex(['tenant_id', 'payment_method_id']);
            $table->dropConstrainedForeignId('fee_expense_account_id');
            $table->dropColumn(['fee_tax_amount', 'fee_amount', 'payment_method_name']);
            $table->dropConstrainedForeignId('payment_method_id');
        });

        Schema::dropIfExists('payment_methods');
    }
};
