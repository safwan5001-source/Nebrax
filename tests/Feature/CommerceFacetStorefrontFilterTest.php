<?php

namespace Tests\Feature;

use App\Models\ApiClient;
use App\Models\Brand;
use App\Models\CommerceFacet;
use App\Models\CommerceFacetValue;
use App\Models\CommerceListing;
use App\Models\CommerceProductFacetValue;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Support\Commerce\CatalogFacetFilter;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * FLOWERS-H2 / ADR-14 — ترشيح الكتالوج العام بالأبعاد الوصفية والعلامة:
 * دلالات OR/AND، الفشل المغلق، بوابة النشر، العزل، العدّ التفريقي، `meta.brands`،
 * وتطابق مسار الجوال `commerce/v1`.
 *
 * تشغيل: php artisan test --filter=CommerceFacetStorefrontFilterTest
 */
class CommerceFacetStorefrontFilterTest extends TestCase
{
    use RefreshDatabase;

    /** @return array{tenant: Tenant, channel: SalesChannel} */
    private function seedStore(string $slug, string $type = SalesChannel::TYPE_WEB): array
    {
        $tenant = Tenant::create([
            'name' => "متجر {$slug}", 'slug' => $slug.'-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create([
            'slug' => $type, 'name' => 'قناة', 'type' => $type, 'is_active' => true,
        ]);
        app(TenantContext::class)->forget();

        return compact('tenant', 'channel');
    }

    private function product(Tenant $tenant, SalesChannel $channel, string $name, bool $published = true, array $attrs = []): Product
    {
        app(TenantContext::class)->set($tenant->id);
        $product = Product::create(array_merge([
            'sku' => 'SKU-'.Str::random(6), 'name' => $name, 'type' => 'good', 'unit' => 'piece',
            'sale_price' => 10000, 'tax_rate' => 15, 'is_active' => true,
        ], $attrs));
        if ($published) {
            CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $channel->id, 'is_published' => true]);
        }
        app(TenantContext::class)->forget();

        return $product;
    }

    /** @return array{facet: CommerceFacet, values: array<string, CommerceFacetValue>} */
    private function facet(Tenant $tenant, string $key, array $slugs, array $facetAttrs = []): array
    {
        app(TenantContext::class)->set($tenant->id);
        $facet = CommerceFacet::create(array_merge(['key' => $key, 'name' => $key], $facetAttrs));
        $values = [];
        foreach ($slugs as $i => $slug) {
            $values[$slug] = CommerceFacetValue::create([
                'commerce_facet_id' => $facet->id, 'slug' => $slug, 'name' => ucfirst($slug), 'sort_order' => $i,
            ]);
        }
        app(TenantContext::class)->forget();

        return compact('facet', 'values');
    }

    private function assign(Tenant $tenant, Product $product, CommerceFacetValue ...$values): void
    {
        app(TenantContext::class)->set($tenant->id);
        foreach ($values as $value) {
            CommerceProductFacetValue::create(['product_id' => $product->id, 'commerce_facet_value_id' => $value->id]);
        }
        app(TenantContext::class)->forget();
    }

    private function list(Tenant $tenant, string $query = ''): \Illuminate\Testing\TestResponse
    {
        return $this->getJson("/store/v1/{$tenant->slug}/products".($query !== '' ? "?{$query}" : ''))->assertOk();
    }

    private function names(\Illuminate\Testing\TestResponse $res): array
    {
        $names = collect($res->json('data'))->pluck('name')->all();
        sort($names);

        return $names;
    }

    /** @return array{tenant: Tenant, channel: SalesChannel, p: array<string, Product>, occasion: array, recipient: array} */
    private function floristFixture(): array
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->seedStore('flo');
        $occasion = $this->facet($tenant, 'occasion', ['birthday', 'graduation', 'wedding'], ['system_key' => 'occasion']);
        $recipient = $this->facet($tenant, 'recipient', ['her', 'him'], ['system_key' => 'recipient']);

        $p = [
            'roses' => $this->product($tenant, $channel, 'ورد جوري'),
            'tulips' => $this->product($tenant, $channel, 'توليب'),
            'cake' => $this->product($tenant, $channel, 'كيكة'),
            'secret' => $this->product($tenant, $channel, 'غير منشور', false),
        ];
        $this->assign($tenant, $p['roses'], $occasion['values']['birthday'], $occasion['values']['wedding'], $recipient['values']['her']);
        $this->assign($tenant, $p['tulips'], $occasion['values']['graduation'], $recipient['values']['her']);
        $this->assign($tenant, $p['cake'], $occasion['values']['birthday'], $recipient['values']['him']);
        $this->assign($tenant, $p['secret'], $occasion['values']['birthday'], $recipient['values']['her']);

        return compact('tenant', 'channel', 'p', 'occasion', 'recipient');
    }

    /** @test */
    public function values_within_one_facet_are_or_and_across_facets_are_and(): void
    {
        $f = $this->floristFixture();

        $this->assertEqualsCanonicalizing(['ورد جوري', 'كيكة'], $this->names($this->list($f['tenant'], 'facet[occasion]=birthday')));
        $this->assertEqualsCanonicalizing(['توليب', 'ورد جوري', 'كيكة'], $this->names($this->list($f['tenant'], 'facet[occasion]=birthday,graduation')));
        $this->assertEqualsCanonicalizing(['ورد جوري'], $this->names($this->list($f['tenant'], 'facet[occasion]=birthday&facet[recipient]=her')));
        $this->assertEqualsCanonicalizing(['كيكة'], $this->names($this->list($f['tenant'], 'facet[occasion]=birthday&facet[recipient]=him')));
    }

    /** @test */
    public function unknown_inactive_or_missing_facets_and_values_fail_closed_to_an_empty_list(): void
    {
        $f = $this->floristFixture();

        foreach (['facet[nope]=birthday', 'facet[occasion]=nope', 'facet[occasion]=birthday&facet[x]=y'] as $q) {
            $this->assertSame([], $this->names($this->list($f['tenant'], $q)), $q);
        }
        // قيمة مجهولة بجوار قيمة معروفة داخل البُعد نفسه: مغلق عند الفشل أيضاً (ADR-14)،
        // لا يُكتفى بالمعروفة.
        $this->assertSame([], $this->names($this->list($f['tenant'], 'facet[occasion]=birthday,nope')));

        app(TenantContext::class)->set($f['tenant']->id);
        $f['occasion']['values']['graduation']->update(['is_active' => false]);
        app(TenantContext::class)->forget();
        $this->assertEqualsCanonicalizing([], $this->names($this->list($f['tenant'], 'facet[occasion]=graduation')));

        app(TenantContext::class)->set($f['tenant']->id);
        $f['recipient']['facet']->update(['is_active' => false]);
        app(TenantContext::class)->forget();
        $this->assertEqualsCanonicalizing([], $this->names($this->list($f['tenant'], 'facet[recipient]=her')));
    }

    /** @test */
    public function an_unpublished_product_never_appears_in_results_or_counts(): void
    {
        $f = $this->floristFixture();

        $res = $this->list($f['tenant'], 'facet[recipient]=her');
        $this->assertEqualsCanonicalizing(['توليب', 'ورد جوري'], $this->names($res));

        $recipient = collect($res->json('meta.facets'))->firstWhere('key', 'recipient');
        $her = collect($recipient['values'])->firstWhere('slug', 'her');
        $this->assertSame(2, $her['count']); // 3 لو تسرّب غير المنشور
    }

    /** @test */
    public function counts_are_disjunctive_so_a_facet_selection_does_not_narrow_its_own_counts(): void
    {
        $f = $this->floristFixture();

        $res = $this->list($f['tenant'], 'facet[occasion]=birthday');
        $facets = collect($res->json('meta.facets'))->keyBy('key');

        // بُعد المناسبة: عدّه يتجاهل اختياره هو (يرى graduation رغم اختيار birthday)
        $occasion = collect($facets['occasion']['values'])->keyBy('slug');
        $this->assertSame(2, $occasion['birthday']['count']);
        $this->assertTrue($occasion['birthday']['selected']);
        $this->assertSame(1, $occasion['graduation']['count']);
        $this->assertFalse($occasion['graduation']['selected']);
        $this->assertSame(1, $occasion['wedding']['count']);

        // بُعد المُهدى إليه: يتأثر باختيار المناسبة (birthday ⇒ her:1, him:1)
        $recipient = collect($facets['recipient']['values'])->keyBy('slug');
        $this->assertSame(1, $recipient['her']['count']);
        $this->assertSame(1, $recipient['him']['count']);
    }

    /** @test */
    public function zero_count_values_are_omitted_unless_selected_and_empty_facets_are_dropped(): void
    {
        $f = $this->floristFixture();

        $res = $this->list($f['tenant'], 'facet[occasion]=wedding');
        $recipient = collect($res->json('meta.facets'))->firstWhere('key', 'recipient');
        $this->assertSame(['her'], array_column($recipient['values'], 'slug')); // him:0 مُسقَط

        // اختيار قيمة عدّها 0 يُبقيها ظاهرة (selected) كي لا يضيع الاختيار على الواجهة
        $res = $this->list($f['tenant'], 'facet[occasion]=wedding&facet[recipient]=him');
        $this->assertSame([], $res->json('data'));
        $recipient = collect($res->json('meta.facets'))->firstWhere('key', 'recipient');
        $this->assertTrue(collect($recipient['values'])->firstWhere('slug', 'him')['selected']);
    }

    /** @test */
    public function tenants_cannot_filter_or_count_each_others_catalog(): void
    {
        $a = $this->floristFixture();
        ['tenant' => $tenantB, 'channel' => $channelB] = $this->seedStore('other');
        $occasionB = $this->facet($tenantB, 'occasion', ['birthday']);
        $productB = $this->product($tenantB, $channelB, 'منتج المستأجر ب');
        $this->assign($tenantB, $productB, $occasionB['values']['birthday']);

        $resA = $this->list($a['tenant'], 'facet[occasion]=birthday');
        $this->assertNotContains('منتج المستأجر ب', $this->names($resA));
        $birthdayA = collect(collect($resA->json('meta.facets'))->firstWhere('key', 'occasion')['values'])->firstWhere('slug', 'birthday');
        $this->assertSame(2, $birthdayA['count']);

        $resB = $this->list($tenantB, 'facet[occasion]=birthday');
        $this->assertEqualsCanonicalizing(['منتج المستأجر ب'], $this->names($resB));
        $this->assertCount(1, $resB->json('meta.facets'));
        $this->assertSame(1, $resB->json('meta.facets.0.values.0.count'));
    }

    /** @test */
    public function a_store_without_facets_is_unchanged_with_empty_meta_lists(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->seedStore('plain');
        $this->product($tenant, $channel, 'منتج عادي');

        $res = $this->list($tenant);

        $this->assertEqualsCanonicalizing(['منتج عادي'], $this->names($res));
        $this->assertSame([], $res->json('meta.facets'));
        $this->assertSame([], $res->json('meta.brands'));
    }

    /** @test */
    public function brand_filter_composes_with_facets_and_meta_brands_is_disjunctive(): void
    {
        $f = $this->floristFixture();
        app(TenantContext::class)->set($f['tenant']->id);
        $brandA = Brand::create(['name' => 'علامة أ']);
        $brandB = Brand::create(['name' => 'علامة ب']);
        $f['p']['roses']->update(['brand_id' => $brandA->id]);
        $f['p']['cake']->update(['brand_id' => $brandB->id]);
        $f['p']['secret']->update(['brand_id' => $brandA->id]);
        app(TenantContext::class)->forget();

        $this->assertEqualsCanonicalizing(['ورد جوري'], $this->names($this->list($f['tenant'], "brand_id={$brandA->id}")));
        $this->assertEqualsCanonicalizing([], $this->names($this->list($f['tenant'], "brand_id={$brandB->id}&facet[recipient]=her")));

        $res = $this->list($f['tenant'], "brand_id={$brandA->id}&facet[occasion]=birthday");
        $brands = collect($res->json('meta.brands'))->keyBy('id');
        $this->assertSame(1, $brands[$brandA->id]['count']);
        $this->assertTrue($brands[$brandA->id]['selected']);
        // العدّ التفريقي: العلامة ب تظهر رغم اختيار العلامة أ (كيكة birthday)
        $this->assertSame(1, $brands[$brandB->id]['count']);
        // غير المنشور لا يدخل العدّ
        $this->assertSame(1, $brands[$brandA->id]['count']);

        // علامة مختارة بعدّاد صفر تبقى في meta.brands (ليُمكن إلغاؤها)، لا تختفي.
        $zero = collect($this->list($f['tenant'], "brand_id={$brandB->id}&facet[recipient]=her")->json('meta.brands'))->keyBy('id');
        $this->assertSame(0, $zero[$brandB->id]['count']);
        $this->assertTrue($zero[$brandB->id]['selected']);
    }

    /** @test */
    public function an_inactive_brand_filter_fails_closed(): void
    {
        $f = $this->floristFixture();
        app(TenantContext::class)->set($f['tenant']->id);
        $brand = Brand::create(['name' => 'علامة']);
        $f['p']['roses']->update(['brand_id' => $brand->id]);
        app(TenantContext::class)->forget();

        $this->assertSame(['ورد جوري'], $this->names($this->list($f['tenant'], "brand_id={$brand->id}")));

        app(TenantContext::class)->set($f['tenant']->id);
        $brand->update(['is_active' => false]);
        app(TenantContext::class)->forget();
        $this->assertSame([], $this->names($this->list($f['tenant'], "brand_id={$brand->id}")));
    }

    /** @test */
    public function malformed_filter_input_is_rejected_with_422(): void
    {
        ['tenant' => $tenant] = $this->seedStore('bad');

        $this->getJson("/store/v1/{$tenant->slug}/products?facet=birthday")->assertStatus(422);
        $this->getJson("/store/v1/{$tenant->slug}/products?brand_id=not-a-uuid")->assertStatus(422);
        $many = implode('&', array_map(fn ($i) => "facet[k{$i}]=a", range(1, 11)));
        $this->getJson("/store/v1/{$tenant->slug}/products?{$many}")->assertStatus(422);
        // أكثر من الحد من القيم في بُعد واحد: يُرفض بدل أن يُبتر فيُسقط قيمةً مجهولة صامتاً.
        $tooMany = implode(',', array_map(fn ($i) => "v{$i}", range(1, CatalogFacetFilter::MAX_SLUGS_PER_FACET + 1)));
        $this->getJson("/store/v1/{$tenant->slug}/products?facet[occasion]={$tooMany}")->assertStatus(422);
    }

    /** @test */
    public function the_mobile_commerce_catalog_has_the_same_semantics(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->seedStore('mob', SalesChannel::TYPE_MOBILE);
        $occasion = $this->facet($tenant, 'occasion', ['birthday', 'wedding']);
        $a = $this->product($tenant, $channel, 'ورد');
        $b = $this->product($tenant, $channel, 'كيك');
        $hidden = $this->product($tenant, $channel, 'مخفي', false);
        $this->assign($tenant, $a, $occasion['values']['birthday']);
        $this->assign($tenant, $b, $occasion['values']['wedding']);
        $this->assign($tenant, $hidden, $occasion['values']['birthday']);

        $service = app(ApiClientKeyService::class);
        $client = $service->createClient($tenant, 'mobile-app', true);
        $key = $service->issueKey($client, 'default', [])->plainTextToken;

        $res = $this->getJson('/commerce/v1/products?facet[occasion]=birthday', ['Authorization' => 'Bearer '.$key])->assertOk();

        $this->assertSame(['ورد'], collect($res->json('data'))->pluck('name')->all());
        $values = collect($res->json('meta.facets.0.values'))->keyBy('slug');
        $this->assertSame(1, $values['birthday']['count']);
        $this->assertSame(1, $values['wedding']['count']);
    }
}
