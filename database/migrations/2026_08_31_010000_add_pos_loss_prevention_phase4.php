<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 4 — idempotency لأحداث تدقيق POS الحساسة (لا مصدر حقيقة موازٍ، إضافي بحت).
 *
 * `pos_session_events` يبقى append-only كما هو؛ العمودان الجديدان يمنعان فقط أن
 * تُنتج إعادة إرسال شبكة (retry) لنفس الطلب صفّ دليل مكرَّراً أو متضارباً. القيد
 * الفريد يسمح بعدة صفوف `client_event_id IS NULL` (السلوك الافتراضي لكل من
 * SQLite وPostgreSQL: NULL لا يساوي NULL في فهرس UNIQUE) — فكل الأحداث القديمة
 * والأحداث الخادمية البحتة التي لا تحمل هذا المفتاح تبقى كما هي بلا تأثير.
 *
 * لا تعديل على `pos_exceptions`/`pos_exception_rules`: القواعد الجديدة (انظر
 * `PosExceptionRuleCatalog`) تُخزَّن في الجدولين القائمين بلا تغيير بنيوي.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('pos_session_events', function (Blueprint $table) {
            $table->string('client_event_id', 100)->nullable()->after('correlation_id');
            $table->string('client_event_payload_hash', 64)->nullable()->after('client_event_id');

            $table->unique(['tenant_id', 'client_event_id'], 'pos_events_client_event_id_unique');
        });
    }

    public function down(): void
    {
        Schema::table('pos_session_events', function (Blueprint $table) {
            $table->dropUnique('pos_events_client_event_id_unique');
            $table->dropColumn(['client_event_id', 'client_event_payload_hash']);
        });
    }
};
