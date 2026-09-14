<?php

namespace Tests\Feature;

use App\Models\PriceList;
use App\Models\PriceListItem;
use App\Models\Product;
use App\Models\ProductOption;
use App\Models\ProductOptionValue;
use App\Models\ProductUnitPrice;
use App\Models\ProductVariant;
use App\Models\Tenant;
use App\Models\UnitTemplate;
use App\Services\ProductPricingService;
use App\Services\ProductVariantService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

/**
 * VAR-PRICE-1 — هويّة التسعير الأساسي الموحّدة (Product/Variant × UOM).
 *
 * يغطّي: السلطة الوحيدة للسعر الأساسي، عدم اشتقاق سعرٍ من معامل التحويل،
 * تراجع المتغيّر لنفس الوحدة فقط، استقلال المتغيّرات الشقيقة، عزل الهويّة
 * (منتج/متغيّر/مستأجر)، وقيود التفرّد.
 *
 * تشغيل: php artisan test --filter=ProductUnitPriceTest
 */
class ProductUnitPriceTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;

    protected ProductPricingService $pricing;

    protected ProductVariantService $variants;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'نبراس الطموح', 'slug' => 'nibras',
            'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenant->id);

        $this->pricing = app(ProductPricingService::class);
        $this->variants = app(ProductVariantService::class);
    }

    private function product(array $overrides = []): Product
    {
        return Product::create(array_merge(['name' => 'منتج', 'sale_price' => 5000], $overrides));
    }

    private function withCartonUnit(Product $product): Product
    {
        $template = UnitTemplate::create(['tenant_id' => $this->tenant->id, 'name' => 'قالب كراتين '.uniqid(), 'base_unit' => $product->unit]);
        $template->units()->create(['tenant_id' => $this->tenant->id, 'name' => 'carton', 'factor' => 12]);
        $product->update(['unit_template_id' => $template->id]);

        return $product->fresh();
    }

    private function variantManagedProduct(): Product
    {
        $tenantId = app(TenantContext::class)->id();
        $product = $this->product();
        $option = $product->options()->create(['tenant_id' => $tenantId, 'name' => 'اللون', 'name_key' => 'اللون']);
        $value = $option->values()->create(['tenant_id' => $tenantId, 'value' => 'أحمر', 'value_key' => 'أحمر']);
        $this->variants->enableVariantManagement($product, null);
        $this->variants->createSingleVariant($product->fresh(), [$value->id], null);

        return $product->fresh();
    }

    // ───────────────────────── منتجٌ بسيط ─────────────────────────

    /** @test */
    public function a_new_product_gets_one_canonical_base_unit_price_row_immediately(): void
    {
        $product = $this->product(['sale_price' => 7500]);

        $this->assertSame(1, ProductUnitPrice::where('product_id', $product->id)->count());
        $this->assertSame(7500, $product->sale_price);
        $this->assertSame(7500, $this->pricing->resolveExplicit($product, null, null));
    }

    /** @test */
    public function an_alternate_unit_explicit_price_can_be_set_and_read_back(): void
    {
        $product = $this->withCartonUnit($this->product(['sale_price' => 500]));

        $this->pricing->setPrice($product, null, 'carton', 5700);

        $this->assertSame(5700, $this->pricing->resolveExplicit($product, null, 'carton'));
        $this->assertSame(500, $this->pricing->resolveExplicit($product, null, null), 'سعر وحدة الأساس لم يتأثر بسعر الكرتون.');
    }

    /** @test */
    public function updating_the_base_price_replaces_the_same_row_not_a_second_one(): void
    {
        $product = $this->product(['sale_price' => 1000]);

        $product->update(['sale_price' => 2000]);

        $this->assertSame(1, ProductUnitPrice::where('product_id', $product->id)->whereNull('product_variant_id')->count());
        $this->assertSame(2000, $product->fresh()->sale_price);
    }

    /** @test */
    public function clearing_an_alternate_unit_price_makes_it_unresolved_again(): void
    {
        $product = $this->withCartonUnit($this->product());
        $this->pricing->setPrice($product, null, 'carton', 4000);
        $this->assertSame(4000, $this->pricing->resolveExplicit($product, null, 'carton'));

        $this->pricing->clearPrice($product, null, 'carton');

        $this->assertNull($this->pricing->resolveExplicit($product, null, 'carton'));
    }

    /** @test */
    public function an_alternate_unit_price_is_never_derived_from_the_conversion_factor(): void
    {
        $product = $this->withCartonUnit($this->product(['sale_price' => 500]));

        // لا سعرٌ صريحٌ للكرتون — الاشتقاق الممنوع كان سيعطي 500*12=6000.
        $resolved = $this->pricing->resolveExplicit($product, null, 'carton');

        $this->assertNull($resolved);
        $this->assertNotSame(6000, $resolved);
    }

    // ───────────────────────── متغيّر ─────────────────────────

    /** @test */
    public function a_variant_explicit_price_overrides_the_product_default_for_the_same_unit(): void
    {
        $product = $this->variantManagedProduct();
        $product->update(['sale_price' => 5000]);
        $variant = $product->variants()->firstOrFail();

        $this->pricing->setPrice($product, $variant, null, 6000);

        $this->assertSame(6000, $this->pricing->resolveSellable($product, $variant, null));
        $this->assertSame(5000, $this->pricing->resolveExplicit($product, null, null), 'سعر الأب نفسه لم يتغيّر.');
    }

    /** @test */
    public function a_variant_without_an_explicit_price_falls_back_to_the_product_default_for_the_same_unit(): void
    {
        $product = $this->variantManagedProduct();
        $product->update(['sale_price' => 4200]);
        $variant = $product->variants()->firstOrFail();

        $this->assertSame(4200, $this->pricing->resolveSellable($product, $variant, null));
        $this->assertNull($this->pricing->resolveExplicit($product, $variant, null), 'لا سعرٌ صريحٌ للمتغيّر — هذا تراجعٌ لا سعرٌ حقيقي.');
    }

    /** @test */
    public function sibling_variants_never_share_or_overwrite_each_others_price(): void
    {
        $product = $this->variantManagedProduct();
        $option = $product->options()->firstOrFail();
        $blue = $option->values()->create(['tenant_id' => $this->tenant->id, 'value' => 'أزرق', 'value_key' => 'أزرق']);
        $result = $this->variants->createSingleVariant($product->fresh(), [$blue->id], null);
        $variantBlue = $result['variant'];
        $variantRed = $product->variants()->where('id', '!=', $variantBlue->id)->firstOrFail();

        $this->pricing->setPrice($product, $variantRed, null, 5500);
        $this->pricing->setPrice($product, $variantBlue, null, 4800);

        $this->assertSame(5500, $this->pricing->resolveExplicit($product, $variantRed, null));
        $this->assertSame(4800, $this->pricing->resolveExplicit($product, $variantBlue, null));

        // إعادة كتابة سعر الأحمر لا تمسّ الأزرق ولا الأب.
        $this->pricing->setPrice($product, $variantRed, null, 6600);
        $this->assertSame(6600, $this->pricing->resolveExplicit($product, $variantRed, null));
        $this->assertSame(4800, $this->pricing->resolveExplicit($product, $variantBlue, null), 'سعر الشقيق لم يتأثر.');
        $this->assertSame((int) $product->fresh()->sale_price, $this->pricing->resolveExplicit($product, null, null), 'سعر الأب لم يتأثر.');
    }

    /** @test */
    public function a_variant_price_never_falls_back_across_a_different_unit(): void
    {
        $product = $this->withCartonUnit($this->variantManagedProduct());
        $variant = $product->variants()->firstOrFail();
        $this->pricing->setPrice($product, $variant, null, 9000); // سعر المتغيّر لوحدة الأساس فقط

        // لا سعرٌ صريحٌ للكرتون — لا للمتغيّر ولا للمنتج — فلا تراجع عبره.
        $resolved = $this->pricing->resolveSellable($product, $variant, 'carton');

        $this->assertNull($resolved);
    }

    // ───────────────────────── هويّة/تفرّد ─────────────────────────

    /** @test */
    public function a_duplicate_simple_product_unit_price_updates_in_place_not_a_second_row(): void
    {
        $product = $this->product();

        $this->pricing->setPrice($product, null, null, 1000);
        $this->pricing->setPrice($product, null, null, 1500);

        $this->assertSame(1, ProductUnitPrice::where('product_id', $product->id)->whereNull('product_variant_id')->count());
        $this->assertSame(1500, $this->pricing->resolveExplicit($product, null, null));
    }

    /** @test */
    public function a_duplicate_variant_unit_price_updates_in_place_not_a_second_row(): void
    {
        $product = $this->variantManagedProduct();
        $variant = $product->variants()->firstOrFail();

        $this->pricing->setPrice($product, $variant, null, 1000);
        $this->pricing->setPrice($product, $variant, null, 1500);

        $this->assertSame(1, ProductUnitPrice::where('product_variant_id', $variant->id)->count());
        $this->assertSame(1500, $this->pricing->resolveExplicit($product, $variant, null));
    }

    /** @test */
    public function nullable_variant_identity_does_not_collide_with_a_simple_products_own_price_on_sqlite(): void
    {
        $product = $this->product(['sale_price' => 1000]);
        $variant = null;

        // منتجٌ بسيط بعده منتجٌ آخر بسيط — لا تصادم NULL×NULL على قيدٍ جزئي.
        $other = $this->product(['sale_price' => 2000]);

        $this->assertSame(1000, $this->pricing->resolveExplicit($product, $variant, null));
        $this->assertSame(2000, $this->pricing->resolveExplicit($other, $variant, null));
        $this->assertSame(2, ProductUnitPrice::whereNull('product_variant_id')->count());
    }

    /** @test */
    public function a_variant_from_a_different_product_is_rejected_fail_closed(): void
    {
        $productA = $this->variantManagedProduct();
        $productB = $this->variantManagedProduct();
        $variantOfB = $productB->variants()->firstOrFail();
        $countBefore = ProductUnitPrice::count();

        try {
            $this->pricing->setPrice($productA, $variantOfB, null, 1000);
            $this->fail('كان يجب أن يُرفض متغيّرٌ من منتجٍ آخر.');
        } catch (RuntimeException) {
            // متوقَّع.
        }

        $this->assertSame($countBefore, ProductUnitPrice::count());
    }

    /** @test */
    public function a_cross_tenant_product_is_rejected(): void
    {
        $otherTenant = Tenant::create([
            'name' => 'مستأجر آخر', 'slug' => 'other-price', 'vat_number' => '300000000000097', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($otherTenant->id);
        $foreignProduct = $this->product(['sale_price' => 999]);

        app(TenantContext::class)->set($this->tenant->id);
        $this->assertSame(0, ProductUnitPrice::count(), 'أسعار المستأجر الآخر يجب ألّا تظهر عبر النطاق العام.');
    }

    /** @test */
    public function a_cross_tenant_variant_is_rejected(): void
    {
        $otherTenant = Tenant::create([
            'name' => 'مستأجر آخر', 'slug' => 'other-price-2', 'vat_number' => '300000000000096', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($otherTenant->id);
        $foreignProduct = $this->variantManagedProduct();
        $foreignVariant = $foreignProduct->variants()->firstOrFail();

        app(TenantContext::class)->set($this->tenant->id);
        $localProduct = $this->product();
        $rawVariant = ProductVariant::withoutGlobalScopes()->findOrFail($foreignVariant->id);
        $countBefore = ProductUnitPrice::count();

        try {
            $this->pricing->setPrice($localProduct, $rawVariant, null, 1000);
            $this->fail('كان يجب أن يُرفض متغيّرٌ من مستأجرٍ آخر.');
        } catch (\Throwable) {
            // متوقَّع.
        }

        $this->assertSame($countBefore, ProductUnitPrice::count());
    }

    /** @test */
    public function deleting_a_variant_with_an_explicit_price_is_blocked(): void
    {
        $product = $this->variantManagedProduct();
        $variant = $product->variants()->firstOrFail();
        $this->pricing->setPrice($product, $variant, null, 1000);

        $this->expectException(RuntimeException::class);
        $this->variants->deleteVariant($variant, null);
    }

    /** @test */
    public function a_product_with_no_variants_and_no_other_references_can_still_be_deleted(): void
    {
        $product = $this->product();
        $this->assertSame(1, ProductUnitPrice::where('product_id', $product->id)->count());

        app(\App\Services\ProductLifecycleService::class)->delete($product, null);

        $this->assertNotNull($product->fresh()->deleted_at);
        $this->assertSame(0, ProductUnitPrice::where('product_id', $product->id)->count(), 'يُنظَّف السعر الأساسي مع الحذف الحقيقي.');
    }

    // ───────────────────────── قوائم الأسعار (متغيّر) ─────────────────────────

    /** @test */
    public function a_price_list_can_carry_an_explicit_variant_price_independent_of_the_product_item(): void
    {
        $list = PriceList::create(['tenant_id' => $this->tenant->id, 'name' => 'قائمة متغيّرات', 'is_active' => true]);
        $product = $this->variantManagedProduct();
        $variant = $product->variants()->firstOrFail();
        $priceLists = app(\App\Services\PriceListService::class);

        $priceLists->upsertItem($list, $product, ['price' => 3000], variant: $variant);
        $priceLists->upsertItem($list, $product, ['price' => 2000]); // عنصر المنتج نفسه، بلا متغيّر

        $this->assertSame(3000, $priceLists->resolve($list, $product, null, variant: $variant));
        $this->assertSame(2000, $priceLists->resolve($list, $product, null));
        $this->assertSame(2, PriceListItem::where('price_list_id', $list->id)->count());
    }

    /** @test */
    public function a_price_list_item_mismatched_variant_is_rejected_fail_closed(): void
    {
        $list = PriceList::create(['tenant_id' => $this->tenant->id, 'name' => 'قائمة أخرى', 'is_active' => true]);
        $productA = $this->variantManagedProduct();
        $productB = $this->variantManagedProduct();
        $variantOfB = $productB->variants()->firstOrFail();
        $priceLists = app(\App\Services\PriceListService::class);

        $this->expectException(RuntimeException::class);
        $priceLists->upsertItem($list, $productA, ['price' => 1000], variant: $variantOfB);
    }
}
