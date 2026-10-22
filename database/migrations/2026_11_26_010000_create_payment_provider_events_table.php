<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * AWJ-PAYMENTS-HZ-01 / PAY-H1-04 — صندوق أحداث المزوّد + أعمدة المطابقة المجدولة (إضافي فقط؛ لا مساس بجدول مالي).
 *
 * - `payment_provider_events`: كل حدث webhook **متحقَّق التوقيع** يُحفظ مرة واحدة (`UNIQUE(gateway, provider_event_id)`) ببصمة جسمه
 *   (`body_hash`) وجسمه مشفَّراً (≤ 64KB، يُقصّ بعد 180 يوماً — D-20؛ الصف يبقى). لا تُطبَّق حالة من جسم الحدث أبداً: الحدث
 *   يطلق استعلام المزوّد (الحقيقة) فقط. التوقيع الخاطئ لا يُخزَّن.
 * - أعمدة على `payment_attempts` للمطابِق المجدول: `reconcile_lease_until` (إيجار ذرّي)، `next_reconcile_at` (تراجع عند الفشل)،
 *   `reconcile_failures`، `last_reconcile_error` (رمز ثابت فقط).
 *
 * `down()` يرفض متى وُجد أي حدث (مراجع مالية مرجعية؛ إصلاح إلى الأمام فقط).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payment_provider_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('payment_gateway_id')->constrained('payment_gateways');
            $table->string('provider', 32);
            $table->string('provider_event_id', 191);
            $table->string('event_type', 96)->nullable();
            $table->string('provider_payment_id', 191)->nullable();
            $table->foreignUuid('payment_attempt_id')->nullable()->constrained('payment_attempts');
            $table->char('body_hash', 64);
            $table->longText('body')->nullable();
            $table->string('status', 16)->default('received');   // received | processed | unmatched
            $table->string('outcome', 32)->nullable();           // applied | duplicate | stale | state_conflict | attempt_not_found
            $table->timestamp('received_at', 6);
            $table->timestamp('processed_at', 6)->nullable();

            $table->unique(['payment_gateway_id', 'provider_event_id'], 'payment_provider_events_dedupe_unique');
            $table->index(['tenant_id', 'received_at'], 'payment_provider_events_tenant_idx');
            $table->index('payment_attempt_id', 'payment_provider_events_attempt_idx');
        });

        Schema::table('payment_attempts', function (Blueprint $table) {
            $table->timestamp('reconcile_lease_until')->nullable();
            $table->timestamp('next_reconcile_at')->nullable();
            $table->unsignedSmallInteger('reconcile_failures')->default(0);
            $table->string('last_reconcile_error', 48)->nullable();
        });
    }

    public function down(): void
    {
        if (Schema::hasTable('payment_provider_events') && \Illuminate\Support\Facades\DB::table('payment_provider_events')->exists()) {
            throw new RuntimeException('Rollback refused: payment_provider_events contains rows (financial references). Fix forward instead.');
        }

        Schema::table('payment_attempts', function (Blueprint $table) {
            $table->dropColumn(['reconcile_lease_until', 'next_reconcile_at', 'reconcile_failures', 'last_reconcile_error']);
        });
        Schema::dropIfExists('payment_provider_events');
    }
};
