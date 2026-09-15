<?php

namespace Tests\Feature;

use App\Models\CommerceCheckout;
use App\Models\CommerceListing;
use App\Models\CommerceOrder;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Models\Warehouse;
use App\Services\Commerce\CommerceCartService;
use App\Services\Commerce\FulfillmentPolicyService;
use App\Services\ProductVariantService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  VAR-COM-1 — Storefront/Cart/Checkout متعدد الخيارات
 * ═══════════════════════════════════════════════════════════════
 *  يغطّي: كتالوج المتجر يعرض متغيّرات المنتج النشطة (وصفٌ/سعرٌ/توفّرٌ لكل
 *  منها)، هويّة سطر السلة (منتج+متغيّرٌ اختياري+وحدة)، حواجز الإضافة/الإتمام
 *  (تركيبة خاطئة/عزل مستأجر/متغيّرٌ معطَّل)، عزل مخزون الأشقاء، ولقطة السطر
 *  التاريخية على CommerceOrderLine.
 */
class StorefrontVariantCommerceTest extends TestCase
{
    use RefreshDatabase;

    private const SECRET = 'com-var-gateway-secret';

    /** @return array{tenant: Tenant, channel: SalesChannel, storefront: Storefront, domain: StorefrontDomain} */
    private function store(string $host): array
    {
        $tenant = Tenant::create([
            'name' => $host, 'slug' => 'comvar-'.Str::random(8),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create([
            'slug' => 'web', 'name' => 'Web', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        $storefront = Storefront::create([
            'slug' => 'main', 'name' => 'Main', 'sales_channel_id' => $channel->id, 'is_active' => true,
        ]);
        $domain = StorefrontDomain::create([
            'storefront_id' => $storefront->id, 'hostname' => $host,
            'type' => StorefrontDomain::TYPE_CUSTOM, 'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        app(TenantContext::class)->forget();

        return compact('tenant', 'channel', 'storefront', 'domain');
    }

    /**
     * منتجٌ متعدد الخيارات بمتغيّرين نشطين: أسود/كبير وأبيض/صغير — سعرٌ
     * صريحٌ مختلفٌ لكلٍّ منهما، منشورٌ على القناة. مطابقٌ لهيكل
     * `PosVariantCheckoutTest::variantManagedProduct()` عمداً (VAR-POS-1) —
     * نفس السلطة، نفس التركيب.
     *
     * @return array{0: Product, 1: ProductVariant, 2: ProductVariant}
     */
    private function variantManagedProduct(Tenant $tenant, SalesChannel $channel, string $sku = 'SHIRT-1', bool $published = true): array
    {
        app(TenantContext::class)->set($tenant->id);
        $tenantId = $tenant->id;

        $product = Product::create([
            'name' => 'قميص', 'sku' => $sku, 'sale_price' => 20000,
            'unit' => 'piece', 'is_active' => true,
        ]);

        $color = $product->options()->create(['tenant_id' => $tenantId, 'name' => 'اللون', 'name_key' => 'اللون', 'sort_order' => 0]);
        $black = $color->values()->create(['tenant_id' => $tenantId, 'value' => 'أسود', 'value_key' => 'أسود', 'sort_order' => 0]);
        $white = $color->values()->create(['tenant_id' => $tenantId, 'value' => 'أبيض', 'value_key' => 'أبيض', 'sort_order' => 1]);

        $size = $product->options()->create(['tenant_id' => $tenantId, 'name' => 'المقاس', 'name_key' => 'المقاس', 'sort_order' => 1]);
        $large = $size->values()->create(['tenant_id' => $tenantId, 'value' => 'كبير', 'value_key' => 'كبير', 'sort_order' => 0]);
        $small = $size->values()->create(['tenant_id' => $tenantId, 'value' => 'صغير', 'value_key' => 'صغير', 'sort_order' => 1]);

        $variants = app(ProductVariantService::class);
        $variants->enableVariantManagement($product, null);
        $product = $product->fresh();

        $black1 = $variants->createSingleVariant($product, [$black->id, $large->id], null)['variant'];
        $white1 = $variants->createSingleVariant($product, [$white->id, $small->id], null)['variant'];

        $black1->unitPrices()->create(['tenant_id' => $tenantId, 'product_id' => $product->id, 'unit_name' => $product->unit, 'price' => 20000]);
        $white1->unitPrices()->create(['tenant_id' => $tenantId, 'product_id' => $product->id, 'unit_name' => $product->unit, 'price' => 22000]);

        CommerceListing::create([
            'product_id' => $product->id, 'sales_channel_id' => $channel->id, 'is_published' => $published,
        ]);

        app(TenantContext::class)->forget();

        return [$product->fresh(), $black1->fresh(), $white1->fresh()];
    }

    private function mutationHeaders(string $host, string $secret = self::SECRET): array
    {
        config(['storefront.gateway_secret' => self::SECRET]);

        return [
            'X-Storefront-Forwarded-Host' => $host,
            'X-Storefront-Gateway-Secret' => $secret,
        ];
    }

    private function getStorefront(string $host, string $uri): TestResponse
    {
        return $this->withHeaders($this->mutationHeaders($host))
            ->getJson("http://laravel-internal.test{$uri}");
    }

    private function addToCart(string $host, ?string $token, Product $product, ?ProductVariant $variant, int $quantity = 1): TestResponse
    {
        // `withUnencryptedCookie()` مُثبَّتٌ على حالة اختبارٍ دائمة (ليس
        // لطلبٍ واحد) — استدعاءٌ سابقٌ بدون تصفيرٍ صريح كان سيُسرّب كوكي
        // سلةٍ سابقة إلى نداءٍ لاحق بـ`$token = null` (سلةً جديدة مقصودة).
        $test = $this->withHeaders($this->mutationHeaders($host))->withCredentials()
            ->withUnencryptedCookie(CommerceCartService::COOKIE_NAME, $token ?? '');

        $payload = ['product_id' => $product->id, 'quantity' => $quantity];
        if ($variant !== null) {
            $payload['product_variant_id'] = $variant->id;
        }

        return $test->postJson('http://laravel-internal.test/store/v1/cart/items', $payload);
    }

    private function cartToken(TestResponse $addResponse): string
    {
        return $addResponse->getCookie(CommerceCartService::COOKIE_NAME, false)->getValue();
    }

    private function createCheckout(string $host, string $token): TestResponse
    {
        return $this->withHeaders($this->mutationHeaders($host))->withCredentials()
            ->withUnencryptedCookie(CommerceCartService::COOKIE_NAME, $token)
            ->postJson('http://laravel-internal.test/store/v1/checkout', []);
    }

    private function readyCheckout(string $host, string $token): void
    {
        $this->withHeaders($this->mutationHeaders($host))->withCredentials()
            ->withUnencryptedCookie(CommerceCartService::COOKIE_NAME, $token)
            ->patchJson('http://laravel-internal.test/store/v1/checkout/contact', [
                'name' => 'سالم الأحمدي', 'phone' => '0501234567', 'email' => 'salem@example.com',
            ])->assertOk();

        $this->withHeaders($this->mutationHeaders($host))->withCredentials()
            ->withUnencryptedCookie(CommerceCartService::COOKIE_NAME, $token)
            ->patchJson('http://laravel-internal.test/store/v1/checkout/address', [
                'country' => 'SA', 'city' => 'الدمام', 'district' => 'الشاطئ',
                'street' => 'شارع الملك فهد', 'postal_code' => '31411',
            ])->assertOk();

        $this->withHeaders($this->mutationHeaders($host))->withCredentials()
            ->withUnencryptedCookie(CommerceCartService::COOKIE_NAME, $token)
            ->patchJson('http://laravel-internal.test/store/v1/checkout/delivery', ['method' => 'pickup'])
            ->assertOk();
    }

    private function complete(string $host, string $token, string $idempotencyKey): TestResponse
    {
        return $this->withHeaders($this->mutationHeaders($host))->withCredentials()
            ->withUnencryptedCookie(CommerceCartService::COOKIE_NAME, $token)
            ->withHeaders(['Idempotency-Key' => $idempotencyKey])
            ->postJson('http://laravel-internal.test/store/v1/checkout/complete', []);
    }

    private function fullyReadyCheckout(string $host, Product $product, ?ProductVariant $variant, int $quantity = 1): string
    {
        $token = $this->cartToken($this->addToCart($host, null, $product, $variant, $quantity)->assertCreated());
        $this->createCheckout($host, $token)->assertCreated();
        $this->readyCheckout($host, $token);

        return $token;
    }

    // ───────────────────────── ١) كتالوج المتجر ─────────────────────────

    /** @test */
    public function a_simple_product_catalog_response_remains_backward_compatible(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('comvar-simple-catalog.test');
        app(TenantContext::class)->set($tenant->id);
        $product = Product::create(['name' => 'منتج بسيط', 'sku' => 'SIMPLE-CV', 'unit' => 'piece', 'sale_price' => 3000, 'is_active' => true]);
        CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $channel->id, 'is_published' => true]);
        app(TenantContext::class)->forget();

        $response = $this->getStorefront('comvar-simple-catalog.test', '/store/v1/products/'.$product->id)->assertOk();
        $response->assertJsonPath('data.price.amount_minor', 3000);
        $response->assertJsonPath('data.is_variant_managed', false);
        $this->assertNull($response->json('data.variants'));
        $this->assertNull($response->json('data.options'));
    }

    /** @test */
    public function a_published_variant_managed_product_exposes_its_active_variants_with_descriptor_and_price(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('comvar-detail.test');
        [$product, $black, $white] = $this->variantManagedProduct($tenant, $channel);

        $response = $this->getStorefront('comvar-detail.test', '/store/v1/products/'.$product->id)->assertOk();
        $response->assertJsonPath('data.is_variant_managed', true);

        $variants = $response->json('data.variants');
        $this->assertCount(2, $variants);
        $byId = collect($variants)->keyBy('id');
        $this->assertSame('أسود / كبير', $byId[$black->id]['descriptor']);
        $this->assertSame(20000, $byId[$black->id]['price']['amount_minor']);
        $this->assertSame('أبيض / صغير', $byId[$white->id]['descriptor']);
        $this->assertSame(22000, $byId[$white->id]['price']['amount_minor']);

        $options = $response->json('data.options');
        $this->assertCount(2, $options);
    }

    /** @test */
    public function an_inactive_variant_does_not_appear_among_purchasable_options(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('comvar-inactive.test');
        [$product, $black, $white] = $this->variantManagedProduct($tenant, $channel);

        app(TenantContext::class)->set($tenant->id);
        $white->update(['is_active' => false]);
        app(TenantContext::class)->forget();

        $response = $this->getStorefront('comvar-inactive.test', '/store/v1/products/'.$product->id)->assertOk();
        $variants = collect($response->json('data.variants'))->pluck('id')->all();
        $this->assertContains($black->id, $variants);
        $this->assertNotContains($white->id, $variants);
    }

    // ───────────────────────── ٢) إضافة للسلة ─────────────────────────

    /** @test */
    public function adding_a_variant_managed_product_without_a_variant_is_rejected(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('comvar-add-noVariant.test');
        [$product] = $this->variantManagedProduct($tenant, $channel);

        $this->addToCart('comvar-add-noVariant.test', null, $product, null)->assertStatus(422);
    }

    /** @test */
    public function adding_a_simple_product_with_an_explicit_variant_is_rejected(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('comvar-add-simpleVariant.test');
        app(TenantContext::class)->set($tenant->id);
        $simple = Product::create(['name' => 'بسيط', 'sku' => 'SIMPLE-CV2', 'unit' => 'piece', 'sale_price' => 1000, 'is_active' => true]);
        CommerceListing::create(['product_id' => $simple->id, 'sales_channel_id' => $channel->id, 'is_published' => true]);
        [, $foreignVariant] = $this->variantManagedProduct($tenant, $channel, 'SHIRT-FOR-SIMPLE-TEST');
        app(TenantContext::class)->forget();

        $this->addToCart('comvar-add-simpleVariant.test', null, $simple, $foreignVariant)->assertStatus(422);
    }

    /** @test */
    public function a_variant_belonging_to_a_different_product_is_denied(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('comvar-add-mismatch.test');
        [$productA] = $this->variantManagedProduct($tenant, $channel, 'SHIRT-MISMATCH-A');
        [, $variantOfB] = $this->variantManagedProduct($tenant, $channel, 'SHIRT-MISMATCH-B');

        $this->addToCart('comvar-add-mismatch.test', null, $productA, $variantOfB)->assertStatus(422);
    }

    /** @test */
    public function a_cross_tenant_variant_is_denied(): void
    {
        ['tenant' => $tenantA, 'channel' => $channelA] = $this->store('comvar-add-crosstenantA.test');
        [$productA] = $this->variantManagedProduct($tenantA, $channelA, 'SHIRT-CT-A');

        ['tenant' => $tenantB, 'channel' => $channelB] = $this->store('comvar-add-crosstenantB.test');
        [, $variantOfB] = $this->variantManagedProduct($tenantB, $channelB, 'SHIRT-CT-B');

        $this->addToCart('comvar-add-crosstenantA.test', null, $productA, $variantOfB)->assertStatus(422);
    }

    /** @test */
    public function an_inactive_variant_cannot_be_added_to_the_cart(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('comvar-add-inactive.test');
        [$product, $black] = $this->variantManagedProduct($tenant, $channel);
        app(TenantContext::class)->set($tenant->id);
        $black->update(['is_active' => false]);
        app(TenantContext::class)->forget();

        $this->addToCart('comvar-add-inactive.test', null, $product, $black)->assertStatus(422);
    }

    // ───────────────────────── ٣) هويّة سطر السلة ─────────────────────────

    /** @test */
    public function sibling_variants_create_distinct_cart_lines(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('comvar-cart-siblings.test');
        [$product, $black, $white] = $this->variantManagedProduct($tenant, $channel);

        $add1 = $this->addToCart('comvar-cart-siblings.test', null, $product, $black)->assertCreated();
        $token = $this->cartToken($add1);
        $this->addToCart('comvar-cart-siblings.test', $token, $product, $white)->assertOk();

        $show = $this->getStorefront('comvar-cart-siblings.test', '/store/v1/cart')->assertOk();
        $items = $show->json('data.items');
        $this->assertCount(2, $items);

        $byVariant = collect($items)->keyBy('product_variant_id');
        $this->assertSame($black->id, $byVariant->get($black->id)['product_variant_id']);
        $this->assertSame('أسود / كبير', $byVariant->get($black->id)['variant_descriptor']);
        $this->assertSame(20000, $byVariant->get($black->id)['unit_price']['amount_minor']);
        $this->assertSame($white->id, $byVariant->get($white->id)['product_variant_id']);
        $this->assertSame('أبيض / صغير', $byVariant->get($white->id)['variant_descriptor']);
        $this->assertSame(22000, $byVariant->get($white->id)['unit_price']['amount_minor']);
    }

    /** @test */
    public function adding_the_same_variant_twice_merges_the_quantity_into_one_line(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('comvar-cart-merge.test');
        [$product, $black] = $this->variantManagedProduct($tenant, $channel);

        $add1 = $this->addToCart('comvar-cart-merge.test', null, $product, $black, 2)->assertCreated();
        $token = $this->cartToken($add1);
        $this->addToCart('comvar-cart-merge.test', $token, $product, $black, 3)->assertOk();

        $show = $this->getStorefront('comvar-cart-merge.test', '/store/v1/cart')->assertOk();
        $items = $show->json('data.items');
        $this->assertCount(1, $items);
        $this->assertSame(5, $items[0]['quantity']);
    }

    /** @test */
    public function no_factor_derived_or_sibling_fallback_price_is_ever_used(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('comvar-cart-noderive.test');
        [$product, $black, $white] = $this->variantManagedProduct($tenant, $channel);

        $token = $this->cartToken($this->addToCart('comvar-cart-noderive.test', null, $product, $black)->assertCreated());
        $this->addToCart('comvar-cart-noderive.test', $token, $product, $white)->assertOk();

        $show = $this->getStorefront('comvar-cart-noderive.test', '/store/v1/cart')->assertOk();
        $prices = collect($show->json('data.items'))->pluck('unit_price.amount_minor', 'product_variant_id');
        $this->assertSame(20000, $prices[$black->id]);
        $this->assertSame(22000, $prices[$white->id]);
        $this->assertNotSame($prices[$black->id], $prices[$white->id]);
    }

    // ───────────────────────── ٤) الإتمام ─────────────────────────

    /** @test */
    public function completion_creates_an_order_line_carrying_the_variant_identity_and_descriptor(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('comvar-complete-ok.test');
        [$product, $black] = $this->variantManagedProduct($tenant, $channel);
        $token = $this->fullyReadyCheckout('comvar-complete-ok.test', $product, $black);

        $response = $this->complete('comvar-complete-ok.test', $token, 'comvar-idem-001')->assertCreated();
        $response->assertJsonPath('data.order.status', CommerceOrder::STATUS_CONFIRMED);

        app(TenantContext::class)->set($tenant->id);
        $order = CommerceOrder::with('lines')->firstOrFail();
        $this->assertCount(1, $order->lines);
        $line = $order->lines->first();
        $this->assertSame($black->id, $line->product_variant_id);
        $this->assertSame('أسود / كبير', $line->variant_descriptor_snapshot);
        $this->assertSame(20000, $line->unit_price);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function completion_fails_closed_when_the_variant_is_deactivated_after_add_to_cart(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('comvar-complete-deactivated.test');
        [$product, $black] = $this->variantManagedProduct($tenant, $channel);
        $token = $this->fullyReadyCheckout('comvar-complete-deactivated.test', $product, $black);

        app(TenantContext::class)->set($tenant->id);
        $black->update(['is_active' => false]);
        app(TenantContext::class)->forget();

        $response = $this->complete('comvar-complete-deactivated.test', $token, 'comvar-idem-002')
            ->assertStatus(409)
            ->assertJsonPath('error.code', 'review_required');
        $this->assertSame('unavailable', $response->json('error.details.items.0.reason'));
        $this->assertDatabaseCount('commerce_orders', 0);
    }

    /** @test */
    public function checkout_targets_the_variants_own_inventory_and_keeps_the_sibling_untouched(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('comvar-stock-sibling.test');
        [$product, $black, $white] = $this->variantManagedProduct($tenant, $channel);

        app(TenantContext::class)->set($tenant->id);
        $product->update(['track_inventory' => true]);
        $warehouse = Warehouse::create(['name' => 'مخزن VAR-COM', 'code' => 'COMVAR-W1', 'is_default' => true]);
        app(FulfillmentPolicyService::class)->setFixedWarehouse($channel->id, $warehouse->id);
        \App\Models\ProductWarehouseStock::create([
            'product_id' => $product->id, 'product_variant_id' => $black->id, 'warehouse_id' => $warehouse->id, 'quantity' => 1,
        ]);
        \App\Models\ProductWarehouseStock::create([
            'product_id' => $product->id, 'product_variant_id' => $white->id, 'warehouse_id' => $warehouse->id, 'quantity' => 10,
        ]);
        app(TenantContext::class)->forget();

        // أسود: طلب ٥ بينما المتوفّر ١ فقط — يُرفض.
        $blackToken = $this->fullyReadyCheckout('comvar-stock-sibling.test', $product, $black, 5);
        $this->complete('comvar-stock-sibling.test', $blackToken, 'comvar-idem-stock-black')
            ->assertStatus(409);
        $this->assertDatabaseCount('commerce_orders', 0);

        // أبيض: طلب ٢ من مخزونه المستقل (١٠) — ينجح رغم نقص الأسود.
        $whiteToken = $this->fullyReadyCheckout('comvar-stock-sibling.test', $product, $white, 2);
        $this->complete('comvar-stock-sibling.test', $whiteToken, 'comvar-idem-stock-white')
            ->assertCreated();
        $this->assertDatabaseCount('commerce_orders', 1);
    }

    /** @test */
    public function replaying_the_same_idempotency_key_for_a_variant_checkout_returns_the_same_order(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('comvar-idem-replay.test');
        [$product, $black] = $this->variantManagedProduct($tenant, $channel);
        $token = $this->fullyReadyCheckout('comvar-idem-replay.test', $product, $black);

        $first = $this->complete('comvar-idem-replay.test', $token, 'comvar-idem-replay-key')->assertCreated();
        $second = $this->complete('comvar-idem-replay.test', $token, 'comvar-idem-replay-key')->assertOk();

        $this->assertSame($first->json('data.order.id'), $second->json('data.order.id'));
        $this->assertTrue($second->json('data.replayed'));
        $this->assertDatabaseCount('commerce_orders', 1);
    }

    // ───────────────────────── ٥) العزل ─────────────────────────

    /** @test */
    public function checkout_completion_never_reads_a_variant_identity_from_the_client_request_body(): void
    {
        // `/checkout/complete` لا يقبل أي حقلٍ في جسم الطلب إطلاقاً
        // (`rejectUnknown($request, [])`) — هويّة كل سطرٍ (بما فيها المتغيّر)
        // تأتي حصراً من عناصر السلة المحلولة خادمياً عبر الكوكي، لا من أي
        // معاملٍ حرٍّ يمكن للعميل تزويره. محاولة تمرير `product_variant_id`
        // في الجسم تُرفض بنيوياً (422) قبل الوصول لأي منطق إتمام.
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('comvar-complete-noinput.test');
        [$product, $black] = $this->variantManagedProduct($tenant, $channel);
        $token = $this->fullyReadyCheckout('comvar-complete-noinput.test', $product, $black);

        $this->withHeaders($this->mutationHeaders('comvar-complete-noinput.test'))->withCredentials()
            ->withUnencryptedCookie(CommerceCartService::COOKIE_NAME, $token)
            ->withHeaders(['Idempotency-Key' => 'comvar-idem-noinput'])
            ->postJson('http://laravel-internal.test/store/v1/checkout/complete', [
                'product_variant_id' => 'ffffffff-ffff-ffff-ffff-ffffffffffff',
            ])->assertStatus(422);

        $this->assertDatabaseCount('commerce_orders', 0);

        // الجسم الفارغ الصحيح ينجح ويحمل هويّة المتغيّر من السلة وحدها.
        $response = $this->complete('comvar-complete-noinput.test', $token, 'comvar-idem-noinput-ok')->assertCreated();
        app(TenantContext::class)->set($tenant->id);
        $line = CommerceOrder::firstOrFail()->lines->first();
        $this->assertSame($black->id, $line->product_variant_id);
        app(TenantContext::class)->forget();
    }

    // ───────────────────────── ٦) حارس الحذف ─────────────────────────

    /** @test */
    public function a_variant_referenced_by_a_confirmed_commerce_order_line_cannot_be_hard_deleted(): void
    {
        // VAR-COM-1 يضيف CommerceOrderLine إلى
        // ProductReferenceRegistry::variantScopedBusinessDocumentLines() —
        // كانت VAR-DOC-1 استثنته صراحةً بانتظار هذه المهمة بالذات.
        ['tenant' => $tenant, 'channel' => $channel] = $this->store('comvar-delete-guard.test');
        [$product, $black] = $this->variantManagedProduct($tenant, $channel);
        $token = $this->fullyReadyCheckout('comvar-delete-guard.test', $product, $black);
        $this->complete('comvar-delete-guard.test', $token, 'comvar-idem-delete-guard')->assertCreated();

        app(TenantContext::class)->set($tenant->id);
        $this->expectException(\RuntimeException::class);
        app(ProductVariantService::class)->deleteVariant($black->fresh(), null);
    }
}
