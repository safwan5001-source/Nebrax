<?php

namespace Tests\Feature;

use App\Models\CommerceListing;
use App\Models\CommerceOrder;
use App\Models\CommerceShippingZone;
use App\Models\PaymentMethod;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Services\Commerce\Otp\FakeOtpProvider;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * COM-MOBILE-VERTICAL-TEST-1 (ADR-13 §2, authenticated journey) — one
 * continuous `/commerce/v1` scenario: authentication → catalog → cart
 * identity (guest cart claimed on sign-in, ADR-07) → saved address
 * (ADR-08) → checkout → order completion → order history list/detail
 * (COM-MOBILE-ORDER-HISTORY-1). Incorporates Shipping (ADR-10) and
 * Payments (ADR-09), per ADR-13 §5's incremental-extension instruction,
 * exactly as the guest journey test does.
 *
 * This proves composition across four previously-separate tasks at once —
 * a customer who adds to cart *before* signing in, signs in, and finds
 * their guest selections carried into an order that both shows up in their
 * own history and whose delivery address was never re-typed by hand:
 *
 *  guest cart (no identity) --sign-in--> claimed cart (ADR-07)
 *      --checkout uses saved address_id (ADR-08)--> real shipping+payment
 *      legs (ADR-09/10) --complete--> order visible in own history
 *      (COM-MOBILE-ORDER-HISTORY-1), address book entry independent of it
 *      (Order Snapshot Rule).
 *
 * تشغيل: php artisan test --filter=CommerceMobileAuthenticatedJourneyTest
 */
class CommerceMobileAuthenticatedJourneyTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const CART_TOKEN_HEADER = 'X-Cart-Token';

    /** @test */
    public function an_authenticated_customer_completes_the_full_journey_with_a_claimed_cart_and_a_saved_address(): void
    {
        $store = $this->seedMobileStore('auth-journey');
        $product = $this->publishedProduct($store, priceMinor: 6000);
        $this->seedShippingZone($store, city: 'جدة', rateMinor: 1500);
        $method = $this->seedEnabledPaymentMethod($store, name: 'تحويل بنكي');

        // ── 1. Browse and add to cart as a guest — *before* signing in ──
        $addResponse = $this->withHeaders($this->bearer($store['token']))
            ->postJson('/commerce/v1/cart/items', ['product_id' => $product->id, 'quantity' => 3])
            ->assertCreated();
        $guestCartToken = $addResponse->headers->get(self::CART_TOKEN_HEADER);
        $this->assertNotEmpty($guestCartToken);

        // ── 2. Authenticate — the guest cart is claimed on first request
        //      that presents both tokens together (ADR-07) ──────────────
        $phone = '+9665'.random_int(10000000, 99999999);
        $this->withHeaders($this->bearer($store['token']))
            ->postJson('/commerce/v1/auth/otp/request', ['phone' => $phone])->assertStatus(202);
        $code = FakeOtpProvider::lastCodeFor($store['tenant']->id, $phone, 'login');
        $customerToken = $this->withHeaders($this->bearer($store['token']))
            ->postJson('/commerce/v1/auth/otp/verify', ['phone' => $phone, 'code' => $code])
            ->assertOk()->json('data.token');

        $claimed = $this->withHeaders($this->bearer($store['token']) + [
            'X-Customer-Token' => $customerToken, self::CART_TOKEN_HEADER => $guestCartToken,
        ])->getJson('/commerce/v1/cart')->assertOk();
        $this->assertCount(1, $claimed->json('data.items'), 'السلة المُطالَب بها تحمل نفس بند الضيف.');
        $this->assertSame(3, $claimed->json('data.items.0.quantity'));

        // From here on, requests may keep presenting the same guest cart
        // token (now bound to this customer) alongside X-Customer-Token —
        // exactly how a real client would continue the same session.
        $sessionHeaders = $this->bearer($store['token']) + [
            'X-Customer-Token' => $customerToken, self::CART_TOKEN_HEADER => $guestCartToken,
        ];

        // ── 3. Save an address, then select it at checkout by id ────────
        $address = $this->withHeaders($this->bearer($store['token']) + ['X-Customer-Token' => $customerToken])
            ->postJson('/commerce/v1/addresses', [
                'recipient_name' => 'نورة العبدالله', 'phone' => '0509876543',
                'country' => 'SA', 'city' => 'جدة', 'street' => 'طريق المدينة',
                'district' => 'الروضة', 'building_no' => '4321', 'postal_code' => '23442', 'additional_number' => '8765',
            ])->assertCreated()->json('data');

        $this->withHeaders($sessionHeaders)->postJson('/commerce/v1/checkout', [])->assertCreated();
        $this->withHeaders($sessionHeaders)
            ->patchJson('/commerce/v1/checkout/contact', ['name' => 'نورة العبدالله', 'phone' => '0509876543'])
            ->assertOk();

        $afterAddress = $this->withHeaders($sessionHeaders)
            ->patchJson('/commerce/v1/checkout/address', ['address_id' => $address['id']])
            ->assertOk()->json('data');
        // Copied in, not referenced: the checkout now carries the saved
        // address's own field values.
        $this->assertSame('جدة', $afterAddress['delivery']['address']['city']);
        $this->assertSame('طريق المدينة', $afterAddress['delivery']['address']['street']);
        $this->assertSame('4321', $afterAddress['delivery']['address']['building_no']);

        $afterDelivery = $this->withHeaders($sessionHeaders)
            ->patchJson('/commerce/v1/checkout/delivery', ['method' => 'standard'])
            ->assertOk()->json('data');
        $this->assertSame(1500, $afterDelivery['delivery']['amount']['amount_minor']);

        $this->withHeaders($sessionHeaders)
            ->patchJson('/commerce/v1/checkout/payment', ['payment_method_id' => $method->id])
            ->assertOk()->assertJsonPath('data.payment.payment_method_name', 'تحويل بنكي');

        // ── 4. Complete ──────────────────────────────────────────────────
        $completion = $this->withHeaders($sessionHeaders + ['Idempotency-Key' => 'auth-journey-1'])
            ->postJson('/commerce/v1/checkout/complete', [])
            ->assertCreated()->json('data');

        $order = $completion['order'];
        $this->assertSame(19500, $order['total']['amount_minor'], '18000 (٣×٦٠٠٠) + 1500 شحن.');
        $this->assertSame('جدة', $order['delivery']['city']);
        $this->assertSame('تحويل بنكي', $order['payment']['payment_method_name']);

        // ── 5. Order history — list and detail, as this same customer ──
        $historyList = $this->withHeaders($this->bearer($store['token']) + ['X-Customer-Token' => $customerToken])
            ->getJson('/commerce/v1/me/orders')->assertOk()->json('data');
        $this->assertCount(1, $historyList);
        $this->assertSame($order['id'], $historyList[0]['id']);
        $this->assertSame(19500, $historyList[0]['total']['amount_minor']);

        $historyDetail = $this->withHeaders($this->bearer($store['token']) + ['X-Customer-Token' => $customerToken])
            ->getJson("/commerce/v1/me/orders/{$order['id']}")->assertOk()->json('data.order');
        $this->assertSame($order['number'], $historyDetail['number']);
        $this->assertNotEmpty($historyDetail['items']);
        $this->assertSame(3, $historyDetail['items'][0]['quantity']);

        // Linked at the data layer too — not merely visible via the API.
        $this->assertSame(
            \App\Models\CustomerIdentity::query()->where('phone', $phone)->value('id'),
            CommerceOrder::withoutGlobalScopes()->whereKey($order['id'])->value('customer_identity_id'),
        );
    }

    /** @test */
    public function editing_a_saved_address_after_checkout_never_changes_the_already_completed_order(): void
    {
        $store = $this->seedMobileStore('auth-snapshot');
        $product = $this->publishedProduct($store, priceMinor: 4000);
        $customerToken = $this->authenticatedCustomer($store);

        $address = $this->withHeaders($this->bearer($store['token']) + ['X-Customer-Token' => $customerToken])
            ->postJson('/commerce/v1/addresses', [
                'recipient_name' => 'خالد', 'phone' => '0501112222',
                'country' => 'SA', 'city' => 'الرياض', 'street' => 'شارع أ',
                'district' => 'العليا', 'building_no' => '1111', 'postal_code' => '11111', 'additional_number' => '2222',
            ])->assertCreated()->json('data');

        $sessionHeaders = $this->bearer($store['token']) + ['X-Customer-Token' => $customerToken];
        $cartAdd = $this->withHeaders($sessionHeaders)
            ->postJson('/commerce/v1/cart/items', ['product_id' => $product->id, 'quantity' => 1])->assertCreated();
        $sessionHeaders[self::CART_TOKEN_HEADER] = $cartAdd->headers->get(self::CART_TOKEN_HEADER);
        $this->withHeaders($sessionHeaders)->postJson('/commerce/v1/checkout', [])->assertCreated();
        $this->withHeaders($sessionHeaders)
            ->patchJson('/commerce/v1/checkout/contact', ['name' => 'خالد', 'phone' => '0501112222'])->assertOk();
        $this->withHeaders($sessionHeaders)
            ->patchJson('/commerce/v1/checkout/address', ['address_id' => $address['id']])->assertOk();
        $this->withHeaders($sessionHeaders)
            ->patchJson('/commerce/v1/checkout/delivery', ['method' => 'pickup'])->assertOk();

        $order = $this->withHeaders($sessionHeaders + ['Idempotency-Key' => 'auth-snapshot-1'])
            ->postJson('/commerce/v1/checkout/complete', [])->assertCreated()->json('data.order');
        $this->assertSame('الرياض', $order['delivery']['city']);

        // Edit the saved address *after* the order already exists.
        $this->withHeaders($sessionHeaders)
            ->patchJson("/commerce/v1/addresses/{$address['id']}", ['city' => 'الدمام'])
            ->assertOk()->assertJsonPath('data.city', 'الدمام');

        // The already-completed order's own snapshot must be untouched.
        $reread = $this->withHeaders($sessionHeaders)
            ->getJson("/commerce/v1/me/orders/{$order['id']}")->assertOk()->json('data.order');
        $this->assertSame('الرياض', $reread['delivery']['city'], 'تعديل عنوانٍ محفوظ لا يغيّر طلباً مكتملاً سابقاً.');
    }

    // ══ تركيبات ═════════════════════════════════════════════════════════

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

        $client = app(ApiClientKeyService::class)->createClient($tenant, 'mobile-app', true);
        $key = app(ApiClientKeyService::class)->issueKey($client, 'default', []);

        return ['tenant' => $tenant, 'channel' => $channel, 'token' => $key->plainTextToken];
    }

    private function bearer(string $token): array
    {
        return ['Authorization' => 'Bearer '.$token];
    }

    private function publishedProduct(array $store, int $priceMinor): Product
    {
        app(TenantContext::class)->set($store['tenant']->id);
        $product = Product::create([
            'sku' => 'SKU-'.Str::random(6), 'name' => 'منتج منشور', 'name_en' => 'Published Product',
            'type' => 'good', 'unit' => 'piece', 'sale_price' => $priceMinor, 'tax_rate' => 15, 'is_active' => true,
        ]);
        CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $store['channel']->id, 'is_published' => true]);
        app(TenantContext::class)->forget();

        return $product->fresh();
    }

    private function seedShippingZone(array $store, string $city, int $rateMinor): CommerceShippingZone
    {
        app(TenantContext::class)->set($store['tenant']->id);
        $zone = CommerceShippingZone::create([
            'name' => "منطقة {$city}", 'match_type' => 'city', 'match_value' => $city,
            'rate_amount_minor' => $rateMinor, 'is_active' => true,
        ]);
        app(TenantContext::class)->forget();

        return $zone->fresh();
    }

    private function seedEnabledPaymentMethod(array $store, string $name): PaymentMethod
    {
        app(TenantContext::class)->set($store['tenant']->id);
        $method = PaymentMethod::create([
            'name' => $name, 'settlement_type' => 'bank', 'available_online' => true, 'is_active' => true,
        ]);
        app(TenantContext::class)->forget();

        return $method->fresh();
    }

    /** يسجّل عميلاً عبر OTP ويعيد رمز customer:access. */
    private function authenticatedCustomer(array $store): string
    {
        $phone = '+9665'.random_int(10000000, 99999999);
        $this->withHeaders($this->bearer($store['token']))->postJson('/commerce/v1/auth/otp/request', ['phone' => $phone])->assertStatus(202);
        $code = FakeOtpProvider::lastCodeFor($store['tenant']->id, $phone, 'login');

        return $this->withHeaders($this->bearer($store['token']))
            ->postJson('/commerce/v1/auth/otp/verify', ['phone' => $phone, 'code' => $code])
            ->assertOk()->json('data.token');
    }
}
