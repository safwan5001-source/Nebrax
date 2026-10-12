<?php

namespace Tests\Feature;

use App\Services\Commerce\CommercePriceResolver;
use App\Services\Commerce\StorefrontOfferResolver;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * CUST-HV V9d-4 — جدار التجارة وقت التشغيل (V0 §14.3): وثيقة العرض العدائية، سواءٌ خُزّنت مسوّدةً أو منشورةً وسواءٌ بقيت
 * خاماً أو طُبّعت، لا تغيّر أي قيمة يُرجعها `CommercePriceResolver` أو `StorefrontOfferResolver`، ولا ما يخدمه `GET /store/v1/offers`
 * للمتجر العام. (الاختبارات الساكنة في StorefrontCommerceFirewallTest تثبت غياب الاقتران؛ هذا يثبت النتيجة.)
 *
 * تشغيل: php artisan test --filter=StorefrontCommerceFirewallRuntimeTest
 */
class StorefrontCommerceFirewallRuntimeTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use SeedsStorefrontOffers;

    private const NOW = '2026-10-15 12:00:00';

    protected function setUp(): void
    {
        parent::setUp();
        CarbonImmutable::setTestNow(CarbonImmutable::parse(self::NOW, 'UTC'));
    }

    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();
        parent::tearDown();
    }

    /** @return array<string,mixed> */
    private function hostileDocument(): array
    {
        $fixture = json_decode((string) file_get_contents(__DIR__.'/../Fixtures/presentation/commerce-firewall.json'), true, 512, JSON_THROW_ON_ERROR);

        return $fixture['input'];
    }

    /**
     * ما يراه المتسوّق ومساحة العمل (التي تغذّي الـCanvas) من الحقيقة التجارية: سعر المنتج المحسوم، وكل عرض (حيّ أو محجوب) بأسعاره،
     * وردّ العروض العام (المنشور)، وردّ مساحة العمل المصادَق (الـCanvas).
     *
     * @param  array<string,mixed>  $s
     * @return array<string,mixed>
     */
    private function commerceTruth(array $s): array
    {
        app(TenantContext::class)->set($s['tenantId']);
        try {
            $price = app(CommercePriceResolver::class)->resolve($s['product']->id, $s['channel']->id);
            $offers = array_map(static fn ($view): array => [
                'offer' => $view->offer->id,
                'live' => $view->live,
                'reason' => $view->reason,
                'referencePrice' => $view->referencePrice,
                'offerPrice' => $view->offerPrice,
                'currency' => $view->currency,
                'discountPercent' => $view->discountPercent,
            ], app(StorefrontOfferResolver::class)->allForStorefront($s['storefront']->id, $s['channel']->id));
        } finally {
            app(TenantContext::class)->forget();
        }

        $public = $this->getJson("http://{$s['host']}/store/v1/offers")->assertOk()->json('data');
        $workspace = $this->withToken($s['token'])->getJson("/api/commerce/workspace/storefronts/{$s['storefront']->id}/offers")->assertOk()->json('data');

        return ['price' => get_object_vars($price), 'offers' => $offers, 'public' => $public, 'workspace' => $workspace];
    }

    /** @return array<string,mixed> */
    private function store(): array
    {
        $auth = $this->registerTenant('fw-runtime', 'owner@fw-runtime.test');
        $tenantId = $auth['tenant_id'];
        $token = $auth['token'];
        $host = 'firewall.example.test';
        ['channel' => $channel, 'storefront' => $storefront] = $this->offerStore($tenantId, $host);
        $product = $this->offerProduct($tenantId, $channel, ['name' => 'منتج مخفَّض', 'sale_price' => 25000]);
        $this->channelPriceList($tenantId, $channel, [$product->id => 19000]);
        $offer = $this->makeOffer($tenantId, $storefront, $product);

        return compact('tenantId', 'token', 'channel', 'storefront', 'host', 'product', 'offer');
    }

    /** @test */
    public function a_hostile_presentation_changes_no_price_or_offer_value_in_draft_or_published(): void
    {
        $s = $this->store();
        $before = $this->commerceTruth($s);

        // sanity: the baseline is a real authoritative discount (25000 → 19000), not an empty comparison
        $this->assertSame(19000, $before['price']['amount']);
        $this->assertCount(1, $before['public']);
        $this->assertCount(1, $before['workspace']);

        $hostile = $this->hostileDocument();
        $presentation = "/api/commerce/workspace/storefronts/{$s['storefront']->id}/presentation";

        // 1) the real draft path (what the Canvas edits): the whole hostile document, saved through the production controller → service
        $draft = $this->withToken($s['token'])->putJson($presentation, ['config' => $hostile, 'draft_revision' => 0])->assertOk();
        $this->assertSame($before, $this->commerceTruth($s), 'saving a hostile DRAFT changed a commerce value');

        // 2) the real publish path (what the shopper reads): the same document minus what a publish legitimately gates on real media
        // (a slider / gallery / image block must reference an owned picture), saved as the draft and then published through the production path
        $publishable = $hostile;
        $publishable['homepage']['sections'] = array_values(array_filter(
            $publishable['homepage']['sections'],
            static fn (array $section): bool => ! in_array($section['type'], ['slider', 'gallery'], true),
        ));
        foreach ($publishable['homepage']['sections'] as &$section) {
            if ($section['type'] === 'customContent') {
                $section['content']['blocks'] = array_values(array_filter($section['content']['blocks'], static fn (array $block): bool => $block['kind'] !== 'image'));
            }
        }
        unset($section);
        $saved = $this->withToken($s['token'])->putJson($presentation, ['config' => $publishable, 'draft_revision' => $draft->json('data.draft_revision')])->assertOk();
        $this->withToken($s['token'])->postJson("{$presentation}/publish", ['draft_revision' => $saved->json('data.draft_revision')])->assertOk();

        $this->assertNotNull($this->withToken($s['token'])->getJson($presentation)->json('data.published'), 'the hostile document must really be published');
        $this->assertSame($before, $this->commerceTruth($s), 'publishing a hostile document changed a commerce value');
    }
}
