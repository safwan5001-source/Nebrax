<?php

namespace Tests\Feature;

use App\Models\Storefront;
use App\Models\StorefrontOffer;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use RuntimeException;
use Tests\TestCase;

/**
 * CUST-H4-6 — مخطط `storefront_offers` ونموذجه: تنسيقٌ وجدولة فقط، عزلٌ بنيوي بين
 * المستأجرين، ونافذةٌ زمنية مغلقة الطرفين بنسختيها (استعلام/ذاكرة) المتطابقتين.
 *
 * تشغيل: php artisan test --filter=StorefrontOfferModelTest
 */
class StorefrontOfferModelTest extends TestCase
{
    use RefreshDatabase;
    use SeedsStorefrontOffers;

    /** @test */
    public function the_table_can_only_express_curation_and_scheduling_never_a_price_or_discount(): void
    {
        // قائمة حصرية: أي عمود جديد (سعر/نسبة/وفر/ضريبة/هامش/مخزون) يكسر هذا الاختبار عمداً.
        $this->assertEqualsCanonicalizing(
            ['id', 'tenant_id', 'storefront_id', 'product_id', 'starts_at', 'ends_at', 'is_active', 'position', 'created_at', 'updated_at'],
            Schema::getColumnListing('storefront_offers'),
        );
    }

    /** @test */
    public function the_model_fillable_list_cannot_write_pricing_facts(): void
    {
        $this->assertEqualsCanonicalizing(
            ['tenant_id', 'storefront_id', 'product_id', 'starts_at', 'ends_at', 'is_active', 'position'],
            (new StorefrontOffer)->getFillable(),
        );
    }

    /** @test */
    public function schema_carries_the_unique_pair_and_the_read_path_indexes(): void
    {
        $indexes = collect(Schema::getIndexes('storefront_offers'))->keyBy('name');

        $this->assertTrue($indexes->has('storefront_offers_storefront_product_unique'));
        $this->assertTrue($indexes['storefront_offers_storefront_product_unique']['unique']);
        $this->assertSame(['storefront_id', 'product_id'], $indexes['storefront_offers_storefront_product_unique']['columns']);

        $this->assertSame(
            ['storefront_id', 'is_active', 'position'],
            $indexes['storefront_offers_storefront_active_position']['columns'],
        );
        $this->assertTrue($indexes->contains(fn ($i) => $i['columns'] === ['tenant_id']));
        $this->assertTrue($indexes->contains(fn ($i) => $i['columns'] === ['product_id']));
    }

    /** @test */
    public function relations_resolve_the_storefront_and_the_product(): void
    {
        $tenant = $this->publicTenant();
        ['channel' => $channel, 'storefront' => $storefront] = $this->offerStore($tenant->id);
        $product = $this->offerProduct($tenant->id, $channel);
        $offer = $this->makeOffer($tenant->id, $storefront, $product, ['position' => 3]);

        app(TenantContext::class)->set($tenant->id);
        $this->assertSame($storefront->id, $offer->storefront->id);
        $this->assertSame($product->id, $offer->product->id);
        $this->assertTrue($offer->is_active);
        $this->assertSame(3, $offer->position);
    }

    /** @test */
    public function a_storefront_product_pair_is_unique(): void
    {
        $tenant = $this->publicTenant();
        ['channel' => $channel, 'storefront' => $storefront] = $this->offerStore($tenant->id);
        $product = $this->offerProduct($tenant->id, $channel);
        $this->makeOffer($tenant->id, $storefront, $product);

        $this->expectException(UniqueConstraintViolationException::class);
        $this->makeOffer($tenant->id, $storefront, $product);
    }

    /** @test */
    public function a_foreign_tenant_product_cannot_be_attached(): void
    {
        $a = $this->publicTenant('a');
        $b = $this->publicTenant('b');
        ['storefront' => $storefrontA] = $this->offerStore($a->id);
        ['channel' => $channelB] = $this->offerStore($b->id);
        $productB = $this->offerProduct($b->id, $channelB);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('المنتج غير موجود لهذا المستأجر.');
        $this->makeOffer($a->id, $storefrontA, $productB);
    }

    /** @test */
    public function a_foreign_tenant_storefront_cannot_be_attached(): void
    {
        $a = $this->publicTenant('a');
        $b = $this->publicTenant('b');
        ['channel' => $channelA] = $this->offerStore($a->id);
        ['storefront' => $storefrontB] = $this->offerStore($b->id);
        $productA = $this->offerProduct($a->id, $channelA);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('المتجر غير موجود لهذا المستأجر.');
        $this->makeOffer($a->id, $storefrontB, $productA);
    }

    /** @test */
    public function the_tenant_scope_hides_a_foreign_offer(): void
    {
        $a = $this->publicTenant('a');
        $b = $this->publicTenant('b');
        ['channel' => $channelA, 'storefront' => $storefrontA] = $this->offerStore($a->id);
        ['channel' => $channelB, 'storefront' => $storefrontB] = $this->offerStore($b->id);
        $offerA = $this->makeOffer($a->id, $storefrontA, $this->offerProduct($a->id, $channelA));
        $offerB = $this->makeOffer($b->id, $storefrontB, $this->offerProduct($b->id, $channelB));

        app(TenantContext::class)->set($a->id);
        $this->assertSame([$offerA->id], StorefrontOffer::query()->pluck('id')->all());
        $this->assertNull(StorefrontOffer::query()->find($offerB->id));
    }

    /** @test */
    public function the_window_must_be_strictly_ordered(): void
    {
        $tenant = $this->publicTenant();
        ['channel' => $channel, 'storefront' => $storefront] = $this->offerStore($tenant->id);
        $product = $this->offerProduct($tenant->id, $channel);
        $at = CarbonImmutable::parse('2026-10-01 12:00:00', 'UTC');

        $this->expectException(RuntimeException::class);
        $this->makeOffer($tenant->id, $storefront, $product, ['starts_at' => $at, 'ends_at' => $at]);
    }

    /** @test */
    public function the_query_window_and_the_in_memory_window_agree_on_exact_boundaries(): void
    {
        $tenant = $this->publicTenant();
        ['channel' => $channel, 'storefront' => $storefront] = $this->offerStore($tenant->id);
        $now = CarbonImmutable::parse('2026-10-15 12:00:00', 'UTC');

        $cases = [
            'open-open' => [null, null, true],
            'future start' => [$now->addSecond(), null, false],
            'start == now' => [$now, null, true],
            'started' => [$now->subSecond(), null, true],
            'expired' => [null, $now->subSecond(), false],
            'end == now' => [null, $now, true],
            'ends later' => [null, $now->addSecond(), true],
            'inside' => [$now->subHour(), $now->addHour(), true],
            'ended 1s ago' => [$now->subHour(), $now->subSecond(), false],
            'starts in 1s' => [$now->addSecond(), $now->addHour(), false],
        ];

        foreach ($cases as $label => [$start, $end, $expected]) {
            $product = $this->offerProduct($tenant->id, $channel, ['name' => $label]);
            $offer = $this->makeOffer($tenant->id, $storefront, $product, ['starts_at' => $start, 'ends_at' => $end]);

            app(TenantContext::class)->set($tenant->id);
            $this->assertSame($expected, $offer->isWithinWindow($now), "in-memory: {$label}");
            $this->assertSame(
                $expected,
                StorefrontOffer::query()->whereKey($offer->id)->withinWindow($now)->exists(),
                "query: {$label}",
            );
            app(TenantContext::class)->forget();
        }
    }

    /** @test */
    public function ordering_is_position_then_created_at_then_id(): void
    {
        $tenant = $this->publicTenant();
        ['channel' => $channel, 'storefront' => $storefront] = $this->offerStore($tenant->id);

        $mk = fn (string $name, int $position, string $at) => tap(
            $this->makeOffer($tenant->id, $storefront, $this->offerProduct($tenant->id, $channel, ['name' => $name]), ['position' => $position]),
            fn ($o) => StorefrontOffer::withoutGlobalScopes()->whereKey($o->id)->update(['created_at' => $at]),
        );

        $late = $mk('late', 1, '2026-10-02 00:00:00');
        $early = $mk('early', 1, '2026-10-01 00:00:00');
        $first = $mk('first', 0, '2026-10-03 00:00:00');

        app(TenantContext::class)->set($tenant->id);
        $this->assertSame(
            [$first->id, $early->id, $late->id],
            StorefrontOffer::query()->where('storefront_id', $storefront->id)->ordered()->pluck('id')->all(),
        );
    }

    /** @test */
    public function an_offer_never_blocks_a_true_product_delete_and_is_cleaned_with_it(): void
    {
        $tenant = $this->publicTenant();
        ['channel' => $channel, 'storefront' => $storefront] = $this->offerStore($tenant->id);
        // بلا CommerceListing (المانع الحقيقي هو النشر لا العرض) — منتجٌ أُلغي نشره.
        $product = $this->offerProduct($tenant->id, $channel, [], published: false);
        $this->makeOffer($tenant->id, $storefront, $product);

        $this->assertArrayHasKey(StorefrontOffer::class, \App\Support\ProductReferenceRegistry::inClass(\App\Support\ProductReferenceRegistry::OWNED_CHILD));
        $this->assertArrayNotHasKey(StorefrontOffer::class, \App\Support\ProductReferenceRegistry::deletionBlockers());

        app(TenantContext::class)->set($tenant->id);
        app(\App\Services\ProductLifecycleService::class)->delete($product, null);

        $this->assertSame(0, StorefrontOffer::query()->count());
        $this->assertNotNull(Storefront::query()->find($storefront->id), 'the storefront itself survives');
    }

    /** @test */
    public function the_model_is_classified_company_wide_and_branch_isolation_guard_accepts_it(): void
    {
        $this->assertInstanceOf(\App\Tenancy\CompanyWide::class, new StorefrontOffer);
        $this->assertInstanceOf(\App\Tenancy\CompanyWide::class, new Storefront);
    }
}
