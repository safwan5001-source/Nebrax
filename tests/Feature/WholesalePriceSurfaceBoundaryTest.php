<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\StorefrontCartController;
use App\Http\Controllers\Api\StorefrontCheckoutController;
use App\Http\Controllers\Api\StorefrontOfferController;
use App\Http\Controllers\Api\StorefrontProductController;
use App\Http\Middleware\EnsureWholesalePriceAccess;
use App\Models\CommerceListing;
use App\Models\PriceList;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Services\PriceListService;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  H6 Batch G — حدود أسطح الأسعار لقنوات الجملة
 * ═══════════════════════════════════════════════════════════════
 *  (1) `/commerce/v1` تخدم قناة الجوال فقط وبمفتاح API (هوية آلة لا موافقة مشترٍ): قناة جملة موسومة لا تُخدَم أبداً
 *      ولا يوجد بديل عنها؛ (2) حارس تصنيف المسارات: كل مسار `store/v1` إما حامل أسعار ومحميّ بـ`EnsureWholesalePriceAccess`
 *      أو غير حامل ومعلَن صراحةً — مسار جديد غير مصنَّف يُفشل الاختبار فلا يُفتح باب جانبي بصمت.
 */
class WholesalePriceSurfaceBoundaryTest extends TestCase
{
    use RefreshDatabase;
    use AssertsNoAmountLeak;

    private const SECRET = 'surface-boundary-secret';

    /** مسارات `store/v1` الحاملة للأسعار — يجب أن تحمل `EnsureWholesalePriceAccess`. */
    private const PRICE_BEARING = [
        'storefront.v1.products.index', 'storefront.v1.products.show', 'storefront.v1.offers.index',
        'storefront.v1.cart.show', 'storefront.v1.cart.items.store', 'storefront.v1.cart.items.update', 'storefront.v1.cart.items.destroy',
        'storefront.v1.checkout.show', 'storefront.v1.checkout.payment_methods.index', 'storefront.v1.checkout.store',
        'storefront.v1.checkout.contact.update', 'storefront.v1.checkout.address.update', 'storefront.v1.checkout.gift.update',
        'storefront.v1.checkout.schedule.update', 'storefront.v1.checkout.delivery.update', 'storefront.v1.checkout.payment.update',
        'storefront.v1.checkout.complete',
        // H6 Batch M — the approved buyer's own order history (order lines carry prices): gated by EnsureWholesalePriceAccess
        'storefront.v1.buyer.orders.index', 'storefront.v1.buyer.orders.show',
    ];

    /**
     * مسارات `store/v1` المراجَعة والتي لا تحمل سعراً قناةً (أو تعمل على طلب قائم بمرجع موقَّع، أو هي نفسها بوابة المشتري).
     * إضافة مسار جديد هنا قرارٌ مراجَع، لا افتراض.
     */
    private const REVIEWED_NO_CHANNEL_PRICE = [
        'storefront.v1.buyer.verify_email', 'storefront.v1.buyer.verification.resend',
        // H6 Batch M — password reset reveals no channel price (neutral request; token-bound consumption)
        'storefront.v1.buyer.password.forgot', 'storefront.v1.buyer.password.reset',
        'storefront.v1.buyer.login', 'storefront.v1.buyer.logout', 'storefront.v1.buyer.register', 'storefront.v1.buyer.me',
        'storefront.v1.wholesale.access', 'storefront.v1.wholesale.application.store', 'storefront.v1.wholesale.membership.show',
        'storefront.v1.categories.index', 'storefront.v1.categories.show', 'storefront.v1.collections.index',
        'storefront.v1.delivery-schedule', 'storefront.v1.delivery_schedule.show', 'storefront.v1.storefront.show',
        'storefront.v1.policies.show', 'storefront.v1.media.category.show', 'storefront.v1.media.customizer.show',
        'storefront.v1.media.facet_visual.missing', 'storefront.v1.media.facet_visual.show', 'storefront.v1.media.show',
        'storefront.v1.media.derivative.show',
        // طلب قائم بمرجع موقَّع/نية دفع: لا يكشف سعر قناة، ومنع الدفع بعد إيقاف عضوية يترك مشترياً عالقاً (قرار F §4).
        'storefront.v1.orders.payment_status', 'storefront.v1.checkout.payment_intent.store',
    ];

    // ═══════════════════════ حارس التصنيف ═══════════════════════

    #[Test]
    public function every_store_v1_route_is_classified_and_every_price_bearing_one_is_gated(): void
    {
        $seen = [];
        foreach (Route::getRoutes() as $route) {
            $uri = $route->uri();
            if (! str_starts_with($uri, 'store/v1/') || str_contains($uri, '{tenantSlug}')) {
                continue;
            }
            $name = (string) $route->getName();
            $seen[] = $name;

            if (in_array($name, self::PRICE_BEARING, true)) {
                $this->assertContains(EnsureWholesalePriceAccess::class, $route->gatherMiddleware(), "{$name} is price-bearing but ungated");

                continue;
            }
            $this->assertContains($name, self::REVIEWED_NO_CHANNEL_PRICE, "store/v1 route [{$name}] ({$uri}) is unclassified: decide whether it can reveal a channel price, then list it as PRICE_BEARING (gated) or REVIEWED_NO_CHANNEL_PRICE");
        }

        foreach (self::PRICE_BEARING as $name) {
            $this->assertContains($name, $seen, "classified price-bearing route [{$name}] no longer exists — update the guard");
        }
    }

    #[Test]
    public function the_legacy_slug_routes_that_carry_prices_are_gated_too(): void
    {
        foreach (Route::getRoutes() as $route) {
            if (! str_contains($route->uri(), '{tenantSlug}')) {
                continue;
            }
            $action = $route->getActionName();
            if (str_contains($action, 'StorefrontProductController') || str_contains($action, 'StorefrontOfferController')
                || str_contains($action, 'StorefrontCartController') || str_contains($action, 'StorefrontCheckoutController')) {
                $this->assertContains(EnsureWholesalePriceAccess::class, $route->gatherMiddleware(), $route->uri().' ('.$action.')');
            }
        }
        $this->addToAssertionCount(1);
        $this->assertTrue(class_exists(StorefrontProductController::class) && class_exists(StorefrontOfferController::class)
            && class_exists(StorefrontCartController::class) && class_exists(StorefrontCheckoutController::class));
    }

    #[Test]
    public function commerce_v1_only_resolves_the_mobile_channel_through_the_guarded_resolver(): void
    {
        foreach (Route::getRoutes() as $route) {
            if (! str_starts_with($route->uri(), 'commerce/v1/')) {
                continue;
            }
            $mw = $route->gatherMiddleware();
            // every route on this surface authenticates a machine API client and resolves the channel server-side
            $isCustomerAuthEntry = str_starts_with($route->uri(), 'commerce/v1/auth/');
            if (! $isCustomerAuthEntry && ! in_array('App\\Http\\Middleware\\ResolveCommerceChannel', $mw, true)) {
                $this->fail('commerce/v1 route without ResolveCommerceChannel: '.$route->uri());
            }
        }
        $this->addToAssertionCount(1);
    }

    // ═══════════════════════ /commerce/v1 ═══════════════════════

    /** @return array{tenant: Tenant, channel: SalesChannel, product: Product, token: string} */
    private function mobileStore(string $slug, int $retail = 1000, ?int $listPrice = 700): array
    {
        $tenant = Tenant::create([
            'name' => $slug, 'slug' => $slug.'-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create(['slug' => 'mobile', 'name' => 'Mobile', 'type' => SalesChannel::TYPE_MOBILE, 'is_active' => true]);
        $product = Product::create(['name' => 'صنف', 'sku' => 'M-'.Str::random(6), 'unit' => 'piece', 'sale_price' => $retail, 'is_active' => true]);
        CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $channel->id, 'is_published' => true]);
        if ($listPrice !== null) {
            $list = PriceList::create(['name' => 'L '.Str::random(5), 'is_active' => true]);
            app(PriceListService::class)->upsertItem($list, $product, ['price' => $listPrice]);
            $channel->update(['default_price_list_id' => $list->id]);
        }
        app(TenantContext::class)->forget();

        $client = app(ApiClientKeyService::class)->createClient($tenant, 'mobile-app', true);
        $token = app(ApiClientKeyService::class)->issueKey($client, 'default', [])->plainTextToken;

        return compact('tenant', 'channel', 'product', 'token');
    }

    /** @return list<string> */
    private function v1Paths(Product $product): array
    {
        return ['storefront', 'products', 'products/'.$product->id, 'cart', 'checkout', 'payment-methods', 'categories', 'collections', 'experience'];
    }

    #[Test]
    public function an_unflagged_mobile_channel_is_unchanged_for_its_api_key(): void
    {
        $s = $this->mobileStore('v1-dtc');

        $this->withToken($s['token'])->getJson('/commerce/v1/products')->assertOk()->assertJsonPath('data.0.price.amount_minor', 700);
        $this->withToken($s['token'])->getJson('/commerce/v1/products/'.$s['product']->id)->assertOk()->assertJsonPath('data.price.amount_minor', 700);
    }

    #[Test]
    public function a_wholesale_flagged_mobile_channel_is_never_served_to_an_api_key_and_leaks_no_price(): void
    {
        $s = $this->mobileStore('v1-flagged');

        try {
            // nested transaction = savepoint, so a PostgreSQL CHECK violation does not poison the test transaction
            DB::transaction(fn () => DB::table('sales_channels')->where('id', $s['channel']->id)->update(['wholesale_membership_enabled' => true]));
        } catch (QueryException $e) {
            // PostgreSQL: the CHECK makes the state unrepresentable — which is the stronger guarantee.
            $this->assertSame('pgsql', DB::connection()->getDriverName());
            $this->assertStringContainsString('sales_channels_wholesale_web_only_chk', $e->getMessage());
            $this->assertFalse((bool) DB::table('sales_channels')->where('id', $s['channel']->id)->value('wholesale_membership_enabled'));

            return;
        }

        foreach ($this->v1Paths($s['product']) as $path) {
            $response = $this->withToken($s['token'])->getJson('/commerce/v1/'.$path);
            $response->assertNotFound();
            $this->assertNoAmountLeak($response->getContent(), [700, 1000], $path);
        }
        $this->withToken($s['token'])->postJson('/commerce/v1/cart/items', ['product_id' => $s['product']->id, 'quantity' => 1])->assertNotFound();
        // sorting / filtering / search cannot be used as a side channel either
        foreach (['?sort=sale_price', '?sort=-sale_price', '?search=صنف'] as $q) {
            $this->withToken($s['token'])->getJson('/commerce/v1/products'.$q)->assertNotFound();
        }
    }

    #[Test]
    public function a_flagged_canonical_mobile_channel_does_not_fall_back_to_another_mobile_channel(): void
    {
        $s = $this->mobileStore('v1-nofallback');
        app(TenantContext::class)->set($s['tenant']->id);
        $newer = SalesChannel::create(['slug' => 'mobile-2', 'name' => 'Mobile 2', 'type' => SalesChannel::TYPE_MOBILE, 'is_active' => true]);
        CommerceListing::create(['product_id' => $s['product']->id, 'sales_channel_id' => $newer->id, 'is_published' => true]);
        app(TenantContext::class)->forget();

        try {
            // nested transaction = savepoint, so a PostgreSQL CHECK violation does not poison the test transaction
            DB::transaction(fn () => DB::table('sales_channels')->where('id', $s['channel']->id)->update(['wholesale_membership_enabled' => true]));
        } catch (QueryException) {
            $this->assertSame('pgsql', DB::connection()->getDriverName());

            return;
        }

        $this->withToken($s['token'])->getJson('/commerce/v1/products')->assertNotFound();
    }

    #[Test]
    public function client_supplied_channel_or_tenant_ids_never_select_a_wholesale_channel(): void
    {
        $s = $this->mobileStore('v1-selector');                         // retail 1000, mobile list 700
        $other = $this->mobileStore('v1-other', 5000, 4000);            // another tenant

        foreach ([
            '?sales_channel_id='.$other['channel']->id, '?channel_id='.$other['channel']->id, '?tenant_id='.$other['tenant']->id,
        ] as $q) {
            $body = $this->withToken($s['token'])->withHeaders([
                'X-Sales-Channel' => $other['channel']->id, 'X-Tenant-Id' => $other['tenant']->id,
            ])->getJson('/commerce/v1/products'.$q)->assertOk()->getContent();
            $this->assertStringContainsString('700', $body);
            $this->assertNoAmountLeak($body, [4000, 5000]);
        }
        // tenant B's product is not visible to tenant A's key at all
        $this->withToken($s['token'])->getJson('/commerce/v1/products/'.$other['product']->id)->assertNotFound();
    }

    #[Test]
    public function an_api_key_is_not_wholesale_buyer_approval_on_the_store_host(): void
    {
        config(['commerce.wholesale_buyer_enabled' => true, 'storefront.gateway_secret' => self::SECRET]);
        $s = $this->mobileStore('v1-keyvsbuyer');
        app(TenantContext::class)->set($s['tenant']->id);
        $web = SalesChannel::create(['slug' => 'wholesale', 'name' => 'Wholesale', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $web->forceFill(['wholesale_membership_enabled' => true])->save();
        $storefront = Storefront::create(['slug' => 'ws', 'name' => 'WS', 'sales_channel_id' => $web->id, 'is_active' => true]);
        StorefrontDomain::create([
            'storefront_id' => $storefront->id, 'hostname' => 'keyvsbuyer.wholesale.test', 'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_active' => true, 'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        $p = Product::create(['name' => 'جملة', 'sku' => 'W-'.Str::random(6), 'unit' => 'piece', 'sale_price' => 900, 'is_active' => true]);
        CommerceListing::create(['product_id' => $p->id, 'sales_channel_id' => $web->id, 'is_published' => true]);
        app(TenantContext::class)->forget();

        // The tenant's valid API key presented as Bearer/X-Customer-Token on the wholesale host is just an unauthenticated visitor.
        foreach ([['Authorization' => 'Bearer '.$s['token']], ['X-Customer-Token' => $s['token']]] as $auth) {
            $this->withHeaders($auth)->getJson('http://keyvsbuyer.wholesale.test/store/v1/products')->assertStatus(401);
        }
    }
}
