<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * DLV-CONNECTOR-CORE-1 — سجل محاولة إدخال تشغيلي.
 *
 * يحفظ الجسم الخام مشفَّراً وتجزئته لاكتشاف إعادة التشغيل والتعارض، وللتشخيص
 * لاحقاً. هذا ليس لقطة دليل DG-3: بلا واقعة توريد، بلا ضريبة، بلا سلسلة
 * إبطال قانونية، وبلا ختم زمني يُعامل كنقطة ضريبية. لا يُغلق
 * DG-3-EVIDENCE-SNAPSHOT.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('delivery_connector_attempts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('delivery_connector_account_id')->constrained('delivery_connector_accounts')->cascadeOnDelete();
            $table->uuid('event_id');
            $table->string('raw_checksum', 64);
            $table->string('authoritative_checksum', 64)->nullable();
            $table->string('outcome', 32);
            $table->unsignedSmallInteger('http_status');
            $table->string('error_code', 64)->nullable();
            $table->foreignUuid('delivery_hub_order_id')->nullable()->constrained('delivery_hub_orders')->restrictOnDelete();
            $table->string('provider_order_id', 191)->nullable();
            $table->unsignedInteger('secret_version');
            $table->text('operational_raw_body');
            $table->timestamp('created_at')->nullable();

            $table->unique(['delivery_connector_account_id', 'event_id'], 'delivery_connector_attempt_event_unique');
            $table->index(['tenant_id', 'delivery_hub_order_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('delivery_connector_attempts');
    }
};
