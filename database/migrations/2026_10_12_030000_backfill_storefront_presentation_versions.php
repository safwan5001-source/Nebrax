<?php

use App\Services\Commerce\StorefrontPresentationVersionBackfillService;
use Illuminate\Database\Migrations\Migration;

/**
 * CUST-H1-1 — يشغّل هجرة النسخ الفعلية لأي `storefront_presentations` قائمة
 * على بيئة حقيقية (تجّار حاليون قبل هذا الأفق). آمنة على قاعدة بيانات
 * اختبار فارغة (RefreshDatabase/`migrate:fresh`) — لا صفوف موجودة فتُهاجَر
 * صفراً منها، بلا أثر (Case A). المنطق نفسه قابل للاستدعاء مباشرة من
 * الاختبارات عبر `StorefrontPresentationVersionBackfillService` لاختبار
 * الحالات B/C/D بمعزل عن توقيت الهجرة.
 *
 * لا `down()` عكسي: هذه بيانات لا مخطط — التراجع عن الهجرة السابقة
 * (`add_version_pointers...`) يُسقط الأعمدة أصلاً فتُحذف صفوف النسخ معها
 * بفعل cascade، ولا معنى لحذفها هنا يدوياً.
 */
return new class extends Migration
{
    public function up(): void
    {
        app(StorefrontPresentationVersionBackfillService::class)->backfillAll();
    }

    public function down(): void
    {
        // انظر تعليق الرأس — لا إجراء عكسي منفصل مطلوب.
    }
};
