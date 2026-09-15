<?php

namespace Tests\Feature;

use App\Models\PriceList;
use App\Models\PriceListItem;
use App\Models\Product;
use App\Models\ProductBarcode;
use App\Models\ProductUnitPrice;
use App\Models\ProductVariant;
use App\Models\Tenant;
use App\Models\UnitTemplate;
use App\Services\Accounting\PosCustomerPriceListResolver;
use App\Services\PriceListService;
use App\Services\ProductVariantService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  VAR-PRICE-UX-1 — أسعار وحدة القياس + الباركود المتعدد (GAP-02/GAP-03)
 * ═══════════════════════════════════════════════════════════════
 *  يغطّي مسار HTTP الحقيقي فقط (لا اختبار خدمةٍ مباشر — `ProductUnitPriceTest`
 *  يغطّي `ProductPricingService` نفسها من VAR-PRICE-1، و`ProductBarcodeAndMediaTest`
 *  يغطّي الباركود الأساسي). يثبت أن الطبقة الجديدة HTTP-فقط: لا منطق تسعيرٍ
 *  جديد، لا سلطة باركود-سعر منافسة، ولا تراجعٌ مُشتَقٌّ من المعامل.
 */
class ProductUnitPriceMultipleBarcodeHttpTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function product(string $token, array $overrides = []): array
    {
        return $this->withToken($token)->postJson('/api/products', array_merge([
            'name' => 'منتج', 'sku' => 'UX-'.uniqid(), 'type' => 'good', 'unit' => 'piece', 'sale_price' => 500,
        ], $overrides))->assertCreated()['data'];
    }

    /** قالب وحدات: باكيت ×6، كرتون ×12 — فوق وحدة الأساس «حبة». */
    private function withPackAndCartonUnits(string $token, string $tenantId, string $productId): void
    {
        app(TenantContext::class)->set($tenantId);
        $template = UnitTemplate::create(['tenant_id' => $tenantId, 'name' => 'قالب '.uniqid(), 'base_unit' => 'piece']);
        $template->units()->create(['tenant_id' => $tenantId, 'name' => 'pack', 'factor' => 6]);
        $template->units()->create(['tenant_id' => $tenantId, 'name' => 'carton', 'factor' => 12]);
        Product::whereKey($productId)->update(['unit_template_id' => $template->id]);
    }

    /** منتجٌ متعدد الخيارات بمتغيّرين: أسود وأبيض. يعيد [productId, blackId, whiteId]. */
    private function variantManagedProduct(string $token, string $tenantId, array $overrides = []): array
    {
        $product = $this->product($token, array_merge(['name' => 'قميص', 'sale_price' => 2000], $overrides));
        app(TenantContext::class)->set($tenantId);
        $productModel = Product::findOrFail($product['id']);
        $color = $productModel->options()->create(['tenant_id' => $tenantId, 'name' => 'اللون', 'name_key' => 'اللون']);
        $black = $color->values()->create(['tenant_id' => $tenantId, 'value' => 'أسود', 'value_key' => 'أسود']);
        $white = $color->values()->create(['tenant_id' => $tenantId, 'value' => 'أبيض', 'value_key' => 'أبيض']);

        $variants = app(ProductVariantService::class);
        $variants->enableVariantManagement($productModel, null);
        $productModel = $productModel->fresh();
        $blackVariant = $variants->createSingleVariant($productModel, [$black->id], null)['variant'];
        $whiteVariant = $variants->createSingleVariant($productModel->fresh(), [$white->id], null)['variant'];

        return [$product['id'], $blackVariant->id, $whiteVariant->id];
    }

    // ───────────────────────── ١-٢) توافقٌ رجعي ─────────────────────────

    /** @test */
    public function simple_product_with_primary_barcode_remains_unchanged(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token'], ['barcode' => 'PRIMARY-UX-1']);

        $this->withToken($auth['token'])->getJson("/api/products/{$product['id']}")
            ->assertOk()->assertJsonPath('data.barcode', 'PRIMARY-UX-1');
    }

    /** @test */
    public function simple_product_can_have_multiple_uom_barcodes(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token']);
        $this->withPackAndCartonUnits($auth['token'], $auth['tenant_id'], $product['id']);

        $this->withToken($auth['token'])->postJson("/api/products/{$product['id']}/barcodes", [
            'code' => 'PIECE-A', 'unit_name' => 'piece',
        ])->assertCreated();
        $this->withToken($auth['token'])->postJson("/api/products/{$product['id']}/barcodes", [
            'code' => 'PACK-B', 'unit_name' => 'pack',
        ])->assertCreated();
        $this->withToken($auth['token'])->postJson("/api/products/{$product['id']}/barcodes", [
            'code' => 'CARTON-C', 'unit_name' => 'carton',
        ])->assertCreated();

        $list = $this->withToken($auth['token'])->getJson("/api/products/{$product['id']}/barcodes")->assertOk()['data'];
        $this->assertCount(3, $list);
    }

    // ───────────────────────── ٣-٥) لا سعرٌ مُشتَقّ من المعامل ─────────────────────────

    /** @test — العقد الأساسي: كرتون×12 = 50، لا 12×سعر الحبة الأساسي. */
    public function explicit_price_per_uom_is_never_factor_derived(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token'], ['sale_price' => 500]); // الحبة = 5 ريال
        $this->withPackAndCartonUnits($auth['token'], $auth['tenant_id'], $product['id']);

        $this->withToken($auth['token'])->putJson("/api/products/{$product['id']}/unit-prices", [
            'unit_name' => 'pack', 'price' => 2700,
        ])->assertCreated()->assertJsonPath('data.price', '27.00');

        $this->withToken($auth['token'])->putJson("/api/products/{$product['id']}/unit-prices", [
            'unit_name' => 'carton', 'price' => 5000,
        ])->assertCreated()->assertJsonPath('data.price', '50.00');

        $rows = $this->withToken($auth['token'])->getJson("/api/products/{$product['id']}/unit-prices")->assertOk()['data'];
        $byUnit = collect($rows)->keyBy('unit_name');
        $this->assertSame('27.00', $byUnit['pack']['price'], 'باكيت×6 لا يساوي 6×5=30.');
        $this->assertSame('50.00', $byUnit['carton']['price'], 'كرتون×12 لا يساوي 12×5=60.');
    }

    // ───────────────────────── ٦) نفس الهويّة×الوحدة = نفس السعر القانوني ─────────────────────────

    /** @test */
    public function multiple_barcodes_for_the_same_product_and_uom_resolve_the_same_canonical_price(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token']);
        $this->withPackAndCartonUnits($auth['token'], $auth['tenant_id'], $product['id']);

        $this->withToken($auth['token'])->putJson("/api/products/{$product['id']}/unit-prices", [
            'unit_name' => 'pack', 'price' => 2700,
        ])->assertCreated();

        $this->withToken($auth['token'])->postJson("/api/products/{$product['id']}/barcodes", [
            'code' => 'PACK-ALIAS-A', 'unit_name' => 'pack',
        ])->assertCreated();
        $this->withToken($auth['token'])->postJson("/api/products/{$product['id']}/barcodes", [
            'code' => 'PACK-ALIAS-B', 'unit_name' => 'pack',
        ])->assertCreated();

        // كلا الباركودين يحلّان لنفس الهويّة×الوحدة، فسعرهما القانوني واحد —
        // لا سعر مخزَّن على الباركود نفسه (`ProductBarcode` بلا عمود سعر أصلاً).
        // صفّ «piece» الأساسي موجودٌ دوماً (يُنشأ تلقائياً من `sale_price` عند
        // إنشاء المنتج — VAR-PRICE-1)، فالفحص هنا على صفّ «pack» تحديداً.
        $rows = $this->withToken($auth['token'])->getJson("/api/products/{$product['id']}/unit-prices")->assertOk()['data'];
        $packRows = collect($rows)->where('unit_name', 'pack')->values();
        $this->assertCount(1, $packRows, 'صفٌّ قانونيٌّ واحد لباكيت — لا يتكرّر بتكرار الباركود.');
        $this->assertSame('27.00', $packRows[0]['price']);

        // تعديل السعر مرّةً واحدة ينعكس على كلا الباركودين معاً (نفس المصدر).
        $this->withToken($auth['token'])->putJson("/api/products/{$product['id']}/unit-prices", [
            'unit_name' => 'pack', 'price' => 3000,
        ])->assertCreated();
        $rows = $this->withToken($auth['token'])->getJson("/api/products/{$product['id']}/unit-prices")->assertOk()['data'];
        $packRows = collect($rows)->where('unit_name', 'pack')->values();
        $this->assertSame('30.00', $packRows[0]['price']);
    }

    // ───────────────────────── ٧-٨) تحديث/مسح السعر القانوني ─────────────────────────

    /** @test */
    public function updating_the_canonical_uom_price_replaces_the_same_row(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token']);

        $this->withToken($auth['token'])->putJson("/api/products/{$product['id']}/unit-prices", [
            'price' => 500,
        ])->assertCreated();
        $this->withToken($auth['token'])->putJson("/api/products/{$product['id']}/unit-prices", [
            'price' => 700,
        ])->assertCreated()->assertJsonPath('data.price', '7.00');

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(1, ProductUnitPrice::where('product_id', $product['id'])->where('unit_name', 'piece')->count());
    }

    /** @test */
    public function clearing_the_canonical_uom_price_makes_it_unresolved(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token']);
        $this->withPackAndCartonUnits($auth['token'], $auth['tenant_id'], $product['id']);

        $this->withToken($auth['token'])->putJson("/api/products/{$product['id']}/unit-prices", [
            'unit_name' => 'pack', 'price' => 2700,
        ])->assertCreated();

        $this->withToken($auth['token'])->deleteJson("/api/products/{$product['id']}/unit-prices?unit_name=pack")
            ->assertOk();

        // صفّ «piece» الأساسي التلقائي (VAR-PRICE-1) يبقى قائماً — المسح
        // يطال «pack» وحدها.
        $rows = $this->withToken($auth['token'])->getJson("/api/products/{$product['id']}/unit-prices")->assertOk()['data'];
        $this->assertCount(0, collect($rows)->where('unit_name', 'pack'));
    }

    // ───────────────────────── ٩-١١) هويّة المتغيّر في الباركود ─────────────────────────

    /** @test */
    public function a_variant_barcode_stores_product_variant_id(): void
    {
        $auth = $this->registerTenant();
        [$productId, $blackId] = $this->variantManagedProduct($auth['token'], $auth['tenant_id']);

        $barcode = $this->withToken($auth['token'])->postJson("/api/products/{$productId}/barcodes", [
            'code' => 'BLACK-BC', 'product_variant_id' => $blackId,
        ])->assertCreated()['data'];

        $this->assertSame($blackId, $barcode['product_variant_id']);
        $this->assertNotNull($barcode['variant_descriptor']);
    }

    /** @test */
    public function variant_a_barcode_and_variant_b_barcode_each_resolve_their_own_variant(): void
    {
        $auth = $this->registerTenant();
        [$productId, $blackId, $whiteId] = $this->variantManagedProduct($auth['token'], $auth['tenant_id']);

        $this->withToken($auth['token'])->postJson("/api/products/{$productId}/barcodes", [
            'code' => 'BLACK-BC-2', 'product_variant_id' => $blackId,
        ])->assertCreated();
        $this->withToken($auth['token'])->postJson("/api/products/{$productId}/barcodes", [
            'code' => 'WHITE-BC-2', 'product_variant_id' => $whiteId,
        ])->assertCreated();

        $list = $this->withToken($auth['token'])->getJson("/api/products/{$productId}/barcodes")->assertOk()['data'];
        $byCode = collect($list)->keyBy('code');
        $this->assertSame($blackId, $byCode['BLACK-BC-2']['product_variant_id']);
        $this->assertSame($whiteId, $byCode['WHITE-BC-2']['product_variant_id']);
    }

    /** @test — سعرٌ صريحٌ لكل متغيّرٍ على حدة، لا تشارك ولا كتابة فوق الآخر. */
    public function each_variant_can_have_its_own_explicit_uom_price(): void
    {
        $auth = $this->registerTenant();
        [$productId, $blackId, $whiteId] = $this->variantManagedProduct($auth['token'], $auth['tenant_id']);

        $this->withToken($auth['token'])->putJson("/api/products/{$productId}/unit-prices", [
            'product_variant_id' => $blackId, 'price' => 2500,
        ])->assertCreated();
        $this->withToken($auth['token'])->putJson("/api/products/{$productId}/unit-prices", [
            'product_variant_id' => $whiteId, 'price' => 2200,
        ])->assertCreated();

        $rows = $this->withToken($auth['token'])->getJson("/api/products/{$productId}/unit-prices")->assertOk()['data'];
        $byVariant = collect($rows)->keyBy('product_variant_id');
        $this->assertSame('25.00', $byVariant[$blackId]['price']);
        $this->assertSame('22.00', $byVariant[$whiteId]['price']);
    }

    // ───────────────────────── ١٢) رفض هويّةٍ خاطئة ─────────────────────────

    /** @test */
    public function a_variant_belonging_to_a_different_product_is_rejected(): void
    {
        $auth = $this->registerTenant();
        [$productAId] = $this->variantManagedProduct($auth['token'], $auth['tenant_id'], ['sku' => 'UX-A-'.uniqid()]);
        [, $variantOfBId] = $this->variantManagedProduct($auth['token'], $auth['tenant_id'], ['sku' => 'UX-B-'.uniqid()]);

        $this->withToken($auth['token'])->postJson("/api/products/{$productAId}/barcodes", [
            'code' => 'WRONG-PRODUCT-BC', 'product_variant_id' => $variantOfBId,
        ])->assertStatus(422);

        $this->withToken($auth['token'])->putJson("/api/products/{$productAId}/unit-prices", [
            'product_variant_id' => $variantOfBId, 'price' => 1000,
        ])->assertStatus(422);

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(0, ProductBarcode::where('code', 'WRONG-PRODUCT-BC')->count());
    }

    // ───────────────────────── ١٣-١٤) عزل المستأجر ─────────────────────────

    /** @test */
    public function a_cross_tenant_variant_is_rejected_for_both_barcode_and_price(): void
    {
        $auth = $this->registerTenant('ux1-a', 'owner@ux1-a.test');
        [$productId] = $this->variantManagedProduct($auth['token'], $auth['tenant_id']);

        $other = $this->registerTenant('ux1-b', 'owner@ux1-b.test');
        [, $foreignVariantId] = $this->variantManagedProduct($other['token'], $other['tenant_id']);

        $this->withToken($auth['token'])->postJson("/api/products/{$productId}/barcodes", [
            'code' => 'FOREIGN-VARIANT-BC', 'product_variant_id' => $foreignVariantId,
        ])->assertStatus(422);

        $this->withToken($auth['token'])->putJson("/api/products/{$productId}/unit-prices", [
            'product_variant_id' => $foreignVariantId, 'price' => 1000,
        ])->assertStatus(422);
    }

    /** @test — كتابة سعرٍ لا تستطيع استهداف منتج مستأجرٍ آخر عبر تخمين معرّفه. */
    public function price_write_cannot_target_another_tenants_product(): void
    {
        $auth = $this->registerTenant('ux1-c', 'owner@ux1-c.test');
        $other = $this->registerTenant('ux1-d', 'owner@ux1-d.test');
        $foreignProduct = $this->product($other['token']);

        // منتج المستأجر الأول موجودٌ فعلاً هنا، فيُختبَر بمعرّف منتج المستأجر
        // الآخر مباشرةً — `Product::findOrFail()` يمرّ عبر TenantScope فيرفض
        // (404) قبل أن يصل أي منطق تسعيرٍ إطلاقاً.
        $this->withToken($auth['token'])->putJson("/api/products/{$foreignProduct['id']}/unit-prices", [
            'price' => 1000,
        ])->assertStatus(404);
    }

    /** @test — القراءة لا تكشف باركودات/أسعار مستأجرٍ آخر. */
    public function get_endpoints_cannot_expose_another_tenants_barcodes_or_prices(): void
    {
        $auth = $this->registerTenant('ux1-e', 'owner@ux1-e.test');
        $other = $this->registerTenant('ux1-f', 'owner@ux1-f.test');
        $foreignProduct = $this->product($other['token']);
        $this->withToken($other['token'])->postJson("/api/products/{$foreignProduct['id']}/barcodes", [
            'code' => 'OTHER-TENANT-BC', 'unit_name' => 'piece',
        ])->assertCreated();
        $this->withToken($other['token'])->putJson("/api/products/{$foreignProduct['id']}/unit-prices", [
            'price' => 999,
        ])->assertCreated();

        $this->withToken($auth['token'])->getJson("/api/products/{$foreignProduct['id']}/barcodes")->assertStatus(404);
        $this->withToken($auth['token'])->getJson("/api/products/{$foreignProduct['id']}/unit-prices")->assertStatus(404);
    }

    // ───────────────────────── ١٦) مبلغٌ غير صالح ─────────────────────────

    /** @test */
    public function malformed_money_is_rejected(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token']);

        $this->withToken($auth['token'])->putJson("/api/products/{$product['id']}/unit-prices", [
            'price' => -100,
        ])->assertStatus(422);

        $this->withToken($auth['token'])->putJson("/api/products/{$product['id']}/unit-prices", [
            'price' => '27.50',
        ])->assertStatus(422);
    }

    // ───────────────────────── ١٨-١٩) توافقٌ رجعيٌّ للإنشاء/التعديل ─────────────────────────

    /** @test — إنشاءٌ بلا `barcodes`/`unit_prices` إطلاقاً يبقى يعمل كما قبل هذه المهمة. */
    public function product_create_without_barcodes_or_unit_prices_still_works(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])->postJson('/api/products', [
            'name' => 'منتجٌ بسيط بلا إضافات', 'type' => 'good', 'unit' => 'piece', 'sale_price' => 1000,
        ])->assertCreated();
    }

    /** @test */
    public function product_edit_without_touching_new_endpoints_still_works(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token']);

        $this->withToken($auth['token'])->putJson("/api/products/{$product['id']}", [
            'name' => 'اسمٌ مُعدَّل', 'type' => 'good', 'unit' => 'piece', 'sale_price' => 1200,
        ])->assertOk()->assertJsonPath('data.name', 'اسمٌ مُعدَّل');
    }

    // ───────────────────────── ٢٠) توافق محلّل الباركود في نقطة البيع ─────────────────────────

    /** @test — الباركود المُنشَأ من شاشة المنتج قابلٌ للاستهلاك من `PosBarcodeResolver` الحالي دون أي تعديل عليه. */
    public function pos_resolver_consumes_a_barcode_created_from_the_product_screen(): void
    {
        $auth = $this->registerTenant();
        [$productId, $blackId] = $this->variantManagedProduct($auth['token'], $auth['tenant_id']);
        $this->withToken($auth['token'])->postJson("/api/products/{$productId}/barcodes", [
            'code' => 'POS-CONSUME-BC', 'product_variant_id' => $blackId,
        ])->assertCreated();
        $this->withToken($auth['token'])->putJson("/api/products/{$productId}/unit-prices", [
            'product_variant_id' => $blackId, 'price' => 2500,
        ])->assertCreated();

        $resolved = $this->withToken($auth['token'])->postJson('/api/pos/barcode', ['code' => 'POS-CONSUME-BC'])
            ->assertOk()['data'];

        $this->assertSame($productId, $resolved['product_id']);
        $this->assertSame($blackId, $resolved['product_variant_id']);
        $this->assertSame(2500, $resolved['price'], 'محلِّل نقطة البيع يعيد الهللات الخام — لا تنسيق ريال.');
    }

    // ───────────────────────── ٢١) قوائم الأسعار تبقى أعلى أسبقيةً ─────────────────────────

    /** @test — قائمة سعرٍ صريحة على العميل تبقى أعلى من السعر القانوني الجديد — لم تُمَسّ الأسبقية. */
    public function price_list_precedence_over_the_canonical_uom_price_is_unaffected(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token']);
        $this->withToken($auth['token'])->putJson("/api/products/{$product['id']}/unit-prices", [
            'price' => 500,
        ])->assertCreated();

        app(TenantContext::class)->set($auth['tenant_id']);
        $productModel = Product::findOrFail($product['id']);
        $priceList = PriceList::create(['tenant_id' => $auth['tenant_id'], 'name' => 'قائمة كبار العملاء', 'is_active' => true]);
        app(PriceListService::class)->upsertItem($priceList, $productModel, ['price' => 450]);

        $resolved = app(PosCustomerPriceListResolver::class)->posPriceFor($priceList, $productModel, null);
        $this->assertSame(450, $resolved, 'قائمة السعر الصريحة تبقى أعلى أسبقيةً من السعر القانوني للوحدة.');
    }

    // ───────────────────────── ٢٢-٢٤) لا تراجعٌ محظور ─────────────────────────

    /** @test — لا تراجعَ عبر وحداتٍ مختلفة: كرتونٌ بلا سعرٍ صريح يبقى بلا سعر حتى مع سعر الحبة. */
    public function no_cross_uom_fallback_through_the_new_endpoint(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token']);
        $this->withPackAndCartonUnits($auth['token'], $auth['tenant_id'], $product['id']);
        $this->withToken($auth['token'])->putJson("/api/products/{$product['id']}/unit-prices", [
            'price' => 500,
        ])->assertCreated();

        $rows = $this->withToken($auth['token'])->getJson("/api/products/{$product['id']}/unit-prices")->assertOk()['data'];
        $this->assertCount(1, $rows, 'سعر الكرتون غير محلولٍ إطلاقاً — لا صفّ له، لا تراجعٌ من سعر الحبة.');
    }

    /** @test — لا تراجعَ عبر الشقيق: متغيّرٌ أبيض بلا سعرٍ صريح لا يقرأ سعر الأسود. */
    public function no_sibling_variant_price_fallback_through_the_new_endpoint(): void
    {
        $auth = $this->registerTenant();
        [$productId, $blackId, $whiteId] = $this->variantManagedProduct($auth['token'], $auth['tenant_id']);
        $this->withToken($auth['token'])->putJson("/api/products/{$productId}/unit-prices", [
            'product_variant_id' => $blackId, 'price' => 2500,
        ])->assertCreated();

        // صفّ «piece» الأساسي التلقائي للأب (VAR-PRICE-1) موجودٌ دائماً؛ الفحص
        // هنا أن الأبيض بلا صفٍّ خاصٍّ به — لم يُنسَخ سعر الأسود إليه.
        $rows = $this->withToken($auth['token'])->getJson("/api/products/{$productId}/unit-prices")->assertOk()['data'];
        $variantRows = collect($rows)->whereNotNull('product_variant_id')->values();
        $this->assertCount(1, $variantRows);
        $this->assertSame($blackId, $variantRows[0]['product_variant_id']);
    }

    // ───────────────────────── ٢٦) التراجع الذرّي عند فشل عمليةٍ مُجمَّعة ─────────────────────────

    /** @test */
    public function transaction_rolls_back_when_a_combined_create_operation_fails(): void
    {
        $auth = $this->registerTenant();
        $before = Product::count();

        $this->withToken($auth['token'])->postJson('/api/products', [
            'name' => 'منتجٌ يفشل جزئياً', 'type' => 'good', 'unit' => 'piece', 'sale_price' => 1000,
            'barcodes' => [['code' => 'ROLLBACK-BC-1', 'unit_name' => 'piece']],
            'unit_prices' => [['price' => -500]], // سالبٌ: يفشل
        ])->assertStatus(422);

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame($before, Product::count(), 'فشل سعر السطر الثاني يجب أن يُسقِط المنتج والباركود معاً.');
        $this->assertSame(0, ProductBarcode::where('code', 'ROLLBACK-BC-1')->count());
    }
}
