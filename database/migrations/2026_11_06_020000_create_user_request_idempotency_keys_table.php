<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * AWJ-HORIZON-MEDIA-STORAGE S3 — Idempotency لطلبات المستخدمين (الواجهة) على إنشاء المصروف والدفعة.
 *
 * الحالة التي يحميها: «نجح الحفظ ثم انقطعت الاستجابة فأعاد العميل الطلب». إضافي بحت (جدول جديد) ولا يمسّ
 * أي جدول مالي. بوابة التزامن = قيد فريد `(tenant_id, user_id, key_hash)` على نمط
 * `public_api_idempotency_keys`. المفتاح الخام لا يُخزَّن (sha256)، ولا جسم الطلب (بصمة sha256).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('user_request_idempotency_keys', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('user_id')->constrained('users')->cascadeOnDelete();

            $table->string('key_hash', 64);
            $table->string('method', 10);
            $table->string('route_identity', 191)->nullable();
            $table->string('request_fingerprint', 64);

            $table->string('status', 20)->default('in_progress');
            $table->unsignedSmallInteger('response_status')->nullable();
            $table->text('response_body')->nullable();
            $table->json('response_headers')->nullable();

            $table->timestamp('locked_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamp('expires_at');
            $table->timestamps();

            $table->unique(['tenant_id', 'user_id', 'key_hash'], 'user_req_idem_unique');
            $table->index('expires_at', 'user_req_idem_expires_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_request_idempotency_keys');
    }
};
