<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * DLV-CONNECTOR-OWNERSHIP-1 — إعادة إسناد تشغيلي صريحة.
 *
 * `configured_by` يبقى منشئ الربط ولا يُعاد كتابته.
 * `operated_by` فارغ على الصفوف القائمة: الإدخال يسقط على المنشئ ما دام مؤهلاً.
 * معرّفات المستخدم في سجل الإسناد ليست مفاتيح أجنبية حتى يبقى الأثر بعد الحذف.
 * ليس تدوير سرّ وليس ترحيلاً مالياً.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('delivery_connector_accounts', function (Blueprint $table) {
            $table->foreignUuid('operated_by')->nullable()->constrained('users')->nullOnDelete();
        });

        Schema::create('delivery_connector_operator_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('delivery_connector_account_id')->constrained('delivery_connector_accounts')->cascadeOnDelete();
            $table->uuid('from_user_id');
            $table->uuid('to_user_id');
            $table->uuid('actor_user_id');
            $table->timestamp('created_at')->nullable();

            $table->index(['tenant_id', 'delivery_connector_account_id'], 'delivery_connector_operator_events_account_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('delivery_connector_operator_events');

        Schema::table('delivery_connector_accounts', function (Blueprint $table) {
            $table->dropConstrainedForeignId('operated_by');
        });
    }
};
