<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * DLV-CONNECTOR-CORE-1 — حساب موصّل تشغيلي.
 *
 * يربط متجر مزوّد صريحاً بملف منصة ومستأجر وفرع اختياري. المستأجر لا يُشتق من
 * جسم الطلب. السر مشفَّر at-rest عبر cast `encrypted` (نفس WebhookEndpoint).
 * الحالة `configured|disabled` فقط — لا Connected ولا Live ولا Synced.
 * ليس عقد دليل ضريبي (DG-3-EVIDENCE-SNAPSHOT) ولا يُفعّل مزوّداً.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('delivery_connector_accounts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('delivery_platform_profile_id')->constrained('delivery_platform_profiles')->restrictOnDelete();
            $table->string('platform_key', 32);
            $table->string('external_store_id', 191);
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->restrictOnDelete();
            $table->foreignUuid('configured_by')->nullable()->constrained('users')->nullOnDelete();
            $table->text('secret');
            $table->string('secret_prefix', 32);
            $table->unsignedInteger('secret_version')->default(1);
            $table->string('status', 20);
            $table->timestamp('disabled_at')->nullable();
            $table->timestamps();

            $table->unique(['platform_key', 'external_store_id'], 'delivery_connector_store_unique');
            $table->index(['tenant_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('delivery_connector_accounts');
    }
};
