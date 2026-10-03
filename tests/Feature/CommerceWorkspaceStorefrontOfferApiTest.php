<?php

namespace Tests\Feature;

use App\Models\CommerceListing;
use App\Models\Product;
use App\Models\Storefront;
use App\Models\StorefrontOffer;
use App\Services\Commerce\StorefrontOfferResolver;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * CUST-H4-6 — تهيئة العروض (CRUD) لمساحة عمل Commerce: عزل المستأجر/المتجر،
 * ملكية غير كاشفة (404)، رفض أي حقل سعر/خصم/هوية، نافذة زمنية، تكرار صريح، سقف،
 * وRBAC. القراءة تعيد حالة كل مرشّح (حيّ أو سبب الحجب) من المُحلِّل نفسه.
 *
 * تشغيل: php artisan test --filter=CommerceWorkspaceStorefrontOfferApiTest
 */
class CommerceWorkspaceStorefrontOfferApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use SeedsStorefrontOffers;

    protected function setUp(): void
    {
        parent::setUp();
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-15 12:00:00', 'UTC'));
    }

    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();
        parent::tearDown();
    }

    private function path(string $storefrontId, ?string $offerId = null): string
    {
        return "/api/commerce/workspace/storefronts/{$storefrontId}/offers".($offerId ? "/{$offerId}" : '');
    }

    /** @return array{auth: array, channel: \App\Models\SalesChannel, storefront: Storefront} */
    private function merchant(string $slug): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        $seed = $this->offerStore($auth['tenant_id']);

        return ['auth' => $auth] + $seed;
    }

    private function rows(string $tenantId, ?string $storefrontId = null): int
    {
        return StorefrontOffer::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->when($storefrontId, fn ($q) => $q->where('storefront_id', $storefrontId))
            ->count();
    }

    // ───────────────────────── Create ─────────────────────────

    /** @test */
    public function create_defaults_to_active_appended_and_returns_the_evaluation(): void
    {
        $m = $this->merchant('off-create');
        $p1 = $this->offerProduct($m['auth']['tenant_id'], $m['channel'], ['name' => 'أول']);
        $p2 = $this->offerProduct($m['auth']['tenant_id'], $m['channel'], ['name' => 'ثانٍ']);

        $r1 = $this->withToken($m['auth']['token'])->postJson($this->path($m['storefront']->id), ['product_id' => $p1->id])
            ->assertCreated()
            ->assertJsonPath('data.product_id', $p1->id)
            ->assertJsonPath('data.is_active', true)
            ->assertJsonPath('data.position', 0)
            ->assertJsonPath('data.starts_at', null)
            ->assertJsonPath('data.product.name', 'أول')
            ->assertJsonPath('data.evaluation.is_live', false)
            ->assertJsonPath('data.evaluation.reason', 'not_discounted');
        $this->assertTrue(Str::isUuid($r1->json('data.id')));

        $this->withToken($m['auth']['token'])->postJson($this->path($m['storefront']->id), ['product_id' => $p2->id])
            ->assertCreated()->assertJsonPath('data.position', 1);
    }

    /** @test */
    public function create_accepts_every_merchant_field_and_stores_utc(): void
    {
        $m = $this->merchant('off-full');
        $p = $this->offerProduct($m['auth']['tenant_id'], $m['channel']);

        $this->withToken($m['auth']['token'])->postJson($this->path($m['storefront']->id), [
            'product_id' => $p->id, 'is_active' => false, 'position' => 7,
            'starts_at' => '2026-10-20T10:00:00+03:00', 'ends_at' => '2026-10-25T00:00:00Z',
        ])->assertCreated()
            ->assertJsonPath('data.is_active', false)
            ->assertJsonPath('data.position', 7)
            ->assertJsonPath('data.starts_at', '2026-10-20T07:00:00+00:00')
            ->assertJsonPath('data.ends_at', '2026-10-25T00:00:00+00:00')
            ->assertJsonPath('data.evaluation.reason', 'inactive');
    }

    /** @test */
    public function create_validation_rejects_bad_input(): void
    {
        $m = $this->merchant('off-validate');
        $p = $this->offerProduct($m['auth']['tenant_id'], $m['channel']);
        $url = $this->path($m['storefront']->id);
        $t = $m['auth']['token'];

        $this->withToken($t)->postJson($url, [])->assertUnprocessable()->assertJsonValidationErrors('product_id');
        $this->withToken($t)->postJson($url, ['product_id' => 'nope'])->assertUnprocessable()->assertJsonValidationErrors('product_id');
        $this->withToken($t)->postJson($url, ['product_id' => $p->id, 'position' => -1])->assertUnprocessable()->assertJsonValidationErrors('position');
        $this->withToken($t)->postJson($url, ['product_id' => $p->id, 'position' => StorefrontOfferServiceMax::value() + 1])->assertUnprocessable()->assertJsonValidationErrors('position');
        $this->withToken($t)->postJson($url, ['product_id' => $p->id, 'position' => 'x'])->assertUnprocessable()->assertJsonValidationErrors('position');
        $this->withToken($t)->postJson($url, ['product_id' => $p->id, 'is_active' => 'maybe'])->assertUnprocessable()->assertJsonValidationErrors('is_active');
        $this->withToken($t)->postJson($url, ['product_id' => $p->id, 'starts_at' => 'not-a-date'])->assertUnprocessable()->assertJsonValidationErrors('starts_at');

        $this->assertSame(0, $this->rows($m['auth']['tenant_id']));
    }

    /** @test */
    public function an_invalid_time_window_is_rejected(): void
    {
        $m = $this->merchant('off-window');
        $p = $this->offerProduct($m['auth']['tenant_id'], $m['channel']);
        $t = $m['auth']['token'];

        $this->withToken($t)->postJson($this->path($m['storefront']->id), [
            'product_id' => $p->id, 'starts_at' => '2026-10-20T00:00:00Z', 'ends_at' => '2026-10-19T00:00:00Z',
        ])->assertUnprocessable()->assertJsonValidationErrors('ends_at');

        $this->withToken($t)->postJson($this->path($m['storefront']->id), [
            'product_id' => $p->id, 'starts_at' => '2026-10-20T00:00:00Z', 'ends_at' => '2026-10-20T00:00:00Z',
        ])->assertUnprocessable()->assertJsonValidationErrors('ends_at');

        // التعادل بتوقيتين مختلفين لنفس اللحظة أيضاً مرفوض.
        $this->withToken($t)->postJson($this->path($m['storefront']->id), [
            'product_id' => $p->id, 'starts_at' => '2026-10-20T03:00:00+03:00', 'ends_at' => '2026-10-20T00:00:00Z',
        ])->assertUnprocessable();

        $this->assertSame(0, $this->rows($m['auth']['tenant_id']));
    }

    /**
     * @test
     *
     * @dataProvider forbiddenFields
     */
    public function price_discount_and_identity_fields_are_rejected_not_silently_ignored(string $field, mixed $value): void
    {
        $m = $this->merchant('off-forbid-'.str_replace('_', '-', $field));
        $p = $this->offerProduct($m['auth']['tenant_id'], $m['channel']);

        $this->withToken($m['auth']['token'])->postJson($this->path($m['storefront']->id), ['product_id' => $p->id, $field => $value])
            ->assertUnprocessable()->assertJsonValidationErrors($field);

        $this->assertSame(0, $this->rows($m['auth']['tenant_id']), 'a rejected request must persist nothing');
    }

    public static function forbiddenFields(): array
    {
        return [
            'price' => ['price', 100], 'discount' => ['discount', 10], 'percent' => ['percent', 20],
            'discount_percent' => ['discount_percent', 20], 'sale_price' => ['sale_price', 1], 'original_price' => ['original_price', 5],
            'price_list_id' => ['price_list_id', 'x'], 'tenant_id' => ['tenant_id', 'x'], 'storefront_id' => ['storefront_id', 'x'],
            'sales_channel_id' => ['sales_channel_id', 'x'],
        ];
    }

    /** @test */
    public function update_also_rejects_price_and_identity_fields(): void
    {
        $m = $this->merchant('off-forbid-update');
        $p = $this->offerProduct($m['auth']['tenant_id'], $m['channel']);
        $offer = $this->makeOffer($m['auth']['tenant_id'], $m['storefront'], $p);

        foreach (['discount' => 5, 'price' => 1, 'tenant_id' => (string) Str::uuid(), 'storefront_id' => (string) Str::uuid()] as $field => $value) {
            $this->withToken($m['auth']['token'])->patchJson($this->path($m['storefront']->id, $offer->id), [$field => $value])
                ->assertUnprocessable()->assertJsonValidationErrors($field);
        }
    }

    /** @test */
    public function a_product_already_configured_on_the_storefront_is_an_explicit_409(): void
    {
        $m = $this->merchant('off-dup');
        $p = $this->offerProduct($m['auth']['tenant_id'], $m['channel']);
        $t = $m['auth']['token'];

        $first = $this->withToken($t)->postJson($this->path($m['storefront']->id), ['product_id' => $p->id])->assertCreated();
        $this->withToken($t)->postJson($this->path($m['storefront']->id), ['product_id' => $p->id])->assertStatus(409);
        $this->assertSame(1, $this->rows($m['auth']['tenant_id']));

        // بعد الحذف يمكن إعادة التهيئة.
        $this->withToken($t)->deleteJson($this->path($m['storefront']->id, $first->json('data.id')))->assertOk();
        $this->withToken($t)->postJson($this->path($m['storefront']->id), ['product_id' => $p->id])->assertCreated();
    }

    /** @test */
    public function the_same_product_may_be_configured_on_two_storefronts_of_one_tenant(): void
    {
        $m = $this->merchant('off-two');
        $second = $this->offerStore($m['auth']['tenant_id'], null, 'web-b');
        $p = $this->offerProduct($m['auth']['tenant_id'], $m['channel']);
        // منشور على قناة المتجر الثاني أيضاً
        app(TenantContext::class)->set($m['auth']['tenant_id']);
        CommerceListing::create(['product_id' => $p->id, 'sales_channel_id' => $second['channel']->id, 'is_published' => true]);
        app(TenantContext::class)->forget();

        $this->withToken($m['auth']['token'])->postJson($this->path($m['storefront']->id), ['product_id' => $p->id])->assertCreated();
        $this->withToken($m['auth']['token'])->postJson($this->path($second['storefront']->id), ['product_id' => $p->id])->assertCreated();
    }

    // ───────────────────────── Product eligibility ─────────────────────────

    /** @test */
    public function ineligible_products_are_rejected_with_one_uniform_message_that_leaks_nothing(): void
    {
        $m = $this->merchant('off-elig');
        $other = $this->merchant('off-elig-other');
        $tid = $m['auth']['tenant_id'];

        $foreign = $this->offerProduct($other['auth']['tenant_id'], $other['channel'], ['name' => 'سرّي أجنبي']);
        $unpublished = $this->offerProduct($tid, $m['channel'], [], published: false);
        $inactive = $this->offerProduct($tid, $m['channel'], ['is_active' => false]);
        $otherChannel = $this->offerStore($tid, null, 'web-x');
        $elsewhere = $this->offerProduct($tid, $otherChannel['channel']); // published only on another channel
        $ghost = (string) Str::uuid();

        $messages = [];
        foreach ([$foreign->id, $unpublished->id, $inactive->id, $elsewhere->id, $ghost] as $productId) {
            $res = $this->withToken($m['auth']['token'])->postJson($this->path($m['storefront']->id), ['product_id' => $productId])
                ->assertUnprocessable()->assertJsonValidationErrors('product_id');
            $messages[] = $res->json('errors.product_id.0');
            $this->assertStringNotContainsString('أجنبي', $res->getContent());
        }

        $this->assertCount(1, array_unique($messages), 'foreign / missing / unpublished / inactive / other-channel must be indistinguishable');
        $this->assertSame(0, $this->rows($tid));
        $this->assertSame(0, $this->rows($other['auth']['tenant_id']));
    }

    /** @test */
    public function a_variant_managed_product_is_rejected_at_configuration_time(): void
    {
        $m = $this->merchant('off-variant');
        [$product] = $this->variantOfferProduct($m['auth']['tenant_id'], $m['channel']);

        $this->withToken($m['auth']['token'])->postJson($this->path($m['storefront']->id), ['product_id' => $product->id])
            ->assertUnprocessable()->assertJsonValidationErrors('product_id');
        $this->assertSame(0, $this->rows($m['auth']['tenant_id']));
    }

    /** @test */
    public function the_per_storefront_cap_is_enforced(): void
    {
        $m = $this->merchant('off-cap');
        $max = StorefrontOfferResolver::MAX_OFFERS_PER_STOREFRONT;
        for ($i = 0; $i < $max; $i++) {
            $p = $this->offerProduct($m['auth']['tenant_id'], $m['channel']);
            $this->withToken($m['auth']['token'])->postJson($this->path($m['storefront']->id), ['product_id' => $p->id])->assertCreated();
        }

        $extra = $this->offerProduct($m['auth']['tenant_id'], $m['channel']);
        $this->withToken($m['auth']['token'])->postJson($this->path($m['storefront']->id), ['product_id' => $extra->id])
            ->assertUnprocessable()->assertJsonValidationErrors('product_id');
        $this->assertSame($max, $this->rows($m['auth']['tenant_id']));
    }

    // ───────────────────────── List / evaluation ─────────────────────────

    /** @test */
    public function list_returns_config_and_the_truthful_state_of_every_candidate(): void
    {
        $m = $this->merchant('off-list');
        $tid = $m['auth']['tenant_id'];
        $now = CarbonImmutable::now('UTC');

        $live = $this->offerProduct($tid, $m['channel'], ['name' => 'حيّ', 'sale_price' => 25000]);
        $flat = $this->offerProduct($tid, $m['channel'], ['name' => 'بلا خصم']);
        $future = $this->offerProduct($tid, $m['channel'], ['name' => 'قادم']);
        $past = $this->offerProduct($tid, $m['channel'], ['name' => 'منتهٍ']);
        $off = $this->offerProduct($tid, $m['channel'], ['name' => 'مُعطَّل']);
        $gone = $this->offerProduct($tid, $m['channel'], ['name' => 'سُحب']);
        $this->channelPriceList($tid, $m['channel'], [$live->id => 19000, $future->id => 100, $past->id => 100, $off->id => 100, $gone->id => 100]);

        $this->makeOffer($tid, $m['storefront'], $live, ['position' => 0]);
        $this->makeOffer($tid, $m['storefront'], $flat, ['position' => 1]);
        $this->makeOffer($tid, $m['storefront'], $future, ['position' => 2, 'starts_at' => $now->addDay()]);
        $this->makeOffer($tid, $m['storefront'], $past, ['position' => 3, 'ends_at' => $now->subDay()]);
        $this->makeOffer($tid, $m['storefront'], $off, ['position' => 4, 'is_active' => false]);
        $this->makeOffer($tid, $m['storefront'], $gone, ['position' => 5]);
        app(TenantContext::class)->set($tid);
        CommerceListing::query()->where('product_id', $gone->id)->update(['is_published' => false]);
        app(TenantContext::class)->forget();

        $res = $this->withToken($m['auth']['token'])->getJson($this->path($m['storefront']->id))->assertOk();
        $rows = collect($res->json('data'));

        $this->assertSame(
            ['حيّ', 'بلا خصم', 'قادم', 'منتهٍ', 'مُعطَّل', 'سُحب'],
            $rows->pluck('product.name')->all(),
        );
        $this->assertSame(
            [null, 'not_discounted', 'scheduled', 'expired', 'inactive', 'product_unavailable'],
            $rows->pluck('evaluation.reason')->all(),
        );
        $this->assertSame([true, false, false, false, false, false], $rows->pluck('evaluation.is_live')->all());
        $this->assertSame(25000, $rows[0]['evaluation']['reference_price']['amount_minor']);
        $this->assertSame(19000, $rows[0]['evaluation']['offer_price']['amount_minor']);
        $this->assertNull($rows[1]['evaluation']['offer_price']);
        $this->assertSame(StorefrontOfferResolver::MAX_OFFERS_PER_STOREFRONT, $res->json('meta.max_offers'));
    }

    /** @test */
    public function list_shows_a_variant_managed_candidate_as_blocked_not_hidden(): void
    {
        $m = $this->merchant('off-list-variant');
        [$product] = $this->variantOfferProduct($m['auth']['tenant_id'], $m['channel']);
        $this->makeOffer($m['auth']['tenant_id'], $m['storefront'], $product); // direct: bypasses service gate

        $this->withToken($m['auth']['token'])->getJson($this->path($m['storefront']->id))->assertOk()
            ->assertJsonPath('data.0.evaluation.reason', 'variant_managed')
            ->assertJsonPath('data.0.product.is_variant_managed', true);
    }

    /** @test */
    public function workspace_live_set_equals_the_public_resolver_live_set(): void
    {
        $m = $this->merchant('off-parity');
        $tid = $m['auth']['tenant_id'];
        $a = $this->offerProduct($tid, $m['channel']);
        $b = $this->offerProduct($tid, $m['channel']);
        $this->channelPriceList($tid, $m['channel'], [$a->id => 100]);
        $this->makeOffer($tid, $m['storefront'], $a);
        $this->makeOffer($tid, $m['storefront'], $b);

        $workspaceLive = collect($this->withToken($m['auth']['token'])->getJson($this->path($m['storefront']->id))->json('data'))
            ->where('evaluation.is_live', true)->pluck('id')->all();

        app(TenantContext::class)->set($tid);
        $publicLive = collect(app(StorefrontOfferResolver::class)->liveForStorefront($m['storefront']->id, $m['channel']->id))
            ->map(fn ($v) => $v->offer->id)->all();

        $this->assertSame($workspaceLive, $publicLive);
        $this->assertCount(1, $publicLive);
    }

    // ───────────────────────── Update ─────────────────────────

    /** @test */
    public function update_is_partial_and_null_clears_the_window_bounds(): void
    {
        $m = $this->merchant('off-update');
        $p = $this->offerProduct($m['auth']['tenant_id'], $m['channel']);
        $offer = $this->makeOffer($m['auth']['tenant_id'], $m['storefront'], $p, [
            'starts_at' => CarbonImmutable::parse('2026-10-01', 'UTC'), 'ends_at' => CarbonImmutable::parse('2026-10-30', 'UTC'), 'position' => 4,
        ]);
        $url = $this->path($m['storefront']->id, $offer->id);
        $t = $m['auth']['token'];

        $this->withToken($t)->patchJson($url, ['position' => 9])->assertOk()
            ->assertJsonPath('data.position', 9)
            ->assertJsonPath('data.starts_at', '2026-10-01T00:00:00+00:00')
            ->assertJsonPath('data.ends_at', '2026-10-30T00:00:00+00:00')
            ->assertJsonPath('data.product_id', $p->id);

        $this->withToken($t)->patchJson($url, ['ends_at' => null, 'is_active' => false])->assertOk()
            ->assertJsonPath('data.ends_at', null)
            ->assertJsonPath('data.is_active', false)
            ->assertJsonPath('data.starts_at', '2026-10-01T00:00:00+00:00');
    }

    /** @test */
    public function update_validates_the_window_against_the_stored_bound(): void
    {
        $m = $this->merchant('off-update-window');
        $p = $this->offerProduct($m['auth']['tenant_id'], $m['channel']);
        $offer = $this->makeOffer($m['auth']['tenant_id'], $m['storefront'], $p, ['starts_at' => CarbonImmutable::parse('2026-10-10', 'UTC')]);

        $this->withToken($m['auth']['token'])->patchJson($this->path($m['storefront']->id, $offer->id), ['ends_at' => '2026-10-09T00:00:00Z'])
            ->assertUnprocessable()->assertJsonValidationErrors('ends_at');
    }

    /** @test */
    public function update_can_change_the_product_with_the_same_rules_and_a_duplicate_is_409(): void
    {
        $m = $this->merchant('off-update-product');
        $tid = $m['auth']['tenant_id'];
        $p1 = $this->offerProduct($tid, $m['channel']);
        $p2 = $this->offerProduct($tid, $m['channel']);
        $bad = $this->offerProduct($tid, $m['channel'], [], published: false);
        $o1 = $this->makeOffer($tid, $m['storefront'], $p1);
        $this->makeOffer($tid, $m['storefront'], $p2);
        $url = $this->path($m['storefront']->id, $o1->id);

        $this->withToken($m['auth']['token'])->patchJson($url, ['product_id' => $p2->id])->assertStatus(409);
        $this->withToken($m['auth']['token'])->patchJson($url, ['product_id' => $bad->id])->assertUnprocessable()->assertJsonValidationErrors('product_id');
        $this->assertSame($p1->id, $o1->fresh()->product_id);

        // نفس المنتج ليس تكراراً مع نفسه.
        $this->withToken($m['auth']['token'])->patchJson($url, ['product_id' => $p1->id, 'position' => 2])->assertOk();
    }

    /** @test */
    public function a_merchant_can_still_deactivate_or_delete_an_offer_whose_product_left_publication(): void
    {
        $m = $this->merchant('off-unpublished-later');
        $p = $this->offerProduct($m['auth']['tenant_id'], $m['channel']);
        $offer = $this->makeOffer($m['auth']['tenant_id'], $m['storefront'], $p);
        app(TenantContext::class)->set($m['auth']['tenant_id']);
        CommerceListing::query()->where('product_id', $p->id)->update(['is_published' => false]);
        app(TenantContext::class)->forget();

        $this->withToken($m['auth']['token'])->patchJson($this->path($m['storefront']->id, $offer->id), ['is_active' => false])->assertOk();
        $this->withToken($m['auth']['token'])->deleteJson($this->path($m['storefront']->id, $offer->id))->assertOk();
    }

    // ───────────────────────── Delete ─────────────────────────

    /** @test */
    public function delete_removes_the_row_and_a_second_delete_is_404(): void
    {
        $m = $this->merchant('off-delete');
        $p = $this->offerProduct($m['auth']['tenant_id'], $m['channel']);
        $offer = $this->makeOffer($m['auth']['tenant_id'], $m['storefront'], $p);
        $url = $this->path($m['storefront']->id, $offer->id);

        $this->withToken($m['auth']['token'])->deleteJson($url)->assertOk()->assertJsonPath('data.deleted', true);
        $this->assertSame(0, $this->rows($m['auth']['tenant_id']));
        $this->withToken($m['auth']['token'])->deleteJson($url)->assertNotFound();
    }

    // ───────────────────────── Tenant / storefront isolation ─────────────────────────

    /** @test */
    public function tenant_a_gets_a_non_revealing_404_for_every_verb_on_tenant_bs_storefront(): void
    {
        $a = $this->merchant('off-iso-a');
        $b = $this->merchant('off-iso-b');
        $pA = $this->offerProduct($a['auth']['tenant_id'], $a['channel']);
        $pB = $this->offerProduct($b['auth']['tenant_id'], $b['channel']);
        $offerB = $this->makeOffer($b['auth']['tenant_id'], $b['storefront'], $pB);
        $t = $a['auth']['token'];

        $this->withToken($t)->getJson($this->path($b['storefront']->id))->assertNotFound();
        $this->withToken($t)->postJson($this->path($b['storefront']->id), ['product_id' => $pA->id])->assertNotFound();
        $this->withToken($t)->patchJson($this->path($b['storefront']->id, $offerB->id), ['position' => 5])->assertNotFound();
        $this->withToken($t)->deleteJson($this->path($b['storefront']->id, $offerB->id))->assertNotFound();

        $this->assertSame(1, $this->rows($b['auth']['tenant_id']));
        $this->assertSame(0, $this->rows($a['auth']['tenant_id']));
        $this->assertSame(0, $offerB->fresh()->position);
    }

    /** @test */
    public function a_foreign_or_unknown_storefront_is_indistinguishable(): void
    {
        $a = $this->merchant('off-indist-a');
        $b = $this->merchant('off-indist-b');

        $foreign = $this->withToken($a['auth']['token'])->getJson($this->path($b['storefront']->id));
        $unknown = $this->withToken($a['auth']['token'])->getJson($this->path((string) Str::uuid()));

        $this->assertSame($foreign->status(), $unknown->status());
        $this->assertSame($foreign->json('message'), $unknown->json('message'));
    }

    /** @test */
    public function tenant_a_cannot_touch_tenant_bs_offer_id_through_its_own_storefront(): void
    {
        $a = $this->merchant('off-cross-a');
        $b = $this->merchant('off-cross-b');
        $offerB = $this->makeOffer($b['auth']['tenant_id'], $b['storefront'], $this->offerProduct($b['auth']['tenant_id'], $b['channel']));

        $this->withToken($a['auth']['token'])->patchJson($this->path($a['storefront']->id, $offerB->id), ['position' => 3])->assertNotFound();
        $this->withToken($a['auth']['token'])->deleteJson($this->path($a['storefront']->id, $offerB->id))->assertNotFound();
        $this->assertNotNull(StorefrontOffer::withoutGlobalScopes()->find($offerB->id));
        $this->assertSame(0, $offerB->fresh()->position);
    }

    /** @test */
    public function an_offer_of_a_sibling_storefront_in_the_same_tenant_is_invisible_and_untouchable(): void
    {
        $m = $this->merchant('off-sibling');
        $tid = $m['auth']['tenant_id'];
        $second = $this->offerStore($tid, null, 'web-b');
        $p = $this->offerProduct($tid, $second['channel']);
        $siblingOffer = $this->makeOffer($tid, $second['storefront'], $p);
        $t = $m['auth']['token'];

        $this->withToken($t)->getJson($this->path($m['storefront']->id))->assertOk()->assertJsonPath('data', []);
        $this->withToken($t)->patchJson($this->path($m['storefront']->id, $siblingOffer->id), ['is_active' => false])->assertNotFound();
        $this->withToken($t)->deleteJson($this->path($m['storefront']->id, $siblingOffer->id))->assertNotFound();
        $this->assertTrue($siblingOffer->fresh()->is_active);

        // ومنتجٌ منشور على قناة المتجر الآخر فقط لا يُهيَّأ على هذا المتجر.
        $this->withToken($t)->postJson($this->path($m['storefront']->id), ['product_id' => $p->id])->assertUnprocessable();
    }

    /** @test */
    public function a_soft_deleted_storefront_is_404(): void
    {
        $m = $this->merchant('off-softdel');
        app(TenantContext::class)->set($m['auth']['tenant_id']);
        $m['storefront']->delete();
        app(TenantContext::class)->forget();

        $this->withToken($m['auth']['token'])->getJson($this->path($m['storefront']->id))->assertNotFound();
    }

    // ───────────────────────── Auth / RBAC ─────────────────────────

    /** @test */
    public function unauthenticated_requests_are_rejected(): void
    {
        $m = $this->merchant('off-anon');

        $this->getJson($this->path($m['storefront']->id))->assertUnauthorized();
        $this->postJson($this->path($m['storefront']->id), [])->assertUnauthorized();
    }

    /** @test */
    public function only_commerce_manage_holders_may_use_it_and_self_service_is_denied(): void
    {
        $m = $this->merchant('off-rbac');
        $p = $this->offerProduct($m['auth']['tenant_id'], $m['channel']);
        $offer = $this->makeOffer($m['auth']['tenant_id'], $m['storefront'], $p);

        foreach (['staff', 'self_service'] as $role) {
            $token = $this->tokenForRole($m['auth']['tenant_id'], $role, "{$role}@off-rbac.test");
            $this->withToken($token)->getJson($this->path($m['storefront']->id))->assertForbidden();
            $this->withToken($token)->postJson($this->path($m['storefront']->id), ['product_id' => $p->id])->assertForbidden();
            $this->withToken($token)->patchJson($this->path($m['storefront']->id, $offer->id), ['position' => 1])->assertForbidden();
            $this->withToken($token)->deleteJson($this->path($m['storefront']->id, $offer->id))->assertForbidden();
        }
        $this->assertSame(1, $this->rows($m['auth']['tenant_id']));
    }

    // ───────────────────────── No financial / pricing side effects ─────────────────────────

    /** @test */
    public function configuring_offers_changes_no_price_product_or_pricing_row(): void
    {
        $m = $this->merchant('off-nosidefx');
        $tid = $m['auth']['tenant_id'];
        $p = $this->offerProduct($tid, $m['channel'], ['sale_price' => 25000]);
        $list = $this->channelPriceList($tid, $m['channel'], [$p->id => 19000]);

        $snapshot = fn () => [
            Product::withoutGlobalScopes()->find($p->id)->only(['sale_price', 'discount', 'discount_type', 'min_sale_price']),
            \App\Models\PriceListItem::withoutGlobalScopes()->where('price_list_id', $list->id)->orderBy('id')->get(['product_id', 'price', 'unit_name'])->toArray(),
            \Illuminate\Support\Facades\DB::table('journal_entries')->count(),
            \Illuminate\Support\Facades\DB::table('invoices')->count(),
        ];
        $before = $snapshot();

        $res = $this->withToken($m['auth']['token'])->postJson($this->path($m['storefront']->id), ['product_id' => $p->id])->assertCreated();
        $this->withToken($m['auth']['token'])->patchJson($this->path($m['storefront']->id, $res->json('data.id')), ['position' => 3])->assertOk();
        $this->withToken($m['auth']['token'])->deleteJson($this->path($m['storefront']->id, $res->json('data.id')))->assertOk();

        $this->assertSame($before, $snapshot());
    }
}

/** يتفادى ترميز السقف حرفياً في الاختبار. */
final class StorefrontOfferServiceMax
{
    public static function value(): int
    {
        return \App\Services\Commerce\StorefrontOfferService::MAX_POSITION;
    }
}
