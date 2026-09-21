<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductUnitPrice;
use App\Models\ProductVariant;
use App\Models\UnitTemplate;
use App\Services\ProductPricingService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class PosCatalogPricingPreparationTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function product(string $tenantId, string $name, bool $withVariant = false): Product
    {
        app(TenantContext::class)->set($tenantId);
        $template = UnitTemplate::create([
            'tenant_id' => $tenantId,
            'name' => 'قالب POS '.$name.uniqid(),
            'base_unit' => 'piece',
        ]);
        $template->units()->create(['tenant_id' => $tenantId, 'name' => 'carton', 'factor' => 12]);
        $product = Product::create([
            'tenant_id' => $tenantId,
            'name' => $name,
            'sku' => 'POS-PRICE-'.uniqid(),
            'unit' => 'piece',
            'unit_template_id' => $template->id,
            'sale_price' => 1000,
            'is_active' => true,
        ]);
        if ($withVariant) {
            $product->forceFill(['variant_state' => 'variant_managed'])->save();
            ProductVariant::create([
                'tenant_id' => $tenantId,
                'product_id' => $product->id,
                'sku' => 'POS-PRICE-V-'.uniqid(),
                'combination_key' => 'v-'.uniqid(),
                'is_active' => true,
            ]);
        }

        return $product->fresh(['variants']);
    }

    /** @return array<int, array<string, mixed>> */
    private function catalog(string $token, ?string $partnerId = null): array
    {
        $url = '/api/pos/products'.($partnerId ? '?partner_id='.$partnerId : '');

        return $this->withToken($token)->getJson($url)->assertOk()['data'];
    }

    /** @test */
    public function it_preserves_explicit_unit_and_variant_same_unit_fallback_semantics(): void
    {
        $auth = $this->registerTenant('pos-pricing-values', 'owner@pos-pricing-values.test');
        $simple = $this->product($auth['tenant_id'], 'وحدة صريحة');
        $missing = $this->product($auth['tenant_id'], 'وحدة بلا سعر');
        $parent = $this->product($auth['tenant_id'], 'متغيرات', true);
        $variant = $parent->variants->sole();
        $pricing = app(ProductPricingService::class);
        $pricing->setPrice($simple, null, 'carton', 12000);
        $pricing->setPrice($parent, null, null, 2100);
        $pricing->setPrice($parent, $variant, null, 2300);
        app(TenantContext::class)->forget();

        $items = collect($this->catalog($auth['token']))->keyBy('id');
        $this->assertSame(['piece', 'carton'], array_column($items[$simple->id]['pos_units'], 'name'));
        $this->assertSame(['10.00', '120.00'], array_column($items[$simple->id]['pos_units'], 'price'));
        $this->assertSame(['piece'], array_column($items[$missing->id]['pos_units'], 'name'));
        $this->assertSame('23.00', $items[$parent->id]['variants'][0]['price']);

        app(TenantContext::class)->set($auth['tenant_id']);
        ProductUnitPrice::where('product_variant_id', $variant->id)->where('unit_name', 'piece')->delete();
        app(TenantContext::class)->forget();
        $items = collect($this->catalog($auth['token']))->keyBy('id');
        $this->assertSame('21.00', $items[$parent->id]['variants'][0]['price']);
    }

    /** @test */
    public function pricing_query_families_are_bounded_when_catalogue_grows(): void
    {
        $small = $this->registerTenant('pos-pricing-small', 'owner@pos-pricing-small.test');
        $this->pricedCatalogue($small['tenant_id'], 4);
        app(TenantContext::class)->forget();
        $large = $this->registerTenant('pos-pricing-large', 'owner@pos-pricing-large.test');
        $this->pricedCatalogue($large['tenant_id'], 20);
        app(TenantContext::class)->forget();

        DB::enableQueryLog();
        DB::flushQueryLog();
        $this->catalog($small['token']);
        $smallPrices = $this->queriesFor(DB::getQueryLog(), 'product_unit_prices');
        $smallParentLazy = $this->parentLazyQueries(DB::getQueryLog());

        DB::flushQueryLog();
        $this->catalog($large['token']);
        $largePrices = $this->queriesFor(DB::getQueryLog(), 'product_unit_prices');
        $largeParentLazy = $this->parentLazyQueries(DB::getQueryLog());
        DB::disableQueryLog();

        $this->assertSame(1, $smallPrices);
        $this->assertSame($smallPrices, $largePrices);
        $this->assertSame(0, $smallParentLazy);
        $this->assertSame($smallParentLazy, $largeParentLazy);
    }

    private function pricedCatalogue(string $tenantId, int $count): void
    {
        $pricing = app(ProductPricingService::class);
        for ($i = 0; $i < $count; $i++) {
            $product = $this->product($tenantId, "كتالوج {$count}-{$i}", true);
            $variant = $product->variants->sole();
            $pricing->setPrice($product, null, 'carton', 12000);
            $pricing->setPrice($product, $variant, null, 2000 + $i);
        }
    }

    /** @param array<int, array{query:string}> $queries */
    private function queriesFor(array $queries, string $table): int
    {
        return count(array_filter($queries, fn (array $query) => str_contains($query['query'], $table)));
    }

    /** @param array<int, array{query:string}> $queries */
    private function parentLazyQueries(array $queries): int
    {
        return count(array_filter($queries, fn (array $query) => str_contains($query['query'], 'from "products" where "products"."id"')));
    }
}
