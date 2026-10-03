<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * DLV-ACCOUNTING-1 — مرجع منصة توصيل اختياري على سند القبض، بنفس نمط
 * `payment_gateway_id` حرفياً (2026_09_21_020000) ومستقلّ عنه تماماً (DG-1:
 * لا إعادة تفسير لـ`PaymentGateway` كهوية منصة توصيل). وجوده على السند هو
 * ما يحوّل القبض إلى مقاصة المنصة بدل النقد/البنك في `PaymentService::post()`.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payments', function (Blueprint $table) {
            $table->foreignUuid('delivery_platform_profile_id')
                ->nullable()
                ->constrained('delivery_platform_profiles')
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('payments', function (Blueprint $table) {
            $table->dropForeign(['delivery_platform_profile_id']);
            $table->dropColumn('delivery_platform_profile_id');
        });
    }
};
