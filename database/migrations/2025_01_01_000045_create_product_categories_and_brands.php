<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    /**
     * ═══════════════════════════════════════════════════════════════
     *  تصنيفات المنتجات والعلامات التجارية — من نصٍّ حرّ إلى قائمة مُدارة
     * ═══════════════════════════════════════════════════════════════
     *  `products.category` و`products.brand` نصّان حرّان اليوم: «إسمنت» و
     *  «اسمنت» و«الإسمنت» ثلاثة تصنيفات في التقارير، ولا سبيل لإعادة تسمية
     *  ولا لتجميع متعدّد المستويات.
     *
     *  فيصيران كيانَين مُدارَين، ويُملأان من **القيم القائمة فعلاً** لكل
     *  مستأجر: من فتح الشاشة بعد الترقية وجد تصنيفاته كما كتبها لا قائمة
     *  فارغة — الترقية لا تُفقد أحداً بياناته ولا تطلب منه إعادة إدخالها.
     *
     *  العمودان النصّيان **يبقيان** في المخطّط: لا يُكتبان بعد اليوم، ويظلّان
     *  احتياطياً لعرض منتجٍ لم يُربط بتصنيف. حذفهما كان سيكسر أي مستهلك قائم
     *  للـ API بلا مكسب.
     */
    public function up(): void
    {
        Schema::create('product_categories', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->uuid('parent_id')->nullable();      // القيد أدناه — انظر التعليق
            $table->string('name');
            $table->boolean('is_active')->default(true);
            $table->timestamps();
            $table->softDeletes();

            $table->index(['tenant_id', 'parent_id']);
            $table->index(['tenant_id', 'is_active']);
        });

        // المفتاح الذاتي في `Schema::table` منفصلاً: `constrained()` داخل
        // `create` يدفع أمر المفتاح **قبل** إنشاء المفتاح الأساسي، فيفشل على
        // PostgreSQL بـ «no unique constraint matching given keys» ويمرّ على
        // SQLite صامتاً. حذفُ الأب يُيتّم أبناءه (`nullOnDelete`) ولا يمحوهم.
        Schema::table('product_categories', function (Blueprint $table) {
            $table->foreign('parent_id')->references('id')->on('product_categories')->nullOnDelete();
        });

        Schema::create('brands', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->string('name');
            $table->boolean('is_active')->default(true);
            $table->timestamps();
            $table->softDeletes();

            $table->index(['tenant_id', 'is_active']);
        });

        // الربط على المنتج — إضافة غير كاسرة، القيم القائمة `null` حتى الملء.
        Schema::table('products', function (Blueprint $table) {
            $table->foreignUuid('category_id')->nullable()->after('category')
                ->constrained('product_categories')->nullOnDelete();
            $table->foreignUuid('brand_id')->nullable()->after('brand')
                ->constrained('brands')->nullOnDelete();
        });

        $this->backfillAll();
    }

    /**
     * عامّة ليستدعيها الاختبار مباشرةً: `migrate --path` لا يُجدي على هجرة
     * سُجّلت أصلاً — يتخطّاها الـ migrator صامتاً، فيمرّ اختبارٌ لم يُشغّل ما
     * يدّعي اختباره.
     */
    public function backfillAll(): void
    {
        $this->backfill('category', 'product_categories', 'category_id');
        $this->backfill('brand', 'brands', 'brand_id');
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->dropConstrainedForeignId('category_id');
            $table->dropConstrainedForeignId('brand_id');
        });

        Schema::dropIfExists('brands');
        Schema::dropIfExists('product_categories');
    }

    /**
     * يبني القائمة من القيم القائمة ويربط المنتجات بها — لكل مستأجر على حدة،
     * فلا تتسرّب تسمية مستأجر إلى آخر.
     *
     * التصنيفات المُنشأة هنا كلّها جذور (`parent_id = null`): النصّ الحرّ لا
     * يحمل تسلسلاً، واستنتاجه من فاصلة أو شرطة تخمينٌ على بيانات إنتاج. من
     * أراد التسلسل بناه من الشاشة بعد أن يرى تصنيفاته أمامه.
     */
    private function backfill(string $column, string $table, string $foreignKey): void
    {
        $rows = DB::table('products')
            ->select('tenant_id', 'branch_id', $column)
            ->whereNotNull($column)
            ->where($column, '!=', '')
            ->distinct()
            ->get();

        foreach ($rows as $row) {
            $name = trim((string) $row->{$column});
            if ($name === '') {
                continue;
            }

            // نفس الاسم من فرعين لا يُنشئ صفّين: القائمة على مستوى المستأجر.
            $existing = DB::table($table)
                ->where('tenant_id', $row->tenant_id)
                ->where('name', $name)
                ->value('id');

            $id = $existing ?? (string) Str::uuid();

            if (! $existing) {
                DB::table($table)->insert([
                    'id'         => $id,
                    'tenant_id'  => $row->tenant_id,
                    'branch_id'  => $row->branch_id,
                    'name'       => $name,
                    'is_active'  => true,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }

            DB::table('products')
                ->where('tenant_id', $row->tenant_id)
                ->where($column, $row->{$column})
                ->update([$foreignKey => $id]);
        }
    }
};
