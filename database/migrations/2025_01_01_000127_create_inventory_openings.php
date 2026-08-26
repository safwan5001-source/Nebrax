<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * ═══════════════════════════════════════════════════════════════
     *  الأرصدة الافتتاحية للمخزون — مستندٌ واحد لبدء الدفتر
     * ═══════════════════════════════════════════════════════════════
     *  الرصيد الافتتاحي ليس تسويةَ جرد ولا إذنَ إضافة: هو **نقطة الصفر** التي
     *  يبدأ منها المخزون الدائم. ولذلك يُسجَّل مستنداً مستقلاً قابلاً للتدقيق
     *  بعد الترحيل، لا صفّاً هامشياً في بطاقة المنتج.
     *
     *  **قيدٌ واحد للمستند كلّه** لا قيدٌ لكل صنف — كنمط الجرد والأذون:
     *    مدين  1140 المخزون
     *    دائن  3130 الأرصدة الافتتاحية
     *  بإجمالي المستند. وتفتيتُه إلى مئة قيد كان يُغرق كشف الأستاذ بلا فائدة،
     *  والتفصيل محفوظ في سطوره وفي حركات المخزون المرتبطة به.
     *
     *  ═══ لماذا الرأس بلا `branch_id`؟ ═══
     *  المستند الواحد قد يضمّ مخازن من فروع مختلفة، ومخزناً مركزياً بلا فرع.
     *  فوسمُه بفرعٍ واحد **ملكيةٌ كاذبة**: تُنسب أرصدةُ فرعٍ لفرعٍ آخر في كل
     *  تصفية بعدها. بُعد الفرع يعيش حيث يصحّ فعلاً:
     *   • على **حركة المخزون** — تُوسَم بفرع مخزنها (سلوك `applyReceipt` القائم).
     *   • على **سطور القيد** — تُجمَّع بفرع المخزن، فيحمل القيدُ الواحد أبعاداً
     *     صحيحة لكل فرع مع بقاء Σ مدين = Σ دائن.
     *  انظر: design-system/foundations/multi-branch-architecture.md
     */
    public function up(): void
    {
        Schema::create('inventory_openings', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();

            $table->string('number');                                   // OPN-2026-00001
            $table->date('opening_date');

            // draft: يُراجَع ويُحذف · posted: رُحِّل فصار حجّة لا تُعدَّل ولا تُحذف
            $table->enum('status', ['draft', 'posted'])->default('draft');
            $table->string('notes', 500)->nullable();
            // اسم الملف المرفوع — أثرٌ يربط المستند بمصدره عند المراجعة.
            $table->string('source_filename')->nullable();

            // موافقة «تكلفة الوحدة صفر» — **قرارٌ محفوظ لا حالةُ طلب**.
            // إدخال مخزونٍ بلا قيمة يقلب هامش الربح في كل تقرير بعده، فالموافقة
            // عليه يجب أن تُقرأ من المستند نفسه بعد شهر كما تُقرأ اليوم. وبقاؤها
            // في الطلب وحده كان يجعل مسودةً بلا موافقة تُرحَّل بموافقةٍ عابرة
            // لا أثر لها — أو لا تُرحَّل أصلاً بلا سبب ظاهر.
            $table->boolean('allow_zero_cost')->default(false);

            // إجماليات مُخزَّنة لا مشتقّة: لقطةُ ما رُحِّل فعلاً، وهي وجه المطابقة
            // مع 1140 ومع مجموع الحركات. اشتقاقُها لاحقاً كان يعيد حسابها من
            // سطورٍ قد تكون تغيّرت دلالتها.
            $table->bigInteger('total_quantity')->default(0);
            $table->bigInteger('total_value')->default(0);              // بالهللات

            $table->foreignUuid('journal_entry_id')->nullable()
                ->constrained('journal_entries')->nullOnDelete();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('posted_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('posted_at')->nullable();
            $table->timestamps();

            // مؤسسيّ لا فرعيّ: المستند `CompanyWide` فسلسلته للمؤسسة كلها.
            $table->unique(['tenant_id', 'number']);
            $table->index(['tenant_id', 'status', 'opening_date']);
        });

        Schema::create('inventory_opening_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('inventory_opening_id')->constrained()->cascadeOnDelete();

            $table->foreignUuid('product_id')->constrained('products')->restrictOnDelete();
            // المخزن إلزامي على **السطر** لا على الرأس: هو الذي يحمل بُعد الفرع،
            // وهو ما يجعل المستند الواحد قادراً على تغطية فروع متعددة بصدق.
            $table->foreignUuid('warehouse_id')->constrained('warehouses')->restrictOnDelete();

            $table->integer('quantity');
            $table->bigInteger('unit_cost');                            // بالهللات
            // القيمة مُخزَّنة عمداً (نمط `stock_permit_lines.line_cost`): هي بعينها
            // ما يُمرَّر إلى `applyReceipt` وما يُجمع للقيد، فبقاؤها مكتوبةً هو
            // الرابط الذي يثبت أن 1140 = مجموع الحركات هللةً بهللة.
            $table->bigInteger('total_cost');

            $table->string('notes', 500)->nullable();
            $table->unsignedInteger('position');                        // ترتيب السطر كما ورد في الملف
            $table->timestamps();

            $table->unique(['inventory_opening_id', 'position']);
            // التفرّد بالمنتج **والمخزن** معاً لا بالمنتج وحده: صنفٌ واحد قد
            // يفتتح رصيده في مخزنين، وهو الحال الطبيعي لمؤسسةٍ متعددة الفروع.
            // ولأن الرصيد الافتتاحي يُسجَّل مرّةً واحدة للمنتج (حارس الحركة
            // السابقة)، فمنعُ تكراره عبر المخازن كان سيجعل المستند عاجزاً عن
            // تمثيل واقعٍ صحيح. وتكرار المنتج نفسه في المخزن نفسه خطأ صفٍّ
            // يُرفض في المعاينة قبل أن يصل هنا.
            $table->unique(['inventory_opening_id', 'product_id', 'warehouse_id']);
            $table->index(['tenant_id', 'product_id']);
            $table->index(['tenant_id', 'warehouse_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('inventory_opening_lines');
        Schema::dropIfExists('inventory_openings');
    }
};
