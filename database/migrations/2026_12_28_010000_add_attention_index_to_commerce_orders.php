<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * COPS-H1-2 — فهرس مصالحة الانتباه (ADR-29 §2.4): `GET commerce/orders/attention` يفلتر `tenant_id` + `status = confirmed` + `created_at >= نافذة`
 * ويرتّب بـ`created_at`. فهرس إضافي فقط على جدول قائم: لا عمود ولا مُشغّل ولا تعديل صف. `(tenant_id, status)` القائم لا يغطي الترتيب/النافذة.
 */
return new class extends Migration
{
    private const INDEX = 'commerce_orders_tenant_status_created_idx';

    public function up(): void
    {
        Schema::table('commerce_orders', function (Blueprint $table) {
            $table->index(['tenant_id', 'status', 'created_at'], self::INDEX);
        });
    }

    public function down(): void
    {
        Schema::table('commerce_orders', function (Blueprint $table) {
            $table->dropIndex(self::INDEX);
        });
    }
};
