<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\PurchaseLine;
use App\Models\UnitTemplateUnit;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  PR-UOM2-1 — وحدة البيع/الشراء الافتراضية للمنتج
 * ═══════════════════════════════════════════════════════════════
 *  أول مهمّة تنفيذية في Phase 2A. العقد:
 *  `docs/plans/products-inventory/phase-2-completion/MULTIPLE-UOM-BARCODE-DECOMPOSITION.md`
 *
 *  الافتراضي **عرضٌ فقط** (قرار المالك D-A): يُخزَّن ويُعاد في الـAPI للواجهة
 *  ونقطة البيع، ولا يقرؤه أي مسار مستندات. غياب الوحدة في السطر يبقى = وحدة
 *  الأساس حرفياً، فلا ينكسر أي توافق رجعي.
 *
 *  تشغيل: php artisan test --filter=ProductDefaultUnitsTest
 */
class ProductDefaultUnitsTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private function template(string $token, array $units = [['name' => 'كرتون', 'factor' => 12]], string $base = 'قطعة'): array
    {
        return $this->withToken($token)->postJson('/api/unit-templates', [
            'name' => 'قالب '.uniqid(), 'base_unit' => $base, 'units' => $units,
        ])->assertCreated()['data'];
    }

    private function product(string $token, array $overrides = []): array
    {
        return $this->withToken($token)->postJson('/api/products', array_merge([
            'name' => 'منتج', 'sku' => 'DU-'.uniqid(), 'type' => 'good',
            'unit' => 'piece', 'sale_price' => 10000,
        ], $overrides))->assertCreated()['data'];
    }

    private function update(string $token, array $product, array $change)
    {
        return $this->withToken($token)->putJson("/api/products/{$product['id']}", array_merge([
            'name' => $product['name'], 'type' => 'good', 'sale_price' => 10000,
        ], $change));
    }

    // ═══════════════════════════════════════════════════════════
    //  ١) القبول: وحدة الأساس أو بديلة معرّفة في القالب
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_default_unit_can_be_the_base_unit_or_a_template_alternate(): void
    {
        $auth = $this->registerTenant();
        $template = $this->template($auth['token']);

        $product = $this->product($auth['token'], [
            'unit_template_id' => $template['id'],
            'default_sales_unit' => 'كرتون',    // وحدة بديلة
            'default_purchase_unit' => 'قطعة',  // وحدة الأساس
        ]);

        $this->assertSame('كرتون', $product['default_sales_unit'], 'الـAPI يعيد الافتراضي.');
        $this->assertSame('قطعة', $product['default_purchase_unit']);

        $stored = Product::findOrFail($product['id']);
        $this->assertSame('كرتون', $stored->default_sales_unit);
        $this->assertSame('قطعة', $stored->default_purchase_unit);
    }

    /** غيابه أو تصريحه فارغاً = وحدة الأساس — الافتراض القائم، ويُقبل دائماً. */
    /** @test */
    public function an_absent_or_null_default_is_accepted_and_means_the_base_unit(): void
    {
        $auth = $this->registerTenant();
        $template = $this->template($auth['token']);

        $omitted = $this->product($auth['token'], ['unit_template_id' => $template['id']]);
        $this->assertNull($omitted['default_sales_unit']);
        $this->assertNull($omitted['default_purchase_unit']);

        $explicitNull = $this->product($auth['token'], [
            'unit_template_id' => $template['id'],
            'default_sales_unit' => null,
            'default_purchase_unit' => null,
        ]);
        $this->assertNull($explicitNull['default_sales_unit']);
    }

    // ═══════════════════════════════════════════════════════════
    //  ٢) الرفض المغلق: لا افتراض بديل لوحدة مجهولة
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function an_unknown_default_unit_is_rejected_fail_closed_on_create(): void
    {
        $auth = $this->registerTenant();
        $template = $this->template($auth['token']);
        $before = Product::count();

        $this->withToken($auth['token'])->postJson('/api/products', [
            'name' => 'منتج', 'sku' => 'DU-'.uniqid(), 'type' => 'good', 'sale_price' => 10000,
            'unit_template_id' => $template['id'], 'default_sales_unit' => 'طبلية',
        ])->assertStatus(422);

        $this->assertSame($before, Product::count(), 'لا منتج كُتب رغم الرفض.');
    }

    /** @test */
    public function an_unknown_default_unit_is_rejected_on_update_leaving_the_stored_value(): void
    {
        $auth = $this->registerTenant();
        $template = $this->template($auth['token']);
        $product = $this->product($auth['token'], [
            'unit_template_id' => $template['id'], 'default_sales_unit' => 'كرتون',
        ]);

        $this->update($auth['token'], $product, ['default_sales_unit' => 'صندوق'])->assertStatus(422);

        $this->assertSame('كرتون', Product::findOrFail($product['id'])->default_sales_unit, 'القيمة المخزَّنة لم تُمَسّ.');
    }

    /**
     * التعديل الجزئي لا يحمل `unit_template_id`، فلولا قراءة القالب **القائم**
     * على المنتج لمرّت أي وحدة افتراضية في كل تعديلٍ لا يذكر القالب.
     */
    /** @test */
    public function a_partial_update_without_the_template_id_still_validates_against_the_stored_template(): void
    {
        $auth = $this->registerTenant();
        $template = $this->template($auth['token']);
        $product = $this->product($auth['token'], ['unit_template_id' => $template['id']]);

        // لا `unit_template_id` في الحمولة إطلاقاً.
        $this->update($auth['token'], $product, ['default_purchase_unit' => 'وحدة مخترعة'])->assertStatus(422);
        $this->assertNull(Product::findOrFail($product['id'])->default_purchase_unit);

        // وبنفس الحمولة، اسمٌ صحيح يمرّ.
        $this->update($auth['token'], $product, ['default_purchase_unit' => 'كرتون'])->assertOk();
        $this->assertSame('كرتون', Product::findOrFail($product['id'])->default_purchase_unit);
    }

    /** منتجٌ بلا قالب لا وحدات بديلة له: وحدته الأساسية وحدها مقبولة. */
    /** @test */
    public function a_product_without_a_template_accepts_only_its_own_base_unit(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])->postJson('/api/products', [
            'name' => 'بلا قالب', 'sku' => 'DU-'.uniqid(), 'type' => 'good',
            'unit' => 'piece', 'sale_price' => 10000, 'default_sales_unit' => 'كرتون',
        ])->assertStatus(422);

        $ok = $this->product($auth['token'], ['unit' => 'piece', 'default_sales_unit' => 'piece']);
        $this->assertSame('piece', $ok['default_sales_unit']);
    }

    /** وحدة قالبٍ يخصّ مستأجراً آخر لا تُصادق على افتراضي هنا إطلاقاً. */
    /** @test */
    public function a_unit_from_another_tenants_template_never_validates_here(): void
    {
        $mine = $this->registerTenant('acme', 'a@acme.test');
        $theirs = $this->registerTenant('other', 'b@other.test');

        $theirTemplate = $this->template($theirs['token'], [['name' => 'برميل', 'factor' => 200]], 'لتر');
        $myTemplate = $this->template($mine['token']);

        // «برميل» موجودة عندهم لا عندي.
        $this->withToken($mine['token'])->postJson('/api/products', [
            'name' => 'منتجي', 'sku' => 'DU-'.uniqid(), 'type' => 'good', 'sale_price' => 10000,
            'unit_template_id' => $myTemplate['id'], 'default_sales_unit' => 'برميل',
        ])->assertStatus(422);

        // ولا يُقبل قالبهم نفسه أصلاً (عزل المستأجر القائم).
        $this->withToken($mine['token'])->postJson('/api/products', [
            'name' => 'منتجي', 'sku' => 'DU-'.uniqid(), 'type' => 'good', 'sale_price' => 10000,
            'unit_template_id' => $theirTemplate['id'], 'default_sales_unit' => 'برميل',
        ])->assertStatus(422);
    }

    // ═══════════════════════════════════════════════════════════
    //  ٣) التوافق الرجعي: لا مسار مستندات يقرأ الافتراضي (قرار D-A)
    // ═══════════════════════════════════════════════════════════

    /**
     * أهمّ اختبار في هذه المهمّة: سطرٌ بلا وحدة على منتجٍ له وحدة بيع افتراضية
     * «كرتون» (معامل ١٢) يبقى يُحَلّ إلى **وحدة الأساس بمعامل ١**. لو قرأ مسار
     * المستندات الافتراضي لصارت الكمية ١٢ ضعفاً صامتاً.
     */
    /** @test */
    public function a_line_without_a_unit_still_resolves_to_the_base_unit_not_the_default(): void
    {
        $auth = $this->registerTenant();
        $supplierId = $this->withToken($auth['token'])
            ->postJson('/api/partners', ['name' => 'مورد', 'type' => 'supplier'])->assertCreated()['data']['id'];
        $template = $this->template($auth['token']);
        $product = $this->product($auth['token'], [
            'unit_template_id' => $template['id'],
            'default_sales_unit' => 'كرتون',
            'default_purchase_unit' => 'كرتون',
            'track_inventory' => true,
        ]);

        $purchase = $this->withToken($auth['token'])->postJson('/api/purchases', [
            'partner_id' => $supplierId, 'payment_type' => 'credit',
            'items' => [['product_id' => $product['id'], 'quantity' => 5, 'unit_price' => 1000, 'tax_rate' => 0]],
        ])->assertCreated()['data'];

        $line = PurchaseLine::where('purchase_id', $purchase['id'])->firstOrFail();
        $this->assertNull($line->unit_name, 'السطر بلا وحدة — لم يلتقط الافتراضي.');
        $this->assertSame(1, (int) $line->unit_factor, 'المعامل ١ لا ١٢.');
        $this->assertSame(5, $line->baseQuantity(), 'الكمية الأساسية ٥ لا ٦٠ — `baseQuantity()` مشتقّة لا عمود.');
    }

    /** وتحديد وحدة صراحةً يبقى يعمل كما كان — الافتراضي لا يعترض المسار. */
    /** @test */
    public function an_explicit_unit_on_a_line_keeps_working_unchanged(): void
    {
        $auth = $this->registerTenant();
        $supplierId = $this->withToken($auth['token'])
            ->postJson('/api/partners', ['name' => 'مورد', 'type' => 'supplier'])->assertCreated()['data']['id'];
        $template = $this->template($auth['token']);
        $product = $this->product($auth['token'], [
            'unit_template_id' => $template['id'], 'default_sales_unit' => 'قطعة', 'track_inventory' => true,
        ]);

        $purchase = $this->withToken($auth['token'])->postJson('/api/purchases', [
            'partner_id' => $supplierId, 'payment_type' => 'credit',
            'items' => [['product_id' => $product['id'], 'quantity' => 2, 'unit_price' => 1000, 'unit' => 'كرتون', 'tax_rate' => 0]],
        ])->assertCreated()['data'];

        $line = PurchaseLine::where('purchase_id', $purchase['id'])->firstOrFail();
        $this->assertSame('كرتون', $line->unit_name);
        $this->assertSame(12, (int) $line->unit_factor);
        $this->assertSame(24, $line->baseQuantity(), 'الوحدة الصريحة وحدها تحكم: ٢ × ١٢.');
    }

    /** ولا اشتقاق سعرٍ من المعامل: السعر المُدخَل يبقى كما هو. */
    /** @test */
    public function the_default_unit_never_derives_or_changes_a_price(): void
    {
        $auth = $this->registerTenant();
        $template = $this->template($auth['token']);
        $product = $this->product($auth['token'], [
            'unit_template_id' => $template['id'], 'default_sales_unit' => 'كرتون', 'sale_price' => 10000,
        ]);

        $this->assertSame('100.00', $product['sale_price'], 'السعر ١٠٠٫٠٠ ريال كما أُدخل — لا ÷١٢ ولا ×١٢.');
    }

    // ═══════════════════════════════════════════════════════════
    //  ٤) مرجعٌ حيّ تحت حارس PR-UOM-1
    // ═══════════════════════════════════════════════════════════

    /** حذف وحدةٍ يستعملها افتراضيُّ منتج يُرفض — لا مرجع بائت صامت. */
    /** @test */
    public function removing_a_unit_used_as_a_default_is_rejected_by_the_template_guard(): void
    {
        $auth = $this->registerTenant();
        $template = $this->template($auth['token']);
        $this->product($auth['token'], [
            'unit_template_id' => $template['id'], 'default_sales_unit' => 'كرتون',
        ]);

        // إعادة الإرسال بلا «كرتون» = حذفها.
        $this->withToken($auth['token'])->putJson("/api/unit-templates/{$template['id']}", [
            'name' => $template['name'], 'base_unit' => 'قطعة', 'units' => [],
        ])->assertStatus(422);

        $this->assertNotNull(
            UnitTemplateUnit::where('unit_template_id', $template['id'])->where('name', 'كرتون')->first(),
            'الوحدة لم تُحذف.'
        );
    }

    /** وتغيير وحدة الأساس التي يستعملها افتراضيُّ شراء يُرفض كذلك. */
    /** @test */
    public function rebasing_a_template_whose_base_unit_is_a_default_is_rejected(): void
    {
        $auth = $this->registerTenant();
        $template = $this->template($auth['token']);
        $this->product($auth['token'], [
            'unit_template_id' => $template['id'], 'default_purchase_unit' => 'قطعة', // = وحدة الأساس
        ]);

        $this->withToken($auth['token'])->putJson("/api/unit-templates/{$template['id']}", [
            'name' => $template['name'], 'base_unit' => 'حبة', 'units' => [['name' => 'كرتون', 'factor' => 12]],
        ])->assertStatus(422);
    }

    /** وإضافة وحدة جديدة تبقى آمنة رغم وجود افتراضيّ على وحدة أخرى. */
    /** @test */
    public function adding_a_new_unit_remains_allowed_despite_an_existing_default(): void
    {
        $auth = $this->registerTenant();
        $template = $this->template($auth['token']);
        $this->product($auth['token'], [
            'unit_template_id' => $template['id'], 'default_sales_unit' => 'كرتون',
        ]);

        $this->withToken($auth['token'])->putJson("/api/unit-templates/{$template['id']}", [
            'name' => $template['name'], 'base_unit' => 'قطعة',
            'units' => [['name' => 'كرتون', 'factor' => 12], ['name' => 'طبلية', 'factor' => 144]],
        ])->assertOk();

        $this->assertNotNull(UnitTemplateUnit::where('unit_template_id', $template['id'])->where('name', 'طبلية')->first());
    }

    /**
     * منتجٌ في فرعٍ آخر يستعمل الوحدة كافتراضيّ يجب أن يمنع التعديل كذلك —
     * الفرع النشط لا يُخفي مرجعاً حيّاً (نفس ضمانة PR-UOM-1/PR-PROD-LIFE-1).
     */
    /** @test */
    public function a_default_on_a_product_in_another_branch_still_blocks_the_edit(): void
    {
        $auth = $this->registerTenant();
        $template = $this->template($auth['token']);
        $branch = $this->withToken($auth['token'])
            ->postJson('/api/branches', ['name' => 'فرع ثانٍ', 'code' => 'BR-2'])
            ->assertCreated()['data'];

        // منتج يُنشأ داخل الفرع الثاني.
        $this->withToken($auth['token'])
            ->withHeader('X-Branch-Id', $branch['id'])
            ->postJson('/api/products', [
                'name' => 'منتج الفرع الثاني', 'sku' => 'DU-'.uniqid(), 'type' => 'good', 'sale_price' => 10000,
                'unit_template_id' => $template['id'], 'default_sales_unit' => 'كرتون',
            ])->assertCreated();

        // التعديل يُطلب من الفرع الرئيسي، والمرجع في الفرع الثاني — ويُمنع.
        $this->withToken($auth['token'])->putJson("/api/unit-templates/{$template['id']}", [
            'name' => $template['name'], 'base_unit' => 'قطعة', 'units' => [],
        ])->assertStatus(422);
    }
}
