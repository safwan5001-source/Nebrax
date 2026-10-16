<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * REM-14 (14a + 14c) — لقطة البائع والمشتري عند إصدار الفاتورة.
 *
 * عمود واحد إضافي **nullable**: `invoices.party_snapshot` (JSON). يُكتب مرة واحدة داخل معاملة الترحيل
 * (`InvoiceService::post`) بحدّ `issued_at` نفسه، ولا يتغيّر بعدها (حارس النموذج `Invoice::booted`).
 * الشكل (v = 1): `{v, seller:{…}, buyer:{…}}` — انظر `App\Support\InvoicePartySnapshot`.
 *
 * **لا Backfill إطلاقاً.** الصفوف المرحَّلة قبل هذه الهجرة تبقى `NULL`: القيم الحية الحالية للعميل أو الشركة ليست
 * وقائع لحظة الإصدار، فلا تُنسَخ إلى الماضي. تُعرض تلك الفواتير من البيانات الحية كتوافق مؤقت لا كضمان تاريخي.
 *
 * بلا فهرس ولا CHECK ولا Trigger: لا استعلام على محتواه، والثبات يفرضه النموذج على القاعدتين بالطريقة نفسها.
 * النوع `json` (لا `jsonb`) كي يُحفظ النص كما كُتب فلا يتغيّر ترتيب المفاتيح بين SQLite وPostgreSQL.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            $table->json('party_snapshot')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            $table->dropColumn('party_snapshot');
        });
    }
};
