<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * ═══════════════════════════════════════════════════════════════
     *  AWJ-TAX-REM-02 — مراجعة المالية لأسطر الإشعارات التاريخية غير القابلة للربط
     * ═══════════════════════════════════════════════════════════════
     *  إشعار دائن **مرحَّل** سبق REM-02 بلا `source_line_id` يُنسب عند القراءة إلى سطر
     *  الفاتورة الوحيد الذي يحمل منتجه. السطر الذي لا يُحسم نسبه (بلا منتج، أو منتجه
     *  يتكرر في الفاتورة) كان يُترك خارج السقف التراكمي، فيُسمح بعكسٍ إضافي غير آمن.
     *  القرار المعتمد: تُحظر العمليات المتأثرة (إشعار دائن/مرتجع/مرتجع POS) على تلك
     *  الفاتورة وحدها، إلى أن تراجع المالية كل سطرٍ غير محسوم.
     *
     *  هذا الجدول **طبقة تراكب** (overlay) لقرار المراجعة: لا يُعدَّل أي صف في
     *  `credit_notes` أو `credit_note_lines` المرحَّلة (immutable). القرار إما:
     *    - `attributed`: السطر يستهلك `source_line_id` (سطر في الفاتورة نفسها) فيُحسب في السقف.
     *    - `not_applicable`: السطر لا يستهلك سطراً من الفاتورة (تسوية بلا كمية)، فلا يُحسب.
     *  ولكل قرار سبب ومراجِع وتاريخ. صفوفه للإلحاق فقط (لا تعديل ولا حذف من التطبيق).
     *
     *  إضافية بحتة: لا يتغير شيء لأي مستأجر بلا أسطر غير محسومة.
     */
    public function up(): void
    {
        Schema::create('credit_note_legacy_reviews', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('credit_note_line_id')->constrained('credit_note_lines')->restrictOnDelete();
            $table->string('outcome', 20);                    // attributed | not_applicable
            $table->uuid('source_line_id')->nullable();       // سطر الفاتورة عند attributed
            $table->text('reason');
            $table->foreignUuid('reviewed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('reviewed_at');
            $table->timestamps();

            // قرار واحد لكل سطر تاريخي.
            $table->unique(['tenant_id', 'credit_note_line_id'], 'cn_legacy_reviews_tenant_line_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('credit_note_legacy_reviews');
    }
};
