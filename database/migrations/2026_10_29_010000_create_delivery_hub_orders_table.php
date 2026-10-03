<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * DLV-HUB-PROJECTION-1 — صف تشغيلي لإسقاط طلب توصيل.
 *
 * ليس فاتورة ولا سنداً ولا قيداً ولا حركة مخزون. `provider_order_id` جزء من
 * هوية دائمة مع المستأجر وملف المنصة، بما في ذلك بعد الإلغاء. `NULL` في
 * PostgreSQL وSQLite لا يتصادم، لذلك الصفوف اليدوية بلا رقم مزود لا تُحشَر
 * في ذلك القيد. `external_order_reference` بلا فهرس فريد: عرض فقط.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('delivery_hub_orders', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->restrictOnDelete();
            $table->foreignUuid('delivery_platform_profile_id')->constrained('delivery_platform_profiles')->restrictOnDelete();
            $table->string('state', 32);
            $table->string('provider_order_id', 191)->nullable();
            $table->string('external_order_reference', 191)->nullable();
            $table->uuid('idempotency_key')->nullable();
            $table->char('request_checksum', 64);
            $table->char('intake_payload_hash', 64);
            $table->string('provider_status', 255)->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(
                ['tenant_id', 'delivery_platform_profile_id', 'provider_order_id'],
                'delivery_hub_orders_provider_identity_unique'
            );
            $table->unique(['tenant_id', 'idempotency_key'], 'delivery_hub_orders_idempotency_unique');
            $table->index(['tenant_id', 'branch_id', 'state']);
            $table->index(['tenant_id', 'state']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('delivery_hub_orders');
    }
};
