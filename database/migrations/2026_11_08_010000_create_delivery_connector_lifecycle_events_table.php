<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * INT-AUDIT-1 — سجل دورة حياة نقطة الاستقبال الموقّعة (إنشاء / تدوير سر / تعطيل). إلحاقي.
 *
 * لا يحمل سراً ولا بادئة سر ولا رمزاً ولا بيانات طلب ولا IP ولا Request ID: رمز الحدث وأرقام إصدار المفتاح
 * ومعرّفات فقط. معرّفا الحساب والمستخدم **بلا مفتاح أجنبي** عمداً: لا يُفقد الحدث الأمني إن حُذف صف الحساب
 * أو المستخدم، ولا يُحجب حذفٌ مستقبلي مشروع بسبب سجل تدقيق (RESTRICT) ولا يُمسح به (CASCADE). لذلك
 * يُنسخ `platform_key` و`external_store_id` فيبقى الحدث مفهوماً وحده. المستأجر وحده مفتاح أجنبي (محو المستأجر
 * يمحو كل بياناته كبقية الجداول). ليس حالة اتصال مزوّد، وليس مصدر حقيقة مالياً.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('delivery_connector_lifecycle_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->uuid('delivery_connector_account_id');
            $table->string('platform_key', 32);
            $table->string('external_store_id', 191);
            $table->string('event_code', 32);
            $table->uuid('actor_user_id');
            $table->uuid('branch_id')->nullable();
            $table->unsignedInteger('secret_version_from')->nullable();
            $table->unsignedInteger('secret_version_to')->nullable();
            $table->timestamp('created_at');

            $table->index(['tenant_id', 'delivery_connector_account_id', 'created_at'], 'delivery_connector_lifecycle_events_account_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('delivery_connector_lifecycle_events');
    }
};
