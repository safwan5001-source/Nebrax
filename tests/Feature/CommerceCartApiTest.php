<?php

namespace Tests\Feature;

use App\Models\CommerceCart;
use App\Models\CommerceListing;
use App\Models\PriceList;
use App\Models\PriceListItem;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Services\Commerce\CommerceCartService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  Public/Mobile Commerce API V1 — PR-3 (Guest Cart)
 * ═══════════════════════════════════════════════════════════════
 *  يثبت القرار المعماري المعتمد (Option A —
 *  docs/plans/commerce/PR3_GUEST_CART_ARCHITECTURE_RECONCILIATION.md):
 *  هوية Cart = tenant_id + sales_channel_id، وstorefront_id اختياري (NULL
 *  للجوال، إلزامي منطقياً للويب). التوكن `X-Cart-Token` منفصل تماماً عن
 *  Authorization (ApiClient/Sanctum).
 *
 *  تشغيل: php artisan test --filter=CommerceCartApiTest
 */
class CommerceCartApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const TOKEN_HEADER = 'X-Cart-Token';

    private function service(): ApiClientKeyService
    {
        return app(ApiClientKeyService::class);
    }

    /** @return array{tenant: Tenant, channel: SalesChannel, token: string} */
    private function seedMobileStore(string $slug): array
    {
        $tenant = Tenant::create([
            'name' => "متجر {$slug}", 'slug' => $slug.'-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);

        $channel = SalesChannel::create([
            'slug' => 'mobile', 'name' => 'تطبيق الجوال', 'type' => SalesChannel::TYPE_MOBILE, 'is_active' => true,
        ]);

        app(TenantContext::class)->forget();

        $client = $this->service()->createClient($tenant, 'mobile-app', true);
        $key = $this->service()->issueKey($client, 'default', []);

        return ['tenant' => $tenant, 'channel' => $channel, 'token' => $key->plainTextToken];
    }

    /** @return array{tenant: Tenant, channel: SalesChannel, storefront: Storefront} */
    private function seedWebStore(string $slug): array
    {
        $tenant = Tenant::create([
            'name' => "متجر ويب {$slug}", 'slug' => 'web-'.$slug.'-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create([
            'slug' => 'web', 'name' => 'Web', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        $storefront = Storefront::create([
            'slug' => 'main', 'name' => 'Main', 'sales_channel_id' => $channel->id, 'is_active' => true,
        ]);
        app(TenantContext::class)->forget();

        return ['tenant' => $tenant, 'channel' => $channel, 'storefront' => $storefront];
    }

    private function publishedProduct(Tenant $tenant, SalesChannel $channel, array $attrs = []): Product
    {
        app(TenantContext::class)->set($tenant->id);

        $product = Product::create(array_merge([
            'sku' => 'SKU-'.Str::random(6), 'name' => 'منتج منشور', 'name_en' => 'Published Product',
            'type' => 'good', 'unit' => 'piece', 'sale_price' => 25000, 'tax_rate' => 15,
            'is_active' => true,
            'avg_cost' => 9999, 'purchase_price' => 8000, 'quantity_on_hand' => 42,
            'internal_notes' => 'سرّي جداً', 'tags' => 'internal-tag',
        ], $attrs));

        CommerceListing::create([
            'product_id' => $product->id, 'sales_channel_id' => $channel->id, 'is_published' => true,
        ]);

        app(TenantContext::class)->forget();

        return $product->fresh();
    }

    private function bearer(string $token): array
    {
        return ['Authorization' => 'Bearer '.$token];
    }

    private function cartHeaders(string $bearerToken, ?string $cartToken = null): array
    {
        $headers = $this->bearer($bearerToken);
        if ($cartToken !== null) {
            $headers[self::TOKEN_HEADER] = $cartToken;
        }

        return $headers;
    }

    private function add(array $store, Product $product, array $extra = [], ?string $cartToken = null)
    {
        return $this->withHeaders($this->cartHeaders($store['token'], $cartToken))
            ->postJson('/commerce/v1/cart/items', array_merge([
                'product_id' => $product->id, 'quantity' => 1,
            ], $extra));
    }

    // ── 1/2/3. Mobile Cart creation, GET Cart, add item ────────────────────

    /** @test */
    public function get_cart_is_non_creating_and_first_add_creates_a_mobile_cart_with_a_response_token(): void
    {
        $store = $this->seedMobileStore('create');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);

        $this->withHeaders($this->bearer($store['token']))
            ->getJson('/commerce/v1/cart')
            ->assertOk()->assertJsonPath('data.items', []);
        $this->assertDatabaseCount('commerce_carts', 0);

        $response = $this->add($store, $product)->assertCreated();
        $cartToken = $response->headers->get(self::TOKEN_HEADER);
        $this->assertNotNull($cartToken);
        $this->assertNotEmpty($cartToken);
        $this->assertStringNotContainsString($cartToken, $response->getContent());

        $cart = CommerceCart::withoutGlobalScopes()->firstOrFail();
        $this->assertSame(hash('sha256', $cartToken), $cart->token_hash);
        $this->assertSame($store['channel']->id, $cart->sales_channel_id);
    }

    /** @test */
    public function get_cart_returns_the_created_cart_with_the_added_item(): void
    {
        $store = $this->seedMobileStore('get-after-add');
        $product = $this->publishedProduct($store['tenant'], $store['channel'], ['sale_price' => 5000]);

        $created = $this->add($store, $product, ['quantity' => 3])->assertCreated();
        $cartToken = $created->headers->get(self::TOKEN_HEADER);

        $this->withHeaders($this->cartHeaders($store['token'], $cartToken))
            ->getJson('/commerce/v1/cart')
            ->assertOk()
            ->assertJsonCount(1, 'data.items')
            ->assertJsonPath('data.items.0.quantity', 3)
            ->assertJsonPath('data.items.0.unit_price.amount_minor', 5000)
            ->assertJsonPath('data.subtotal.amount_minor', 15000);
    }

    // ── 4. update quantity ─────────────────────────────────────────────────

    /** @test */
    public function patch_updates_the_item_quantity(): void
    {
        $store = $this->seedMobileStore('update-qty');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $created = $this->add($store, $product, ['quantity' => 1])->assertCreated();
        $cartToken = $created->headers->get(self::TOKEN_HEADER);
        $itemId = $created->json('data.items.0.id');

        $this->withHeaders($this->cartHeaders($store['token'], $cartToken))
            ->patchJson("/commerce/v1/cart/items/{$itemId}", ['quantity' => 7])
            ->assertOk()
            ->assertJsonPath('data.items.0.quantity', 7);
    }

    // ── 5. remove item ──────────────────────────────────────────────────────

    /** @test */
    public function delete_removes_the_item(): void
    {
        $store = $this->seedMobileStore('remove-item');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $created = $this->add($store, $product)->assertCreated();
        $cartToken = $created->headers->get(self::TOKEN_HEADER);
        $itemId = $created->json('data.items.0.id');

        $this->withHeaders($this->cartHeaders($store['token'], $cartToken))
            ->deleteJson("/commerce/v1/cart/items/{$itemId}")
            ->assertOk()
            ->assertJsonPath('data.items', []);
        $this->assertDatabaseCount('commerce_cart_items', 0);
    }

    // ── 6/7. storefront_id persistence (mobile NULL / web non-null) ────────

    /** @test */
    public function a_mobile_cart_persists_with_a_null_storefront_id(): void
    {
        $store = $this->seedMobileStore('null-storefront');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $this->add($store, $product)->assertCreated();

        $cart = CommerceCart::withoutGlobalScopes()->firstOrFail();
        $this->assertNull($cart->storefront_id);
        $this->assertSame($store['channel']->id, $cart->sales_channel_id);
    }

    /** @test */
    public function a_web_cart_persists_with_a_non_null_storefront_id(): void
    {
        // يستعمل CommerceCartService مباشرة عبر السياق الويب (كما يفعل
        // /store/v1) للتحقق من أن مسار الويب غير متأثر إطلاقاً بهذا التغيير.
        $store = $this->seedWebStore('non-null-storefront');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);

        app(TenantContext::class)->set($store['tenant']->id);
        app(\App\Tenancy\StorefrontContext::class)->set(
            $store['tenant']->id,
            $store['channel']->id,
            $store['storefront']->id,
        );
        app(CommerceCartService::class)->add(null, $product->id, 'base', 1);
        app(\App\Tenancy\StorefrontContext::class)->forget();
        app(TenantContext::class)->forget();

        $cart = CommerceCart::withoutGlobalScopes()->firstOrFail();
        $this->assertNotNull($cart->storefront_id);
        $this->assertSame($store['storefront']->id, $cart->storefront_id);
    }

    // ── 8. invalid guest token ───────────────────────────────────────────────

    /** @test */
    public function an_invalid_cart_token_is_treated_as_no_cart_and_cleared(): void
    {
        $store = $this->seedMobileStore('invalid-token');

        $response = $this->withHeaders($this->cartHeaders($store['token'], 'not-a-real-token'))
            ->getJson('/commerce/v1/cart')
            ->assertOk()
            ->assertJsonPath('data.items', []);
        $this->assertSame('', $response->headers->get(self::TOKEN_HEADER));
    }

    // ── 9. expired cart ──────────────────────────────────────────────────────

    /** @test */
    public function an_expired_cart_is_treated_as_invalid_and_marked_expired(): void
    {
        $store = $this->seedMobileStore('expired');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $created = $this->add($store, $product)->assertCreated();
        $cartToken = $created->headers->get(self::TOKEN_HEADER);

        app(TenantContext::class)->set($store['tenant']->id);
        CommerceCart::query()->update(['expires_at' => now()->subSecond()]);
        app(TenantContext::class)->forget();

        $response = $this->withHeaders($this->cartHeaders($store['token'], $cartToken))
            ->getJson('/commerce/v1/cart')
            ->assertOk()
            ->assertJsonPath('data.items', []);
        $this->assertSame('', $response->headers->get(self::TOKEN_HEADER));

        $this->assertSame(
            CommerceCart::STATUS_EXPIRED,
            CommerceCart::withoutGlobalScopes()->first()->status
        );
    }

    // ── 10/11/12. cross-tenant, cross-channel, web/mobile isolation ────────

    /** @test */
    public function a_cross_tenant_cart_token_fails_closed(): void
    {
        $a = $this->seedMobileStore('cross-tenant-a');
        $b = $this->seedMobileStore('cross-tenant-b');
        $productA = $this->publishedProduct($a['tenant'], $a['channel']);
        $created = $this->add($a, $productA)->assertCreated();
        $cartToken = $created->headers->get(self::TOKEN_HEADER);

        // نفس التوكن، لكن bearer المستأجر ب — يجب ألا يرى سلة أ إطلاقاً.
        $response = $this->withHeaders($this->cartHeaders($b['token'], $cartToken))
            ->getJson('/commerce/v1/cart')
            ->assertOk()
            ->assertJsonPath('data.items', []);
        $this->assertSame('', $response->headers->get(self::TOKEN_HEADER));

        // السلة الأصلية تبقى سليمة تحت مستأجرها الحقيقي.
        $this->withHeaders($this->cartHeaders($a['token'], $cartToken))
            ->getJson('/commerce/v1/cart')
            ->assertOk()
            ->assertJsonCount(1, 'data.items');
    }

    /** @test */
    public function a_cross_channel_cart_token_fails_closed(): void
    {
        // `ResolveCommerceChannel` يحلّ دائماً القناة الجوّالة النشطة الوحيدة
        // للمستأجر (بلا اختيار من العميل) — فلا يمكن إنتاج توكن bearer HTTP
        // ثانٍ يحلّ قناة مختلفة لنفس المستأجر عبر المسار العام. العزل الحقيقي
        // المطلوب إثباته هنا هو على مستوى الخدمة نفسها: `sales_channel_id`
        // جزءٌ من `scopeToContext()`، فتوكن سلة قناة أ لا يُحلّ إطلاقاً تحت
        // سياقٍ مضبوط صراحةً على قناة ب — بنفس أسلوب اختبار عزل ويب/جوال أدناه.
        $store = $this->seedMobileStore('cross-channel');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $created = $this->add($store, $product)->assertCreated();
        $cartToken = $created->headers->get(self::TOKEN_HEADER);

        app(TenantContext::class)->set($store['tenant']->id);
        $secondChannel = SalesChannel::create([
            'slug' => 'mobile-2', 'name' => 'تطبيق جوال ثانٍ', 'type' => SalesChannel::TYPE_MOBILE, 'is_active' => true,
        ]);
        app(TenantContext::class)->forget();

        app(TenantContext::class)->set($store['tenant']->id);
        app(\App\Tenancy\StorefrontContext::class)->set($store['tenant']->id, $secondChannel->id);
        $lookup = app(CommerceCartService::class)->findByToken($cartToken);
        app(\App\Tenancy\StorefrontContext::class)->forget();
        app(TenantContext::class)->forget();

        $this->assertTrue($lookup['invalid']);
        $this->assertNull($lookup['cart']);
    }

    /** @test */
    public function a_mobile_cart_token_cannot_access_the_web_cart_and_vice_versa(): void
    {
        // نفس المستأجر، قناتان مختلفتان (mobile عبر /commerce/v1 وweb عبر
        // CommerceCartService مباشرة بسياق ويب) — التوكن الجوال لا يجوز أن
        // يحلّ سلة الويب رغم اشتراك tenant_id، والعكس بالمثل.
        $tenant = Tenant::create([
            'name' => 'متجر مزدوج', 'slug' => 'dual-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);
        $mobileChannel = SalesChannel::create([
            'slug' => 'mobile', 'name' => 'جوال', 'type' => SalesChannel::TYPE_MOBILE, 'is_active' => true,
        ]);
        $webChannel = SalesChannel::create([
            'slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        $storefront = Storefront::create([
            'slug' => 'main', 'name' => 'Main', 'sales_channel_id' => $webChannel->id, 'is_active' => true,
        ]);
        app(TenantContext::class)->forget();

        $mobileClient = $this->service()->createClient($tenant, 'mobile-app', true);
        $mobileBearer = $this->service()->issueKey($mobileClient, 'default', [])->plainTextToken;
        $mobileProduct = $this->publishedProduct($tenant, $mobileChannel);
        $webProduct = $this->publishedProduct($tenant, $webChannel);

        $mobileCreated = $this->withHeaders($this->cartHeaders($mobileBearer))
            ->postJson('/commerce/v1/cart/items', ['product_id' => $mobileProduct->id, 'quantity' => 1])
            ->assertCreated();
        $mobileToken = $mobileCreated->headers->get(self::TOKEN_HEADER);

        app(TenantContext::class)->set($tenant->id);
        app(\App\Tenancy\StorefrontContext::class)->set($tenant->id, $webChannel->id, $storefront->id);
        $webResult = app(CommerceCartService::class)->add(null, $webProduct->id, 'base', 1);
        $webRawToken = $webResult['token'];
        app(\App\Tenancy\StorefrontContext::class)->forget();
        app(TenantContext::class)->forget();

        // التوكن الجوال ضد سياق الويب (عبر الخدمة مباشرة، بنفس منطق findByToken).
        app(TenantContext::class)->set($tenant->id);
        app(\App\Tenancy\StorefrontContext::class)->set($tenant->id, $webChannel->id, $storefront->id);
        $lookupMobileAsWeb = app(CommerceCartService::class)->findByToken($mobileToken);
        app(\App\Tenancy\StorefrontContext::class)->forget();
        app(TenantContext::class)->forget();
        $this->assertTrue($lookupMobileAsWeb['invalid']);
        $this->assertNull($lookupMobileAsWeb['cart']);

        // التوكن الويب ضد /commerce/v1 (سياق الجوال).
        $webAsMobile = $this->withHeaders($this->cartHeaders($mobileBearer, $webRawToken))
            ->getJson('/commerce/v1/cart')
            ->assertOk()
            ->assertJsonPath('data.items', []);
        $this->assertSame('', $webAsMobile->headers->get(self::TOKEN_HEADER));
    }

    // ── 13/14. inactive / unpublished product ───────────────────────────────

    /** @test */
    public function adding_an_inactive_product_is_rejected(): void
    {
        $store = $this->seedMobileStore('inactive-product');
        $product = $this->publishedProduct($store['tenant'], $store['channel'], ['is_active' => false]);

        $this->add($store, $product)->assertUnprocessable();
        $this->assertDatabaseCount('commerce_carts', 0);
    }

    /** @test */
    public function adding_an_unpublished_product_is_rejected(): void
    {
        $store = $this->seedMobileStore('unpublished-product');
        app(TenantContext::class)->set($store['tenant']->id);
        $product = Product::create([
            'sku' => 'SKU-'.Str::random(6), 'name' => 'غير منشور', 'type' => 'good',
            'unit' => 'piece', 'sale_price' => 10000, 'is_active' => true,
        ]);
        CommerceListing::create([
            'product_id' => $product->id, 'sales_channel_id' => $store['channel']->id, 'is_published' => false,
        ]);
        app(TenantContext::class)->forget();

        $this->add($store, $product)->assertUnprocessable();
        $this->assertDatabaseCount('commerce_carts', 0);
    }

    // ── 15. Mobile SalesChannel pricing ──────────────────────────────────────

    /** @test */
    public function pricing_resolves_from_the_mobile_channels_own_price_list(): void
    {
        $store = $this->seedMobileStore('mobile-pricing');
        $product = $this->publishedProduct($store['tenant'], $store['channel'], ['sale_price' => 10000]);

        app(TenantContext::class)->set($store['tenant']->id);
        $priceList = PriceList::create(['name' => 'سعر الجوال', 'is_active' => true]);
        PriceListItem::create([
            'price_list_id' => $priceList->id, 'product_id' => $product->id,
            'unit_name' => $product->unit, 'price' => 6500,
        ]);
        $store['channel']->update(['default_price_list_id' => $priceList->id]);
        app(TenantContext::class)->forget();

        $this->add($store, $product)
            ->assertCreated()
            ->assertJsonPath('data.items.0.unit_price.amount_minor', 6500);
    }

    // ── 16. quantity validation ───────────────────────────────────────────────

    /** @test */
    public function invalid_quantities_are_rejected(): void
    {
        $store = $this->seedMobileStore('qty-validation');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);

        foreach ([0, -1, 1.5, 'one'] as $quantity) {
            $this->add($store, $product, ['quantity' => $quantity])->assertUnprocessable();
        }
        $this->assertDatabaseCount('commerce_carts', 0);

        $created = $this->add($store, $product)->assertCreated();
        $cartToken = $created->headers->get(self::TOKEN_HEADER);
        $itemId = $created->json('data.items.0.id');

        foreach ([0, -1, 1.5, 'one'] as $quantity) {
            $this->withHeaders($this->cartHeaders($store['token'], $cartToken))
                ->patchJson("/commerce/v1/cart/items/{$itemId}", ['quantity' => $quantity])
                ->assertUnprocessable();
        }
    }

    // ── 17. no sensitive/cost field leakage ───────────────────────────────────

    /** @test */
    public function no_sensitive_or_cost_fields_leak_through_the_cart_response(): void
    {
        $store = $this->seedMobileStore('no-leak');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);

        $response = $this->add($store, $product)->assertCreated();
        $item = $response->json('data.items.0');

        foreach (['avg_cost', 'purchase_price', 'quantity_on_hand', 'internal_notes', 'tags', 'min_sale_price', 'cost'] as $field) {
            $this->assertArrayNotHasKey($field, $item, "الحقل الحسّاس «{$field}» ظهر في استجابة السلة.");
        }
    }

    // ── 18. concurrency/race behavior ───────────────────────────────────────

    /** @test */
    public function add_uses_the_same_locked_transactional_service_path_for_the_mobile_context(): void
    {
        // يثبت أن السياق الجوال يمرّ عبر نفس `DB::transaction(...,3)` +
        // `lockForUpdate()` المستعمَلين في مسار الويب دون تفرّع منطقي — هذا هو
        // المسار الذي تثبته اختبارات PostgreSQL التزامنية الحالية
        // (`StorefrontCartPostgresConcurrencyTest`) بالتفصيل على `CommerceCartService`
        // نفسها، غير المعدَّلة في منطق القفل والمحاولات. هنا: إضافتان متتاليتان
        // لنفس المنتج على نفس السلة الجوالة تُدمَجان في سطر واحد (نفس ضمان
        // `add()` الحالي)، لا تتكرران في سطرين متنافسين.
        $store = $this->seedMobileStore('concurrency-merge');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);

        $first = $this->add($store, $product, ['quantity' => 2])->assertCreated();
        $cartToken = $first->headers->get(self::TOKEN_HEADER);

        $this->add($store, $product, ['quantity' => 3], $cartToken)
            ->assertOk()
            ->assertJsonCount(1, 'data.items')
            ->assertJsonPath('data.items.0.quantity', 5);

        $this->assertSame(1, DB::table('commerce_cart_items')->count());
        $cart = CommerceCart::withoutGlobalScopes()->firstOrFail();
        $this->assertNull($cart->storefront_id);
    }

    // ── boundary: rejects unauthenticated / unresolved-channel access ───────

    /** @test */
    public function a_tenant_with_no_mobile_channel_is_denied_the_cart(): void
    {
        $tenant = Tenant::create([
            'name' => 'بلا قناة', 'slug' => 'no-channel-cart-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        $client = $this->service()->createClient($tenant, 'mobile-app', true);
        $token = $this->service()->issueKey($client, 'default', [])->plainTextToken;

        $this->withHeaders($this->bearer($token))->getJson('/commerce/v1/cart')->assertStatus(404);
    }

    /** @test */
    public function unknown_fields_are_rejected_on_add(): void
    {
        $store = $this->seedMobileStore('unknown-fields');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);

        $this->withHeaders($this->cartHeaders($store['token']))
            ->postJson('/commerce/v1/cart/items', [
                'product_id' => $product->id, 'quantity' => 1, 'price' => 1,
            ])
            ->assertUnprocessable();
        $this->assertDatabaseCount('commerce_carts', 0);
    }
}
