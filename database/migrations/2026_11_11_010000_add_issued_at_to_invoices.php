<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * REM-13a / ADR-0001 — لحظة الإصدار القانونية للفاتورة.
 *
 * عمود واحد إضافي **nullable**: `invoices.issued_at` — `timestamp(0)` بدقة ثانية، يُخزَّن بتوقيت UTC دائماً
 * (يُكتب من `now('UTC')` صراحةً لا من المنطقة الافتراضية للتطبيق). يُلتقط مرة واحدة داخل معاملة الترحيل
 * ولا يتغيّر بعدها (حارس النموذج `Invoice::booted`).
 *
 * **لا Backfill إطلاقاً.** الصفوف المرحَّلة قبل هذه الهجرة تبقى `NULL` — أي «لم تُسجَّل لحظة إصدار» —
 * ولا تُملأ من `created_at` (وقت المسودة) ولا من `journal_entries.posted_at` ولا من XML المحفوظ. XML الموقَّع
 * وQR والهاش وسلسلة PIH لتلك الفواتير لا تُمَسّ؛ ولا يُعاد توليد شيء منها.
 *
 * بلا فهرس ولا CHECK ولا Trigger: لا استعلام يحتاجه الآن، والثبات يفرضه النموذج على القاعدتين بالطريقة نفسها
 * (SQLite/PostgreSQL) دون اختلاف سلوك.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            $table->timestamp('issued_at', 0)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            $table->dropColumn('issued_at');
        });
    }
};
