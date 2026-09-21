<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductOption;
use App\Models\ProductVariant;
use App\Support\DocumentLineVariantResolver;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class PosCatalogVariantDescriptorPreparationTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @return array{product: Product, variants: array<int, ProductVariant>} */
    private function productWithVariants(string $tenantId, string $name, int $variantCount): array
    {
        app(TenantContext::class)->set($tenantId);
        $product = Product::create([
            'tenant_id' => $tenantId,
            'name' => $name,
            'sku' => 'POS-DESC-'.uniqid(),
            'sale_price' => 1000,
            'is_active' => true,
        ]);
        $product->forceFill(['variant_state' => 'variant_managed'])->save();

        $color = ProductOption::create([
            'tenant_id' => $tenantId,
            'product_id' => $product->id,
            'name' => 'اللون',
            'name_key' => 'color',
            'sort_order' => 0,
        ]);
        $size = ProductOption::create([
            'tenant_id' => $tenantId,
            'product_id' => $product->id,
            'name' => 'المقاس',
            'name_key' => 'size',
            'sort_order' => 1,
        ]);

        $variants = [];
        for ($i = 0; $i < $variantCount; $i++) {
            $colorValue = $color->values()->create([
                'tenant_id' => $tenantId,
                'value' => "لون {$i}",
                'value_key' => "color-{$i}",
                'sort_order' => $i,
            ]);
            $sizeValue = $size->values()->create([
                'tenant_id' => $tenantId,
                'value' => "مقاس {$i}",
                'value_key' => "size-{$i}",
                'sort_order' => $i,
            ]);
            $variant = ProductVariant::create([
                'tenant_id' => $tenantId,
                'product_id' => $product->id,
                'sku' => 'POS-DESC-V-'.uniqid(),
                'combination_key' => "descriptor-{$i}-".uniqid(),
                'is_active' => true,
            ]);
            // نربط بالعكس عمداً: descriptor يجب أن يرتب بالخيار ثم قيمة الخيار.
            $variant->optionValues()->attach([
                $sizeValue->id => ['product_option_id' => $size->id],
                $colorValue->id => ['product_option_id' => $color->id],
            ]);
            $variants[] = $variant;
        }

        return ['product' => $product, 'variants' => $variants];
    }

    /** @test */
    public function loaded_option_values_preserve_descriptor_semantics_and_avoid_descriptor_queries(): void
    {
        $auth = $this->registerTenant('pos-descriptor-loaded', 'owner@pos-descriptor-loaded.test');
        $scene = $this->productWithVariants($auth['tenant_id'], 'متغيرات محملة', 2);
        app(TenantContext::class)->forget();

        app(TenantContext::class)->set($auth['tenant_id']);
        $loaded = ProductVariant::with('optionValues.option')->findOrFail($scene['variants'][0]->id);
        $unloaded = ProductVariant::findOrFail($scene['variants'][0]->id);
        DB::enableQueryLog();
        DB::flushQueryLog();
        $fromLoaded = DocumentLineVariantResolver::descriptorFromLoadedOptionValues($loaded);
        $loadedQueries = $this->descriptorQueries(DB::getQueryLog());
        $fromFallback = DocumentLineVariantResolver::descriptorFromLoadedOptionValues($unloaded);
        DB::disableQueryLog();
        app(TenantContext::class)->forget();

        $this->assertSame('لون 0 / مقاس 0', $fromLoaded);
        $this->assertSame($fromFallback, $fromLoaded);
        $this->assertSame(0, $loadedQueries);
    }

    /** @test */
    public function empty_and_multiple_variants_keep_independent_descriptors(): void
    {
        $auth = $this->registerTenant('pos-descriptor-values', 'owner@pos-descriptor-values.test');
        $scene = $this->productWithVariants($auth['tenant_id'], 'متغيرات مستقلة', 2);
        app(TenantContext::class)->set($auth['tenant_id']);
        $empty = ProductVariant::create([
            'tenant_id' => $auth['tenant_id'],
            'product_id' => $scene['product']->id,
            'sku' => 'POS-DESC-EMPTY-'.uniqid(),
            'combination_key' => 'empty-'.uniqid(),
            'is_active' => true,
        ]);
        $variants = ProductVariant::with('optionValues.option')->whereIn('id', [
            $scene['variants'][0]->id,
            $scene['variants'][1]->id,
            $empty->id,
        ])->get()->keyBy('id');
        app(TenantContext::class)->forget();

        $this->assertSame('لون 0 / مقاس 0', DocumentLineVariantResolver::descriptorFromLoadedOptionValues($variants[$scene['variants'][0]->id]));
        $this->assertSame('لون 1 / مقاس 1', DocumentLineVariantResolver::descriptorFromLoadedOptionValues($variants[$scene['variants'][1]->id]));
        $this->assertNull(DocumentLineVariantResolver::descriptorFromLoadedOptionValues($variants[$empty->id]));
    }

    /** @test */
    public function descriptor_query_family_is_bounded_when_active_variant_count_grows(): void
    {
        $small = $this->registerTenant('pos-descriptor-small', 'owner@pos-descriptor-small.test');
        $this->productWithVariants($small['tenant_id'], 'قليل', 3);
        app(TenantContext::class)->forget();
        $large = $this->registerTenant('pos-descriptor-large', 'owner@pos-descriptor-large.test');
        $this->productWithVariants($large['tenant_id'], 'كبير', 18);
        app(TenantContext::class)->forget();

        DB::enableQueryLog();
        DB::flushQueryLog();
        $this->withToken($small['token'])->getJson('/api/pos/products')->assertOk();
        $smallQueries = $this->descriptorQueries(DB::getQueryLog());
        DB::flushQueryLog();
        $this->withToken($large['token'])->getJson('/api/pos/products')->assertOk();
        $largeQueries = $this->descriptorQueries(DB::getQueryLog());
        DB::disableQueryLog();

        $this->assertSame($smallQueries, $largeQueries);
        $this->assertLessThanOrEqual(3, $smallQueries);
    }

    /** @param array<int, array{query:string}> $queries */
    private function descriptorQueries(array $queries): int
    {
        return count(array_filter($queries, fn (array $query) => str_contains($query['query'], 'product_variant_option_values')
            || str_contains($query['query'], 'product_option_values')
            || str_contains($query['query'], 'product_options')));
    }
}
