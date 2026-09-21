<?php

namespace Tests\Feature;

use App\Models\InventoryState;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Support\BranchSettings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class PosCatalogInventoryPreparationTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function product(string $tenantId, string $name, bool $variantManaged = false): Product
    {
        app(TenantContext::class)->set($tenantId);
        $product = Product::create([
            'tenant_id' => $tenantId,
            'name' => $name,
            'sku' => 'POS-INV-'.str_replace(' ', '-', $name).'-'.uniqid(),
            'sale_price' => 1000,
            'is_active' => true,
        ]);

        if ($variantManaged) {
            $product->forceFill(['variant_state' => 'variant_managed'])->save();
        }

        return $product;
    }

    private function state(Product $product, int $quantity, int $avgCost, ?ProductVariant $variant = null): void
    {
        InventoryState::create([
            'tenant_id' => $product->tenant_id,
            'product_id' => $product->id,
            'product_variant_id' => $variant?->id,
            'quantity_on_hand' => $quantity,
            'avg_cost' => $avgCost,
        ]);
    }

    private function variant(Product $product, string $suffix): ProductVariant
    {
        return ProductVariant::create([
            'tenant_id' => $product->tenant_id,
            'product_id' => $product->id,
            'sku' => 'POS-INV-V-'.$suffix.'-'.uniqid(),
            'combination_key' => $suffix,
            'is_active' => true,
        ]);
    }

    /** @return array<int, array<string, mixed>> */
    private function catalog(string $token): array
    {
        return $this->withToken($token)->getJson('/api/pos/products')->assertOk()['data'];
    }

    /** @test */
    public function it_preserves_simple_variant_and_empty_inventory_semantics(): void
    {
        $auth = $this->registerTenant('pos-inventory-values', 'owner@pos-inventory-values.test');
        $simple = $this->product($auth['tenant_id'], 'بسيط');
        $empty = $this->product($auth['tenant_id'], 'بلا حالة');
        $parent = $this->product($auth['tenant_id'], 'متغيرات', true);
        $red = $this->variant($parent, 'red');
        $blue = $this->variant($parent, 'blue');
        $this->state($simple, 7, 1234);
        $this->state($parent, 3, 9999, $red);
        $this->state($parent, 11, 8888, $blue);
        app(TenantContext::class)->forget();

        $items = collect($this->catalog($auth['token']))->keyBy('id');

        $this->assertSame(7, $items[$simple->id]['quantity_on_hand']);
        $this->assertSame(14, $items[$parent->id]['quantity_on_hand']);
        $this->assertSame(0, $items[$empty->id]['quantity_on_hand']);
        $this->assertArrayNotHasKey('avg_cost', $items[$simple->id]);
        $this->assertIsInt($items[$simple->id]['quantity_on_hand']);
    }

    /** @test */
    public function cost_authorization_uses_prepared_simple_cost_and_keeps_variant_parent_cost_zero(): void
    {
        $auth = $this->registerTenant('pos-inventory-cost', 'owner@pos-inventory-cost.test');
        $this->withToken($auth['token'])->putJson('/api/sales-config/pos', [
            'data' => ['show_cost_profit_in_pos' => true],
        ])->assertOk();

        $simple = $this->product($auth['tenant_id'], 'تكلفة بسيط');
        $parent = $this->product($auth['tenant_id'], 'تكلفة متغير', true);
        $variant = $this->variant($parent, 'cost');
        $this->state($simple, 2, 1234);
        $this->state($parent, 4, 9000, $variant);
        app(TenantContext::class)->forget();

        $items = collect($this->catalog($auth['token']))->keyBy('id');

        $this->assertSame('12.34', $items[$simple->id]['avg_cost']);
        $this->assertSame('0.00', $items[$parent->id]['avg_cost']);
    }

    /** @test */
    public function it_is_tenant_isolated_even_when_foreign_inventory_state_exists(): void
    {
        $tenantA = $this->registerTenant('pos-inventory-a', 'owner@pos-inventory-a.test');
        $productA = $this->product($tenantA['tenant_id'], 'منتج أ');
        $this->state($productA, 5, 100);
        app(TenantContext::class)->forget();

        $tenantB = $this->registerTenant('pos-inventory-b', 'owner@pos-inventory-b.test');
        $productB = $this->product($tenantB['tenant_id'], 'منتج ب');
        $this->state($productB, 99, 500);
        app(TenantContext::class)->forget();

        $catalogA = collect($this->catalog($tenantA['token']))->keyBy('id');
        $this->assertSame(5, $catalogA[$productA->id]['quantity_on_hand']);
        $this->assertArrayNotHasKey($productB->id, $catalogA->all());
    }

    /** @test */
    public function it_preserves_branch_scoped_product_visibility(): void
    {
        $auth = $this->registerTenant('pos-inventory-branches', 'owner@pos-inventory-branches.test');
        $main = $this->withToken($auth['token'])->getJson('/api/branches')->assertOk()['data'][0]['id'];
        $other = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع POS آخر'])
            ->assertCreated()['data']['id'];

        $mainProduct = $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $main])
            ->postJson('/api/products', ['name' => 'منتج POS الرئيسي', 'sale_price' => 1000])
            ->assertCreated()['data'];
        $otherProduct = $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $other])
            ->postJson('/api/products', ['name' => 'منتج POS الآخر', 'sale_price' => 1000])
            ->assertCreated()['data'];
        app(TenantContext::class)->set($auth['tenant_id']);
        BranchSettings::merge(['share_products' => false]);
        app(TenantContext::class)->forget();

        $catalog = $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $main])
            ->getJson('/api/pos/products')->assertOk()['data'];
        $ids = collect($catalog)->pluck('id')->all();

        $this->assertContains($mainProduct['id'], $ids);
        $this->assertNotContains($otherProduct['id'], $ids);
    }

    /** @test */
    public function inventory_state_query_family_is_bounded_when_catalogue_size_grows(): void
    {
        $small = $this->registerTenant('pos-inventory-small', 'owner@pos-inventory-small.test');
        for ($i = 0; $i < 4; $i++) {
            $product = $this->product($small['tenant_id'], "صغير {$i}");
            $this->state($product, $i + 1, 100);
        }
        app(TenantContext::class)->forget();

        $large = $this->registerTenant('pos-inventory-large', 'owner@pos-inventory-large.test');
        for ($i = 0; $i < 32; $i++) {
            $product = $this->product($large['tenant_id'], "كبير {$i}");
            $this->state($product, $i + 1, 100);
        }
        app(TenantContext::class)->forget();

        DB::enableQueryLog();
        DB::flushQueryLog();
        $this->catalog($small['token']);
        $smallInventoryQueries = $this->inventoryStateQueries(DB::getQueryLog());

        DB::flushQueryLog();
        $this->catalog($large['token']);
        $largeInventoryQueries = $this->inventoryStateQueries(DB::getQueryLog());
        DB::disableQueryLog();

        $this->assertSame(1, $smallInventoryQueries);
        $this->assertSame($smallInventoryQueries, $largeInventoryQueries);
    }

    /** @param array<int, array{query:string}> $queries */
    private function inventoryStateQueries(array $queries): int
    {
        return count(array_filter($queries, fn (array $query) => str_contains($query['query'], 'inventory_states')));
    }
}
