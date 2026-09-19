<?php

namespace Tests\Feature;

use App\Models\CommerceListing;
use App\Models\CommerceOrder;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Support\CommerceOrderReference;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  Public/Mobile Commerce API V1 — PR-5 (Standalone Order Status)
 * ═══════════════════════════════════════════════════════════════
 *  `GET /commerce/v1/orders/{id}` — قراءة مستقلة للطلب الناتج عن إتمام
 *  Checkout. الملكية تُثبَت بالمرجع الموقَّع `X-Order-Reference` فقط —
 *  مُعرّف الطلب وحده لا يثبت شيئاً، ورمز الـ ApiClient يثبت سياق المتجر
 *  لا ملكية طلب بعينه. كل فشل ملكية يعيد 404 واحداً غير كاشف.
 *
 *  تشغيل: php artisan test --filter=CommerceOrderStatusApiTest
 */
class CommerceOrderStatusApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const TOKEN_HEADER = 'X-Cart-Token';

    private const REFERENCE_HEADER = 'X-Order-Reference';

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

    private function publishedProduct(Tenant $tenant, SalesChannel $channel): Product
    {
        app(TenantContext::class)->set($tenant->id);

        $product = Product::create([
            'sku' => 'SKU-'.Str::random(6), 'name' => 'منتج منشور', 'name_en' => 'Published Product',
            'type' => 'good', 'unit' => 'piece', 'sale_price' => 5000, 'tax_rate' => 15,
            'is_active' => true,
        ]);

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

    /**
     * تدفّق شراء كامل عبر /commerce/v1، يعيد
     * [order_id, order_reference, checkout-complete order payload].
     *
     * @return array{order_id: string, reference: string, order_payload: array<string, mixed>}
     */
    private function completedOrder(array $store, Product $product): array
    {
        // withHeaders يتراكم في defaultHeaders عبر الطلبات داخل الاختبار
        // الواحد — نصفّرها كي لا يتسرّب X-Cart-Token لطلب مستقل لاحق.
        $this->flushHeaders();

        $cartResponse = $this->withHeaders($this->bearer($store['token']))
            ->postJson('/commerce/v1/cart/items', ['product_id' => $product->id, 'quantity' => 1]);
        if ($cartResponse->status() !== 201) { var_dump($cartResponse->status(), $cartResponse->getContent()); }
        $cartResponse->assertCreated();
        $cartToken = $cartResponse->headers->get(self::TOKEN_HEADER);

        $headers = array_merge($this->bearer($store['token']), [self::TOKEN_HEADER => $cartToken]);

        $this->withHeaders($headers)->postJson('/commerce/v1/checkout', [])->assertCreated();
        $this->withHeaders($headers)->patchJson('/commerce/v1/checkout/contact', [
            'name' => 'سالم الأحمدي', 'phone' => '0501234567', 'email' => 'salem@example.com',
        ])->assertOk();
        $this->withHeaders($headers)->patchJson('/commerce/v1/checkout/address', [
            'country' => 'SA', 'city' => 'الدمام', 'district' => 'الشاطئ',
            'street' => 'شارع الملك فهد', 'postal_code' => '31411',
        ])->assertOk();
        $this->withHeaders($headers)->patchJson('/commerce/v1/checkout/delivery', ['method' => 'pickup'])->assertOk();

        $completion = $this->withHeaders(array_merge($headers, ['Idempotency-Key' => (string) Str::uuid()]))
            ->postJson('/commerce/v1/checkout/complete', [])
            ->assertCreated();

        return [
            'order_id' => $completion->json('data.order.id'),
            'reference' => $completion->json('data.order_reference'),
            'order_payload' => $completion->json('data.order'),
        ];
    }

    private function getOrder(array $store, string $orderId, ?string $reference): TestResponse
    {
        $this->flushHeaders();

        $headers = $this->bearer($store['token']);
        if ($reference !== null) {
            $headers[self::REFERENCE_HEADER] = $reference;
        }

        return $this->withHeaders($headers)->getJson("/commerce/v1/orders/{$orderId}");
    }

    // ── Happy path ───────────────────────────────────────────────────────

    /** @test */
    public function a_completed_mobile_order_can_be_fetched_with_its_valid_signed_reference(): void
    {
        $store = $this->seedMobileStore('pr5-happy');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $completed = $this->completedOrder($store, $product);

        $response = $this->getOrder($store, $completed['order_id'], $completed['reference'])->assertOk();

        $this->assertSame($completed['order_id'], $response->json('data.order.id'));
        $this->assertSame('confirmed', $response->json('data.order.status'));
    }

    /** @test */
    public function the_standalone_response_matches_the_checkout_completion_order_serialization_exactly(): void
    {
        $store = $this->seedMobileStore('pr5-shape');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $completed = $this->completedOrder($store, $product);

        $response = $this->getOrder($store, $completed['order_id'], $completed['reference'])->assertOk();

        $this->assertSame($completed['order_payload'], $response->json('data.order'));
    }

    /** @test */
    public function the_response_exposes_no_sensitive_internal_fields(): void
    {
        $store = $this->seedMobileStore('pr5-leak');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $completed = $this->completedOrder($store, $product);

        $payload = json_encode($this->getOrder($store, $completed['order_id'], $completed['reference'])->json('data.order'));

        foreach (['tenant_id', 'sales_channel_id', 'storefront_id', 'customer_identity_id', 'partner_id', 'cost', 'ledger', 'api_client'] as $needle) {
            $this->assertStringNotContainsString($needle, $payload);
        }
    }

    // ── Security: the reference is the ownership proof ───────────────────

    /** @test */
    public function a_bare_order_id_without_any_reference_is_rejected(): void
    {
        $store = $this->seedMobileStore('pr5-no-ref');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $completed = $this->completedOrder($store, $product);

        $this->getOrder($store, $completed['order_id'], null)
            ->assertNotFound()
            ->assertJsonPath('error.code', 'not_found');
    }

    /** @test */
    public function a_malformed_reference_is_rejected(): void
    {
        $store = $this->seedMobileStore('pr5-malformed');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $completed = $this->completedOrder($store, $product);

        foreach (['not-a-reference', 'v1.', 'v2.'.str_repeat('a', 64), 'v1.zzzz'] as $bad) {
            $this->getOrder($store, $completed['order_id'], $bad)->assertNotFound();
        }
    }

    /** @test */
    public function a_tampered_reference_is_rejected(): void
    {
        $store = $this->seedMobileStore('pr5-tampered');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $completed = $this->completedOrder($store, $product);

        $signature = substr($completed['reference'], 3);
        $flipped = ($signature[0] === '0' ? '1' : '0').substr($signature, 1);

        $this->getOrder($store, $completed['order_id'], 'v1.'.$flipped)->assertNotFound();
    }

    /** @test */
    public function a_valid_reference_for_another_order_is_rejected(): void
    {
        $store = $this->seedMobileStore('pr5-cross-order');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $orderA = $this->completedOrder($store, $product);
        $orderB = $this->completedOrder($store, $product);

        // مرجع الطلب A لا يفتح الطلب B رغم أن كليهما لنفس المتجر والقناة.
        $this->getOrder($store, $orderB['order_id'], $orderA['reference'])->assertNotFound();

        // والعكس صحيح — الربط بالطلب المقصود حرفي.
        $this->getOrder($store, $orderA['order_id'], $orderA['reference'])->assertOk();
    }

    /** @test */
    public function a_random_uuid_that_is_not_an_order_is_rejected(): void
    {
        $store = $this->seedMobileStore('pr5-random-uuid');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $this->completedOrder($store, $product);

        $this->getOrder($store, (string) Str::uuid(), 'v1.'.str_repeat('a', 64))->assertNotFound();
    }

    // ── Tenant / channel isolation ───────────────────────────────────────

    /** @test */
    public function cross_tenant_access_is_rejected_without_revealing_existence(): void
    {
        $storeA = $this->seedMobileStore('pr5-tenant-a');
        $storeB = $this->seedMobileStore('pr5-tenant-b');
        $productA = $this->publishedProduct($storeA['tenant'], $storeA['channel']);
        $orderA = $this->completedOrder($storeA, $productA);

        // عميل المتجر B يحمل مرجعاً صحيح التوقيع لطلب A — يُرفض بنفس 404
        // التي تعود لطلبٍ غير موجود أصلاً.
        $response = $this->getOrder($storeB, $orderA['order_id'], $orderA['reference']);
        $response->assertNotFound()->assertJsonPath('error.code', 'not_found');

        $missing = $this->getOrder($storeB, (string) Str::uuid(), $orderA['reference']);
        // نفس مغلف الخطأ حرفياً (request_id في meta يختلف بطبيعته لكل طلب).
        $this->assertSame($missing->json('error'), $response->json('error'));
    }

    /** @test */
    public function an_order_from_a_web_storefront_context_is_not_resolvable_via_the_mobile_endpoint(): void
    {
        $store = $this->seedMobileStore('pr5-web-order');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $completed = $this->completedOrder($store, $product);

        // أعد توجيه الطلب لقناة web (محاكاة طلب مساره /store/v1) — مرجعه
        // الموقَّع على القناة القديمة يصبح باطلاً حتماً.
        $order = CommerceOrder::findOrFail($completed['order_id']);
        app(TenantContext::class)->set($store['tenant']->id);
        $webChannel = SalesChannel::create([
            'slug' => 'web', 'name' => 'Web', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        $storefront = Storefront::create([
            'slug' => 'main', 'name' => 'Main', 'sales_channel_id' => $webChannel->id, 'is_active' => true,
        ]);
        $order->forceFill(['sales_channel_id' => $webChannel->id, 'storefront_id' => $storefront->id])->save();
        app(TenantContext::class)->forget();

        $this->getOrder($store, $completed['order_id'], $completed['reference'])->assertNotFound();
    }

    // ── Lifecycle / replay ───────────────────────────────────────────────

    /** @test */
    public function completion_replay_preserves_the_same_order_and_reference(): void
    {
        $store = $this->seedMobileStore('pr5-replay');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);

        $cartResponse = $this->withHeaders($this->bearer($store['token']))
            ->postJson('/commerce/v1/cart/items', ['product_id' => $product->id, 'quantity' => 1])
            ->assertCreated();
        $cartToken = $cartResponse->headers->get(self::TOKEN_HEADER);
        $headers = array_merge($this->bearer($store['token']), [self::TOKEN_HEADER => $cartToken]);

        $this->withHeaders($headers)->postJson('/commerce/v1/checkout', [])->assertCreated();
        $this->withHeaders($headers)->patchJson('/commerce/v1/checkout/contact', ['name' => 'x', 'phone' => 'y'])->assertOk();
        $this->withHeaders($headers)->patchJson('/commerce/v1/checkout/address', ['country' => 'SA', 'city' => 'x', 'street' => 'y'])->assertOk();
        $this->withHeaders($headers)->patchJson('/commerce/v1/checkout/delivery', ['method' => 'pickup'])->assertOk();

        $key = (string) Str::uuid();
        $first = $this->withHeaders(array_merge($headers, ['Idempotency-Key' => $key]))
            ->postJson('/commerce/v1/checkout/complete', [])->assertCreated();
        $second = $this->withHeaders(array_merge($headers, ['Idempotency-Key' => $key]))
            ->postJson('/commerce/v1/checkout/complete', [])->assertOk();

        $this->assertSame($first->json('data.order.id'), $second->json('data.order.id'));
        $this->assertSame($first->json('data.order_reference'), $second->json('data.order_reference'));
        $this->assertTrue($second->json('data.replayed'));

        // والمرجع المعاد يفتح الطلب نفسه عبر endpoint PR-5.
        $this->getOrder($store, $second->json('data.order.id'), $second->json('data.order_reference'))->assertOk();
    }

    /** @test */
    public function the_reference_is_deterministic_for_a_given_order(): void
    {
        $store = $this->seedMobileStore('pr5-deterministic');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $completed = $this->completedOrder($store, $product);

        $order = CommerceOrder::findOrFail($completed['order_id']);
        $this->assertSame($completed['reference'], CommerceOrderReference::issue($order));
    }

    // ── Read-only boundary ───────────────────────────────────────────────

    /** @test */
    public function fetching_an_order_creates_no_accounting_payment_or_inventory_side_effects(): void
    {
        $store = $this->seedMobileStore('pr5-read-only');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $completed = $this->completedOrder($store, $product);

        $this->getOrder($store, $completed['order_id'], $completed['reference'])->assertOk();
        $this->getOrder($store, $completed['order_id'], $completed['reference'])->assertOk();

        $this->assertSame(0, DB::table('journal_entries')->count());
        $this->assertSame(0, DB::table('journal_lines')->count());
        $this->assertSame(0, DB::table('stock_movements')->count());
        $this->assertDatabaseCount('commerce_orders', 1);
    }

    /** @test */
    public function fetching_an_order_does_not_mutate_order_checkout_or_cart(): void
    {
        $store = $this->seedMobileStore('pr5-no-mutation');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $completed = $this->completedOrder($store, $product);

        $before = [
            'order' => DB::table('commerce_orders')->where('id', $completed['order_id'])->first(),
            'checkouts' => DB::table('commerce_checkouts')->count(),
            'carts' => DB::table('commerce_carts')->count(),
        ];

        $this->getOrder($store, $completed['order_id'], $completed['reference'])->assertOk();

        $this->assertEquals($before['order'], DB::table('commerce_orders')->where('id', $completed['order_id'])->first());
        $this->assertSame($before['checkouts'], DB::table('commerce_checkouts')->count());
        $this->assertSame($before['carts'], DB::table('commerce_carts')->count());
    }
}
