<?php

namespace Tests\Feature;

use App\Models\StorefrontPresentation;
use App\Services\Commerce\CommercePriceResolver;
use App\Services\Commerce\StorefrontOfferResolver;
use App\Support\Commerce\StorefrontPresentationNormalizer;
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

    /** @param  array<string,mixed>  $s */
    private function storePresentation(array $s, array $draft, ?array $published): void
    {
        app(TenantContext::class)->set($s['tenantId']);
        try {
            StorefrontPresentation::create([
                'storefront_id' => $s['storefront']->id,
                'draft_config' => $draft,
                'published_config' => $published,
            ]);
        } finally {
            app(TenantContext::class)->forget();
        }
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
        $normalized = (new StorefrontPresentationNormalizer)->normalize($hostile);

        // مسوّدة خام عدائية (كما قد تصل إلى القاعدة) + منشور مطبَّع (كما يُنشر فعلاً): الحالتان معاً، والمتسوق يقرأ المنشور والـCanvas يقرأ المسوّدة
        $this->storePresentation($s, $hostile, $normalized);
        $after = $this->commerceTruth($s);

        $this->assertSame($before, $after);
    }
}
