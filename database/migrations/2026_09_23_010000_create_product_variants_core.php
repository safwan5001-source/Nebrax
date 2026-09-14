<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * VAR-CORE-1 — Product Options / Option Values / Product Variant core identity
 * + unified Product/Variant SKU collision authority.
 *
 * ملاحظات معمارية:
 *  - `products.variant_state` ('simple'|'variant_managed') ليس في `$fillable`
 *    على النموذج عمداً — التحويل بينهما يمرّ حصراً عبر خدمة، لا إسناداً جماعياً.
 *  - `product_variants` بلا `SoftDeletes`: التعطيل (`is_active=false`) هو أداة
 *    «الحذف الناعم» المعتمدة هنا؛ حذف صفٍّ فعلياً مسموحٌ فقط لمتغيّر لا مرجع
 *    تاريخي له بعد (لا يوجد بعدُ أي مرجعٍ كهذا في نطاق VAR-CORE-1).
 *  - `sku_registry` توسيع لنمط `barcode_registry` القائم: قيدٌ فريد واحد
 *    `(tenant_id, sku)` يغطي المنتج والمتغيّر معاً فلا يتصادمان، ولا يعتمد على
 *    قيدين منفصلين لا يمنعان تصادماً عبر النوعين.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->string('variant_state', 20)->default('simple')->after('is_active');
        });

        Schema::create('product_options', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained()->cascadeOnDelete();
            $table->string('name', 255);
            $table->string('name_en', 255)->nullable();
            // مفتاح تطبيع (lower/trim) لمنع تكرار منطقي («اللون» و«اللون  ») لا
            // يمنعه تفرّدٌ حرفي على `name`. داخليٌّ فقط، لا يُعرض في أي واجهة.
            $table->string('name_key', 255);
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->unique(['product_id', 'name_key']);
            $table->index(['tenant_id', 'product_id']);
        });

        Schema::create('product_option_values', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('product_option_id')->constrained()->cascadeOnDelete();
            $table->string('value', 255);
            $table->string('value_en', 255)->nullable();
            $table->string('value_key', 255);
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->unique(['product_option_id', 'value_key']);
            $table->index(['tenant_id', 'product_option_id']);
        });

        Schema::create('product_variants', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained()->cascadeOnDelete();
            $table->string('sku', 255);
            // تمثيلٌ خادميّ حتميّ لهوية التركيبة: معرّفات قيم الخيارات مرتّبة
            // ومفصولة بفاصلة. مستقلٌّ تماماً عن ترتيب العرض أو الترجمة.
            $table->string('combination_key', 1000);
            $table->boolean('is_active')->default(true);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            // الحماية الحقيقية من ازدواج التركيبة تحت التزامن: لا فحص خدمةٍ وحده.
            $table->unique(['product_id', 'combination_key']);
            $table->index(['tenant_id', 'product_id']);
        });

        Schema::create('product_variant_option_values', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('product_variant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('product_option_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('product_option_value_id')->constrained('product_option_values')->restrictOnDelete();
            $table->timestamps();

            // مانعٌ حتميّ لاختيار قيمتين من الخيار نفسه على متغيّرٍ واحد.
            $table->unique(['product_variant_id', 'product_option_id']);
            $table->index(['tenant_id', 'product_option_value_id']);
        });

        Schema::create('sku_registry', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('sku', 255);
            $table->string('kind', 20); // 'product' | 'variant'
            $table->foreignUuid('product_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignUuid('product_variant_id')->nullable()->constrained()->cascadeOnDelete();
            $table->timestamps();

            // مرجع الحقيقة الوحيد لتفرّد SKU — يغطي المنتج والمتغيّر معاً.
            $table->unique(['tenant_id', 'sku']);
        });

        // تعبئة رجعية: كل SKU منتج قائم (بما فيه المحذوف ناعماً — هويته
        // التاريخية محمية أصلاً بقيد `products(tenant_id, sku)` القائم) يُسجَّل
        // في السجلّ الموحّد الجديد فيبقى الوضع القائم متسقاً معه من أول يوم.
        // **تعبئةٌ مشروطة لا شاملة** — بنفس نطاق `Product::sharesSkuNamespace()`
        // تماماً: منتجٌ بلا فرعٍ، أو مشترَك (`share_products=true`، الافتراض).
        // منتجٌ محذوفٌ ناعماً غير مُعبّأ أصلاً (هويته قابلة لإعادة الاستعمال
        // بالفعل حسب migration 000085)، ومنتجٌ فرعي غير مشترك يبقى خارج
        // الفهرس الموحّد فلا يكسر استقلال كتالوجات الفروع القائم اليوم.
        //
        // `insertOrIgnore` دفاعٌ أخير: الفهرس الجزئي الحالي على `products`
        // يسمح بتكرار SKU بين فرعين مختلفين **بصرف النظر عن قيمة الإعداد
        // الحالية** (الإعداد تحقّقٌ في طبقة الطلب فقط، لا قيد قاعدة بيانات) —
        // فتاريخٌ قديم مغيَّر الإعداد قد يترك تكراراً حقيقياً بين فرعين
        // «مشتركين» اليوم. أول صفٍّ يفوز بالتسجيل؛ البقية تبقى خارج السجلّ
        // الموحّد كما كانت قبل هذا العقد، بلا كسر تعبئة المعاملة.
        $shareProductsByTenant = DB::table('tenants')->pluck('settings', 'id')
            ->map(function ($settings) {
                $decoded = is_string($settings) ? json_decode($settings, true) : (array) $settings;

                return (bool) (($decoded['branches']['share_products'] ?? true));
            });

        DB::table('products')
            ->whereNotNull('sku')
            ->where('sku', '!=', '')
            ->whereNull('deleted_at')
            ->orderBy('id')
            ->select(['id', 'tenant_id', 'sku', 'branch_id'])
            ->chunkById(500, function ($rows) use ($shareProductsByTenant): void {
                $now = now();
                $insert = [];
                foreach ($rows as $row) {
                    $shares = $row->branch_id === null || (bool) ($shareProductsByTenant[$row->tenant_id] ?? true);
                    if (! $shares) {
                        continue;
                    }

                    $insert[] = [
                        'id' => (string) Illuminate\Support\Str::uuid(),
                        'tenant_id' => $row->tenant_id,
                        'sku' => $row->sku,
                        'kind' => 'product',
                        'product_id' => $row->id,
                        'product_variant_id' => null,
                        'created_at' => $now,
                        'updated_at' => $now,
                    ];
                }
                if ($insert !== []) {
                    DB::table('sku_registry')->insertOrIgnore($insert);
                }
            });
    }

    public function down(): void
    {
        Schema::dropIfExists('sku_registry');
        Schema::dropIfExists('product_variant_option_values');
        Schema::dropIfExists('product_variants');
        Schema::dropIfExists('product_option_values');
        Schema::dropIfExists('product_options');

        Schema::table('products', function (Blueprint $table) {
            $table->dropColumn('variant_state');
        });
    }
};
