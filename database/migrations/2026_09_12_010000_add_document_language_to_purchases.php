<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * لغة مستند فاتورة المشتريات — نفس عقد PR-LANG-1 (الفواتير) حرفياً، مطبَّقاً
 * على `purchases` فقط. كلا العمودين nullable للتوافق الرجعي الكامل: كل صفوف
 * المشتريات القائمة تحصل على NULL؛ العرض يسقط تلقائياً إلى
 * `tenants.settings.documents.default_language` ثم إلى `ar`. لا backfill.
 *
 * `language` = قرار المسودة (يُعدَّل حتى الترحيل).
 * `language_frozen` = لقطة العرض عند الترحيل (immutable بعد `PurchaseService::post()`).
 *
 * التجميد يحدث بنفس نقطة الالتزام التي تُجمِّد لقطات القوالب الثلاث
 * (print/pdf/thermal) داخل `post()` — بلا خدمة جديدة ولا سيمنطيقس جديدة.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('purchases', function (Blueprint $table) {
            // VARCHAR(16) — يحتمل مفردات V1 (`ar`,`en`,`bilingual`) وأي توسّع مستقبلي
            // مقيّد في `PrintTemplateContract::DOCUMENT_LANGUAGES`. الحارس في PHP.
            $table->string('language', 16)->nullable()
                ->after('thermal_template_revision_id');
            $table->string('language_frozen', 16)->nullable()
                ->after('language');
        });
    }

    public function down(): void
    {
        Schema::table('purchases', function (Blueprint $table) {
            $table->dropColumn(['language_frozen', 'language']);
        });
    }
};
