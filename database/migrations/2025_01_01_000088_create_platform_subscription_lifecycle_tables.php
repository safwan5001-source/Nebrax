<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // كتالوج أسعار مؤرّخ للمنصة. السجل لا يمثل فاتورة أو تحصيلاً نقدياً.
        Schema::create('platform_price_versions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('plan');
            $table->string('currency', 3)->default('SAR');
            $table->unsignedBigInteger('monthly_amount');
            $table->date('effective_on');
            $table->foreignUuid('created_by')->nullable()->constrained('platform_administrators')->nullOnDelete();
            $table->timestamps();

            $table->unique(['plan', 'currency', 'effective_on']);
            $table->index(['plan', 'currency', 'effective_on']);
        });

        // يثبت سعر العقد المتعاقد عليه حتى لو ظهرت نسخة سعر أحدث لاحقاً.
        Schema::table('platform_subscriptions', function (Blueprint $table) {
            $table->foreignUuid('platform_price_version_id')
                ->nullable()
                ->after('tenant_id')
                ->constrained('platform_price_versions')
                ->restrictOnDelete();
            $table->index('platform_price_version_id');
        });

        // سجل أحداث append-only للعقد. لا يحل محل سجل تدقيق وصول المستأجر.
        Schema::create('platform_subscription_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('platform_subscription_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('platform_administrator_id')->nullable()->constrained()->nullOnDelete();
            $table->string('action');
            $table->string('from_plan')->nullable();
            $table->string('to_plan')->nullable();
            $table->unsignedBigInteger('from_monthly_amount')->nullable();
            $table->unsignedBigInteger('to_monthly_amount')->nullable();
            $table->date('effective_on');
            $table->string('reason')->nullable();
            $table->json('metadata')->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->index(['platform_subscription_id', 'created_at']);
            $table->index(['tenant_id', 'created_at']);
            $table->index(['action', 'effective_on']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('platform_subscription_events');

        Schema::table('platform_subscriptions', function (Blueprint $table) {
            $table->dropForeign(['platform_price_version_id']);
            $table->dropIndex(['platform_price_version_id']);
            $table->dropColumn('platform_price_version_id');
        });

        Schema::dropIfExists('platform_price_versions');
    }
};
