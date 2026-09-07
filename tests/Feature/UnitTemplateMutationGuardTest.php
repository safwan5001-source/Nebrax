<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\UnitTemplateUnit;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  PR-UOM-1 — قوالب الوحدات: العقد ١ (Product.unit) وحماية المراجع الحيّة
 * ═══════════════════════════════════════════════════════════════
 *  يكمل `UnitTemplateTest.php` (الذي يغطي رفض تغيير المعامل بعد أثرٍ
 *  مخزني) بثلاثة أمور لم تكن مغطاة: مزامنة `Product.unit` مع تغيير وحدة
 *  الأساس **قبل** وجود أثر، رفض تغيير وحدة الأساس أو حذف/تسمية وحدة قائمة
 *  تستعملها مراجع حيّة (باركود بديل/بند قائمة أسعار) حتى بلا أي أثر مخزني،
 *  وعزل الفحص عن منتجات/قوالب أخرى غير معنيّة.
 *
 *  تشغيل: php artisan test --filter=UnitTemplateMutationGuardTest
 */
class UnitTemplateMutationGuardTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private function template(string $token, array $units = [['name' => 'طبلية', 'factor' => 50]], string $base = 'كيس'): array
    {
        return $this->withToken($token)->postJson('/api/unit-templates', [
            'name' => 'قالب '.uniqid(), 'base_unit' => $base, 'units' => $units,
        ])->assertCreated()['data'];
    }

    private function product(string $token, string $templateId, array $overrides = []): array
    {
        return $this->withToken($token)->postJson('/api/products', array_merge([
            'name' => 'منتج', 'sku' => 'UTG-'.uniqid(), 'type' => 'good',
            'unit' => 'piece', 'sale_price' => 10000,
            'unit_template_id' => $templateId,
        ], $overrides))->assertCreated()['data'];
    }

    // ═══════════════════════════════════════════════════════════
    //  invariant 1: Product.unit === UnitTemplate.base_unit — always
    // ═══════════════════════════════════════════════════════════

    /** تغيير وحدة الأساس **قبل** وجود أي أثر مخزني يُزامَن فوراً على كل منتجٍ يستعمل القالب. */
    /** @test */
    public function changing_the_base_unit_before_any_footprint_syncs_product_unit_immediately(): void
    {
        $auth = $this->registerTenant();
        $template = $this->template($auth['token']);
        $product = $this->product($auth['token'], $template['id']);
        $this->assertSame('كيس', Product::findOrFail($product['id'])->unit);

        $this->withToken($auth['token'])->putJson("/api/unit-templates/{$template['id']}", [
            'name' => $template['name'], 'base_unit' => 'وحدة', 'units' => [['name' => 'طبلية', 'factor' => 50]],
        ])->assertOk();

        $this->assertSame('وحدة', Product::findOrFail($product['id'])->unit, 'العقد ١ يبقى صحيحاً بعد تغيير الأساس الآمن.');
    }

    /** تغيير وحدة الأساس بعد أثرٍ مخزني يُرفض بالكامل — Fail Closed لا مزامنة صامتة. */
    /** @test */
    public function changing_the_base_unit_after_a_footprint_is_rejected(): void
    {
        $auth = $this->registerTenant();
        $supplierId = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'مورد', 'type' => 'supplier'])->assertCreated()['data']['id'];
        $template = $this->template($auth['token']);
        $product = $this->product($auth['token'], $template['id'], ['track_inventory' => true]);

        $purchase = $this->withToken($auth['token'])->postJson('/api/purchases', [
            'partner_id' => $supplierId, 'payment_type' => 'credit',
            'items' => [['product_id' => $product['id'], 'quantity' => 1, 'unit_price' => 1000, 'tax_rate' => 0]],
        ])->assertCreated()['data'];
        $this->withToken($auth['token'])->postJson("/api/purchases/{$purchase['id']}/post")->assertOk();

        $this->withToken($auth['token'])->putJson("/api/unit-templates/{$template['id']}", [
            'name' => $template['name'], 'base_unit' => 'وحدة', 'units' => [['name' => 'طبلية', 'factor' => 50]],
        ])->assertStatus(422);

        $this->assertSame('كيس', Product::findOrFail($product['id'])->unit, 'لم تُمَسّ — لا مزامنة على تعديل مرفوض.');
    }

    // ═══════════════════════════════════════════════════════════
    //  live references fail closed, even with zero inventory footprint
    // ═══════════════════════════════════════════════════════════

    /** حذف/إعادة تسمية وحدة يستعملها باركودٌ بديل حيّ يُرفض — بلا أي أثر مخزني إطلاقاً. */
    /** @test */
    public function removing_a_unit_used_by_a_live_alternate_barcode_is_rejected_with_zero_footprint(): void
    {
        $auth = $this->registerTenant();
        $template = $this->template($auth['token']);
        $product = $this->product($auth['token'], $template['id']);
        $this->withToken($auth['token'])
            ->postJson("/api/products/{$product['id']}/barcodes", ['code' => 'PALLET-BC', 'unit_name' => 'طبلية'])
            ->assertCreated();

        // إعادة الإرسال بلا «طبلية» = حذفها من القالب.
        $this->withToken($auth['token'])->putJson("/api/unit-templates/{$template['id']}", [
            'name' => $template['name'], 'base_unit' => 'كيس', 'units' => [],
        ])->assertStatus(422);

        $this->assertNotNull(UnitTemplateUnit::where('unit_template_id', $template['id'])->where('name', 'طبلية')->first(), 'الوحدة لم تُحذف.');
    }

    /** وتغيير معاملها كذلك يُرفض لنفس السبب — لا حذف ولا تعديل، فقط إضافة آمنة. */
    /** @test */
    public function changing_the_factor_of_a_unit_used_by_a_live_price_list_item_is_rejected(): void
    {
        $auth = $this->registerTenant();
        $template = $this->template($auth['token']);
        $product = $this->product($auth['token'], $template['id']);
        $priceList = $this->withToken($auth['token'])->postJson('/api/price-lists', ['name' => 'قائمة الجملة'])->assertCreated()['data'];
        $this->withToken($auth['token'])->postJson("/api/price-lists/{$priceList['id']}/items", [
            'product_id' => $product['id'], 'unit_name' => 'طبلية', 'price' => 45000,
        ])->assertCreated();

        $this->withToken($auth['token'])->putJson("/api/unit-templates/{$template['id']}", [
            'name' => $template['name'], 'base_unit' => 'كيس', 'units' => [['name' => 'طبلية', 'factor' => 40]],
        ])->assertStatus(422);

        $this->assertSame(50, UnitTemplateUnit::where('unit_template_id', $template['id'])->where('name', 'طبلية')->value('factor'));
    }

    /** إضافة وحدة جديدة بلا تعارض تبقى آمنة رغم وجود مراجع حيّة على وحدة أخرى. */
    /** @test */
    public function adding_a_new_unit_remains_allowed_despite_a_live_reference_on_another_unit(): void
    {
        $auth = $this->registerTenant();
        $template = $this->template($auth['token']);
        $product = $this->product($auth['token'], $template['id']);
        $this->withToken($auth['token'])
            ->postJson("/api/products/{$product['id']}/barcodes", ['code' => 'PALLET-BC-2', 'unit_name' => 'طبلية'])
            ->assertCreated();

        $this->withToken($auth['token'])->putJson("/api/unit-templates/{$template['id']}", [
            'name' => $template['name'], 'base_unit' => 'كيس',
            'units' => [['name' => 'طبلية', 'factor' => 50], ['name' => 'كرتون', 'factor' => 12]],
        ])->assertOk();

        $this->assertNotNull(UnitTemplateUnit::where('unit_template_id', $template['id'])->where('name', 'كرتون')->first());
    }

    // ═══════════════════════════════════════════════════════════
    //  the guard is scoped — unrelated templates/products are never touched
    // ═══════════════════════════════════════════════════════════

    /** أثرٌ مخزني على منتجٍ يستعمل قالباً آخر لا يمنع تعديل هذا القالب. */
    /** @test */
    public function a_footprint_on_a_product_using_a_different_template_does_not_block_this_edit(): void
    {
        $auth = $this->registerTenant();
        $supplierId = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'مورد', 'type' => 'supplier'])->assertCreated()['data']['id'];

        $usedTemplate = $this->template($auth['token'], [['name' => 'صندوق', 'factor' => 20]], 'قطعة');
        $usedProduct = $this->product($auth['token'], $usedTemplate['id'], ['track_inventory' => true]);
        $purchase = $this->withToken($auth['token'])->postJson('/api/purchases', [
            'partner_id' => $supplierId, 'payment_type' => 'credit',
            'items' => [['product_id' => $usedProduct['id'], 'quantity' => 1, 'unit_price' => 1000, 'tax_rate' => 0]],
        ])->assertCreated()['data'];
        $this->withToken($auth['token'])->postJson("/api/purchases/{$purchase['id']}/post")->assertOk();

        $freeTemplate = $this->template($auth['token'], [['name' => 'طبلية', 'factor' => 50]]);
        $this->product($auth['token'], $freeTemplate['id']); // بلا أي شراء أو أثر

        $this->withToken($auth['token'])->putJson("/api/unit-templates/{$freeTemplate['id']}", [
            'name' => $freeTemplate['name'], 'base_unit' => 'كيس', 'units' => [['name' => 'طبلية', 'factor' => 40]],
        ])->assertOk('قالبٌ آخر لا صلة له — التعديل يجب أن يمرّ.');
    }

    // ═══════════════════════════════════════════════════════════
    //  no money derivation from a UOM factor (contract's explicit test)
    // ═══════════════════════════════════════════════════════════

    /** المعامل يضرب الكمية فقط — السعر المُدخَل يبقى كما هو بلا أي تحويل. */
    /** @test */
    public function the_conversion_factor_never_derives_or_changes_a_price(): void
    {
        $auth = $this->registerTenant();
        $supplierId = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'مورد', 'type' => 'supplier'])->assertCreated()['data']['id'];
        $template = $this->template($auth['token'], [['name' => 'طبلية', 'factor' => 50]]);
        $product = $this->product($auth['token'], $template['id']);

        $purchase = $this->withToken($auth['token'])->postJson('/api/purchases', [
            'partner_id' => $supplierId, 'payment_type' => 'credit',
            'items' => [['product_id' => $product['id'], 'quantity' => 2, 'unit_price' => 50000, 'unit' => 'طبلية', 'tax_rate' => 0]],
        ])->assertCreated()['data'];

        $line = $purchase['lines'][0];
        // السعر المُخزَّن هو ما أُدخل بالضبط — ٥٠٠٫٠٠ ريال — لا ٥٠٠٫٠٠ ÷ ٥٠ ولا × ٥٠.
        $this->assertSame('500.00', $line['unit_price']);
        $this->assertSame('1000.00', $line['line_subtotal'], 'الإجمالي = ٢ × ٥٠٠٫٠٠ بوحدة السطر، لا بوحدة المخزون.');
    }
}
