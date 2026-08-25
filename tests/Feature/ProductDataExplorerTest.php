<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductCategory;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ProductDataExplorerTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private string $token;

    protected function setUp(): void
    {
        parent::setUp();
        $auth = $this->registerTenant('product-explorer', 'products@example.test');
        $this->token = $auth['token'];
        app(TenantContext::class)->set($auth['tenant_id']);
    }

    /** @test */
    public function legacy_products_response_stays_unpaginated_and_newest_first(): void
    {
        $older = $this->product(['name' => 'قديم', 'sku' => 'SKU-OLD']);
        $newer = $this->product(['name' => 'جديد', 'sku' => 'SKU-NEW']);
        $older->forceFill(['created_at' => now()->subDay(), 'updated_at' => now()->subDay()])->saveQuietly();
        $newer->forceFill(['created_at' => now(), 'updated_at' => now()])->saveQuietly();

        $response = $this->withToken($this->token)->getJson('/api/products')->assertOk();

        $response->assertJsonMissingPath('meta');
        $this->assertSame(['SKU-NEW', 'SKU-OLD'], array_column($response['data'], 'sku'));
    }

    /** @test */
    public function products_can_be_paginated_and_sorted_on_the_server(): void
    {
        foreach (range(1, 12) as $index) {
            $this->product([
                'name' => sprintf('منتج %02d', $index),
                'sku' => sprintf('SKU-%02d', $index),
            ]);
        }

        $response = $this->withToken($this->token)
            ->getJson('/api/products?per_page=10&page=2&sort=name')
            ->assertOk()
            ->assertJsonPath('meta.current_page', 2)
            ->assertJsonPath('meta.per_page', 10)
            ->assertJsonPath('meta.total', 12);

        $this->assertCount(2, $response['data']);
        $this->assertSame('منتج 11', $response['data'][0]['name']);
        $this->assertSame('منتج 12', $response['data'][1]['name']);
    }

    /** @test */
    public function search_matches_name_sku_barcode_and_managed_category(): void
    {
        $category = ProductCategory::create(['name' => 'مشروبات باردة']);
        $this->product([
            'name' => 'مياه معدنية',
            'name_en' => 'Mineral Water',
            'sku' => 'WATER-42',
            'barcode' => '6281000000042',
            'category_id' => $category->id,
        ]);
        $this->product(['name' => 'منتج آخر', 'sku' => 'OTHER-1']);

        foreach (['مياه', 'WATER-42', '6281000000042', 'مشروبات باردة'] as $needle) {
            $response = $this->withToken($this->token)
                ->getJson('/api/products?per_page=10&search='.urlencode($needle))
                ->assertOk();
            $this->assertSame(['WATER-42'], array_column($response['data'], 'sku'));
        }
    }

    /** @test */
    public function category_type_and_active_filters_are_authoritative(): void
    {
        $category = ProductCategory::create(['name' => 'خدمات']);
        $target = $this->product([
            'name' => 'صيانة',
            'sku' => 'SERVICE-1',
            'type' => 'service',
            'category_id' => $category->id,
            'is_active' => false,
        ]);
        $this->product(['name' => 'سلعة', 'sku' => 'GOOD-1', 'type' => 'good', 'is_active' => true]);

        $response = $this->withToken($this->token)->getJson(
            '/api/products?per_page=10&type=service&is_active=0&category_id='.$category->id
        )->assertOk();

        $this->assertSame([$target->id], array_column($response['data'], 'id'));
    }

    /** @test */
    public function stock_state_filters_distinguish_tracked_low_out_and_untracked_products(): void
    {
        $low = $this->product([
            'name' => 'منخفض', 'sku' => 'LOW', 'track_inventory' => true,
            'quantity_on_hand' => 3, 'reorder_level' => 5,
        ]);
        $out = $this->product([
            'name' => 'نافد', 'sku' => 'OUT', 'track_inventory' => true,
            'quantity_on_hand' => 0, 'reorder_level' => 5,
        ]);
        $untracked = $this->product([
            'name' => 'خدمة', 'sku' => 'UNTRACKED', 'type' => 'service', 'track_inventory' => false,
        ]);
        $this->product([
            'name' => 'متوفر', 'sku' => 'OK', 'track_inventory' => true,
            'quantity_on_hand' => 20, 'reorder_level' => 5,
        ]);

        $lowResponse = $this->withToken($this->token)->getJson('/api/products?per_page=10&stock_state=low')->assertOk();
        $this->assertSame([$low->id], array_column($lowResponse['data'], 'id'));

        $outResponse = $this->withToken($this->token)->getJson('/api/products?per_page=10&stock_state=out')->assertOk();
        $this->assertSame([$out->id], array_column($outResponse['data'], 'id'));

        $untrackedResponse = $this->withToken($this->token)->getJson('/api/products?per_page=10&stock_state=not_tracked')->assertOk();
        $this->assertSame([$untracked->id], array_column($untrackedResponse['data'], 'id'));
    }

    /** @test */
    public function money_filters_convert_riyals_to_minor_units_without_floats(): void
    {
        $target = $this->product([
            'name' => 'هدف', 'sku' => 'PRICE-150',
            'sale_price' => 15050, 'purchase_price' => 10025,
        ]);
        $this->product([
            'name' => 'أرخص', 'sku' => 'PRICE-90',
            'sale_price' => 9000, 'purchase_price' => 7000,
        ]);

        $response = $this->withToken($this->token)->getJson(
            '/api/products?per_page=10&sale_price_gte=150.50&purchase_price_eq=100.25'
        )->assertOk();

        $this->assertSame([$target->id], array_column($response['data'], 'id'));
    }

    /** @test */
    public function page_and_per_page_are_validated(): void
    {
        $this->withToken($this->token)->getJson('/api/products?per_page=10&page=0')
            ->assertStatus(422)->assertJsonValidationErrors('page');
        $this->withToken($this->token)->getJson('/api/products?per_page=5')
            ->assertStatus(422)->assertJsonValidationErrors('per_page');
        $this->withToken($this->token)->getJson('/api/products?per_page=101')
            ->assertStatus(422)->assertJsonValidationErrors('per_page');
    }

    private function product(array $attributes): Product
    {
        return Product::create(array_merge([
            'name' => 'منتج',
            'sku' => 'SKU-'.uniqid(),
            'type' => 'good',
            'unit' => 'piece',
            'sale_price' => 10000,
            'purchase_price' => 8000,
            'tax_rate' => 15,
            'track_inventory' => false,
            'quantity_on_hand' => 0,
            'reorder_level' => 0,
            'is_active' => true,
        ], $attributes));
    }
}
