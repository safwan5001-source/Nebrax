<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * ═══════════════════════════════════════════════════════════════
     *  AWJ-TAX-REM-02 — ربط سطر الإشعار الدائن بسطره في الفاتورة المصدر
     * ═══════════════════════════════════════════════════════════════
     *  كما فعلت 000051 لسطر المرتجع: الرأس يحمل `original_invoice_id` لكنه
     *  وحده لا يقيس «كم رُدَّ/خُصم من هذا السطر»، ولا يمنع تجاوز الكمية أو
     *  الضريبة المحصَّلة. فيُربط السطر بسطره، والسقف التراكمي يُقاس على
     *  سطر المصدر عبر `ReturnSourceAllocator` مع المرتجعات.
     *
     *  - `source_line_id`: بلا مفتاح أجنبي (مثل `return_lines.source_line_id`):
     *    السلامة تُفرض في `CreditNoteService` الذي يتحقق أن السطر يخصّ الفاتورة
     *    المصدر فعلاً داخل المستأجر. ونمط السطر-للسطر يُبقي التصميم متوافقاً
     *    مع إشعارٍ يمسّ عدة فواتير للعميل نفسه لاحقاً (R1-117، REM-18).
     *  - `line_discount`: كما في `return_lines`، يحفظ خصم السطر وحصته من خصم
     *    الرأس لتبقى الصيغة (subtotal − discount = الصافي) واحدة في المرتجع
     *    والإشعار، ويُجمَع الاثنان في سقفٍ واحد.
     *
     *  **إضافية بحتة:** كلا العمودين nullable/افتراضه صفر. كل إشعار قائم
     *  (مرحَّل أو مسوَّدة) يبقى كما هو بالبايت: `line_discount = 0` و
     *  `source_line_id = NULL`، فالمجاميع المشتقة منها لا تتغير.
     */
    public function up(): void
    {
        Schema::table('credit_note_lines', function (Blueprint $table) {
            $table->uuid('source_line_id')->nullable()->after('product_id');
            $table->bigInteger('line_discount')->default(0)->after('line_subtotal');

            $table->index(['tenant_id', 'source_line_id'], 'credit_note_lines_tenant_source_line_index');
        });
    }

    public function down(): void
    {
        Schema::table('credit_note_lines', function (Blueprint $table) {
            $table->dropIndex('credit_note_lines_tenant_source_line_index');
            $table->dropColumn(['source_line_id', 'line_discount']);
        });
    }
};
