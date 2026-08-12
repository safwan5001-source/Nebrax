<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * ═══════════════════════════════════════════════════════════════
     *  قوالب الوحدات — الشراء والبيع بوحدة غير وحدة المخزون
     * ═══════════════════════════════════════════════════════════════
     *  يُشترى الإسمنت بالطبلية ويُباع بالكيس. اليوم `products.unit` نصٌّ واحد،
     *  فيضطر المستخدم إلى ضرب الكميات بيده — وكل ضربة يدوية خطأ محتمل في
     *  المخزون وفي تكلفة البضاعة المباعة.
     *
     *  ── **العقد الحاسم: النقود لا تُحوَّل، الكمية وحدها تُحوَّل.**
     *
     *  السطر يحفظ الكمية **بالوحدة المُدخَلة** وسعرها بها، فيبقى
     *  `line_subtotal = quantity × unit_price` صحيحاً بالضبط بلا كسر. ولو
     *  حُوِّل السعر إلى وحدة الأساس لضاعت الهللات: ١٠٠ ريال للطبلية على ٣
     *  أكياس = ٣٣٣٣٫٣٣ هللة — عددٌ غير صحيح، وكل قيد بعده مائل.
     *
     *  فالتحويل يقع في **المخزون وحده**: `الكمية الأساس = الكمية × المعامل`.
     *  ولا يتغيّر بذلك أي مبلغ في أي قيد.
     *
     *  ── **`unit_factor` افتراضه ١** على كل سطر قائم وكل سطر لا يحدّد وحدة،
     *  فالكمية الأساس تساوي الكمية: **صفر تغيير سلوك** على كل ما بُني قبله.
     */
    public function up(): void
    {
        Schema::create('unit_templates', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->string('name');                        // «وحدات الإسمنت»
            $table->string('base_unit');                   // وحدة المخزون: «كيس»
            $table->boolean('is_active')->default(true);
            $table->timestamps();
            $table->softDeletes();

            $table->index(['tenant_id', 'is_active']);
        });

        /**
         * الوحدات البديلة. وحدة الأساس **ليست صفّاً هنا**: هي `base_unit` على
         * القالب بمعامل ١ ضمناً. تكرارها صفّاً كان يسمح بمعاملَين للأساس.
         *
         * `factor` عدد صحيح ≥ ١ — كم وحدة أساس في الوحدة الواحدة. ولا كسور:
         * وحدةٌ أصغر من الأساس تُعالَج باختيار الأصغر أساساً، لا بمعامل عشري
         * يُدخل الفاصلة إلى حساب كمية هي عدد صحيح في كل النظام.
         */
        Schema::create('unit_template_units', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('unit_template_id')->constrained()->cascadeOnDelete();
            $table->string('name');                        // «طبلية»
            $table->unsignedInteger('factor');             // ٥٠ كيساً
            $table->timestamps();

            $table->index(['tenant_id', 'unit_template_id']);
        });

        Schema::table('products', function (Blueprint $table) {
            $table->foreignUuid('unit_template_id')->nullable()->after('unit')
                ->constrained('unit_templates')->nullOnDelete();
        });

        // لقطة الوحدة على السطر: **تُنسَخ ولا تُشار**. تعديل القالب لاحقاً يجب
        // ألّا يعيد تفسير مستندٍ مرحَّل — الأثر الرجعي يقتضي أن يبقى السطر
        // شاهداً على ما كان وقت الترحيل.
        foreach (['invoice_lines', 'purchase_lines'] as $table) {
            Schema::table($table, function (Blueprint $t) {
                $t->string('unit_name')->nullable()->after('quantity');
                $t->unsignedInteger('unit_factor')->default(1)->after('unit_name');
            });
        }
    }

    public function down(): void
    {
        foreach (['invoice_lines', 'purchase_lines'] as $table) {
            Schema::table($table, function (Blueprint $t) {
                $t->dropColumn(['unit_name', 'unit_factor']);
            });
        }

        Schema::table('products', function (Blueprint $table) {
            $table->dropConstrainedForeignId('unit_template_id');
        });

        Schema::dropIfExists('unit_template_units');
        Schema::dropIfExists('unit_templates');
    }
};
