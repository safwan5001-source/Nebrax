<?php

namespace Tests\Feature;

use App\Models\CommerceCart;
use App\Models\CommerceListing;
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
 * ═══════════════════════════════════════════════════════════════
 *  Public/Mobile Commerce API V1 — COM-MOBILE-CART-IDENTITY-1 (ADR-07)
 * ═══════════════════════════════════════════════════════════════
 *  يثبت سياسة الدمج (Merge) المعتمدة: تبنّي سلة الضيف عند غياب سلة عميل
 *  قائمة، ودمج سطورها في سلة العميل القائمة بنفس دلالة `add()` (جمع كمية
 *  السطر المطابق، سطر منفصل لمتغيّر/وحدة مختلفة) عند وجودها؛ سلة الضيف
 *  المصدر تصبح نهائية (`consumed`) ولا تُدمَج مرّتين؛ لا تجميد سعر؛ عزل
 *  مستأجر/عميل صارم؛ توافقٌ خلفي كامل مع مسار الضيف.
 *
 *  تشغيل: php artisan test --filter=CommerceCartMergeApiTest
 */
class CommerceCartMergeApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

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

    private function product(Tenant $tenant, SalesChannel $channel, string $sku, int $price = 10000): Product
    {
        app(TenantContext::class)->set($tenant->id);
        $product = Product::create([
            'name' => "منتج {$sku}", 'sku' => $sku, 'sale_price' => $price, 'unit' => 'piece', 'is_active' => true,
        ]);
        CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $channel->id, 'is_published' => true]);
        app(TenantContext::class)->forget();

        return $product->fresh();
    }

    private function bearer(string $token): array
    {
        return ['Authorization' => 'Bearer '.$token];
    }

    private function withCart(string $apiToken, ?string $cartToken = null): array
    {
        $headers = $this->bearer($apiToken);
        if ($cartToken !== null) {
            $headers['X-Cart-Token'] = $cartToken;
        }

        return $headers;
    }

    private function withCustomer(string $apiToken, string $customerToken, ?string $cartToken = null): array
    {
        return $this->withCart($apiToken, $cartToken) + ['X-Customer-Token' => $customerToken];
    }

    /** Authenticates via phone+OTP (COM-MOBILE-AUTH-1) and returns the customer token. */
    private function loginCustomer(array $store, string $phone): string
    {
        $this->postJson('/commerce/v1/auth/otp/request', ['phone' => $phone], $this->bearer($store['token']));
        $code = FakeOtpProvider::lastCodeFor($store['tenant']->id, $phone, 'login');
        $response = $this->postJson('/commerce/v1/auth/otp/verify', ['phone' => $phone, 'code' => $code], $this->bearer($store['token']))->assertOk();

        return $response->json('data.token');
    }

    // ═══════════════════════════════════════════════════════════
    //  Claim — no existing customer cart
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function authenticating_with_a_guest_cart_and_no_existing_customer_cart_claims_it(): void
    {
        $store = $this->seedMobileStore('claim');
        $product = $this->product($store['tenant'], $store['channel'], 'CLAIM-1');

        $add = $this->postJson('/commerce/v1/cart/items', [
            'product_id' => $product->id, 'quantity' => 2,
        ], $this->withCart($store['token']))->assertCreated();
        $guestToken = $add->headers->get('X-Cart-Token');

        $customerToken = $this->loginCustomer($store, '+966500000101');

        $response = $this->getJson('/commerce/v1/cart', $this->withCustomer($store['token'], $customerToken, $guestToken))
            ->assertOk();

        $response->assertJsonCount(1, 'data.items');
        $response->assertJsonPath('data.items.0.quantity', 2);

        // Claimed outright: the guest cart itself became the customer's,
        // no new cart, one row total.
        $this->assertSame(1, CommerceCart::query()->count());
        $cart = CommerceCart::query()->first();
        $identity = \App\Models\CustomerIdentity::query()->where('phone_e164', '+966500000101')->firstOrFail();
        $this->assertSame($identity->id, $cart->customer_identity_id);
        $this->assertSame(CommerceCart::STATUS_ACTIVE, $cart->status);
    }

    // ═══════════════════════════════════════════════════════════
    //  Merge — customer already has an active cart
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function merging_sums_quantity_for_an_identical_line_and_keeps_distinct_lines_separate(): void
    {
        $store = $this->seedMobileStore('merge');
        $shared = $this->product($store['tenant'], $store['channel'], 'MERGE-SHARED');
        $guestOnly = $this->product($store['tenant'], $store['channel'], 'MERGE-GUEST-ONLY');
        $customerOnly = $this->product($store['tenant'], $store['channel'], 'MERGE-CUSTOMER-ONLY');

        $customerToken = $this->loginCustomer($store, '+966500000102');

        // Customer already has a cart with the shared product (qty 3) and one of their own.
        $this->postJson('/commerce/v1/cart/items', ['product_id' => $shared->id, 'quantity' => 3], $this->withCustomer($store['token'], $customerToken))->assertCreated();
        $this->postJson('/commerce/v1/cart/items', ['product_id' => $customerOnly->id, 'quantity' => 1], $this->withCustomer($store['token'], $customerToken))->assertOk();

        // A separate guest session adds the shared product (qty 5) and a guest-only product.
        $guestAdd = $this->postJson('/commerce/v1/cart/items', ['product_id' => $shared->id, 'quantity' => 5], $this->withCart($store['token']))->assertCreated();
        $guestToken = $guestAdd->headers->get('X-Cart-Token');
        $this->postJson('/commerce/v1/cart/items', ['product_id' => $guestOnly->id, 'quantity' => 2], $this->withCart($store['token'], $guestToken))->assertOk();

        // Presenting both tokens together triggers the merge.
        $response = $this->getJson('/commerce/v1/cart', $this->withCustomer($store['token'], $customerToken, $guestToken))->assertOk();

        $items = collect($response->json('data.items'))->keyBy('product_id');
        $this->assertSame(8, $items[$shared->id]['quantity']); // 3 + 5 summed
        $this->assertSame(1, $items[$customerOnly->id]['quantity']);
        $this->assertSame(2, $items[$guestOnly->id]['quantity']);
        $this->assertCount(3, $items);

        // Exactly one cart remains active; the guest cart is now consumed.
        $this->assertSame(1, CommerceCart::query()->where('status', CommerceCart::STATUS_ACTIVE)->count());
        $this->assertSame(1, CommerceCart::query()->where('status', CommerceCart::STATUS_CONSUMED)->count());
    }

    /** @test */
    public function a_merged_response_rebinds_the_cart_token_so_subsequent_requests_keep_working(): void
    {
        $store = $this->seedMobileStore('rebind');
        $shared = $this->product($store['tenant'], $store['channel'], 'REBIND-1');

        $customerToken = $this->loginCustomer($store, '+966500000103');
        $this->postJson('/commerce/v1/cart/items', ['product_id' => $shared->id, 'quantity' => 1], $this->withCustomer($store['token'], $customerToken))->assertCreated();

        $guestAdd = $this->postJson('/commerce/v1/cart/items', ['product_id' => $shared->id, 'quantity' => 1], $this->withCart($store['token']))->assertCreated();
        $guestToken = $guestAdd->headers->get('X-Cart-Token');

        $mergeResponse = $this->getJson('/commerce/v1/cart', $this->withCustomer($store['token'], $customerToken, $guestToken))->assertOk();
        $newCartToken = $mergeResponse->headers->get('X-Cart-Token');

        $this->assertNotNull($newCartToken);
        $this->assertNotSame($guestToken, $newCartToken);

        // The new token resolves the merged cart even without X-Customer-Token
        // (checkout reuses this exact mechanism unmodified).
        $reread = $this->getJson('/commerce/v1/cart', $this->withCart($store['token'], $newCartToken))->assertOk();
        $reread->assertJsonPath('data.items.0.quantity', 2);
    }

    // ═══════════════════════════════════════════════════════════
    //  Idempotency — repeated authentication/merge must not duplicate
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function replaying_the_same_guest_token_after_a_merge_does_not_duplicate_quantities(): void
    {
        $store = $this->seedMobileStore('replay');
        $product = $this->product($store['tenant'], $store['channel'], 'REPLAY-1');

        $customerToken = $this->loginCustomer($store, '+966500000104');
        $this->postJson('/commerce/v1/cart/items', ['product_id' => $product->id, 'quantity' => 1], $this->withCustomer($store['token'], $customerToken))->assertCreated();

        $guestAdd = $this->postJson('/commerce/v1/cart/items', ['product_id' => $product->id, 'quantity' => 4], $this->withCart($store['token']))->assertCreated();
        $guestToken = $guestAdd->headers->get('X-Cart-Token');

        $this->getJson('/commerce/v1/cart', $this->withCustomer($store['token'], $customerToken, $guestToken))->assertOk();

        // Replay: same (now-consumed) guest token presented again.
        $second = $this->getJson('/commerce/v1/cart', $this->withCustomer($store['token'], $customerToken, $guestToken))->assertOk();

        $second->assertJsonPath('data.items.0.quantity', 5); // 1 + 4, never doubled to 9 or 10
    }

    /** @test */
    public function claiming_the_same_guest_cart_twice_in_a_row_is_a_no_op_the_second_time(): void
    {
        $store = $this->seedMobileStore('claim-replay');
        $product = $this->product($store['tenant'], $store['channel'], 'CLAIM-REPLAY-1');

        $add = $this->postJson('/commerce/v1/cart/items', ['product_id' => $product->id, 'quantity' => 2], $this->withCart($store['token']))->assertCreated();
        $guestToken = $add->headers->get('X-Cart-Token');

        $customerToken = $this->loginCustomer($store, '+966500000105');

        $first = $this->getJson('/commerce/v1/cart', $this->withCustomer($store['token'], $customerToken, $guestToken))->assertOk();
        $second = $this->getJson('/commerce/v1/cart', $this->withCustomer($store['token'], $customerToken, $guestToken))->assertOk();

        $first->assertJsonPath('data.items.0.quantity', 2);
        $second->assertJsonPath('data.items.0.quantity', 2);
        $this->assertSame(1, CommerceCart::query()->count());
    }

    // ═══════════════════════════════════════════════════════════
    //  Stale/unpurchasable line — must not block the merge
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_guest_line_that_is_no_longer_purchasable_is_dropped_not_merged_and_does_not_block_sign_in(): void
    {
        $store = $this->seedMobileStore('stale-line');
        $anchor = $this->product($store['tenant'], $store['channel'], 'STALE-ANCHOR');
        $stillGood = $this->product($store['tenant'], $store['channel'], 'STALE-GOOD');
        $goingStale = $this->product($store['tenant'], $store['channel'], 'STALE-BAD');

        // A pre-existing customer cart forces the merge path (not claim) —
        // dropping an unpurchasable line is specifically a merge behavior;
        // a claimed guest cart's own stale lines behave like any guest
        // cart's already-tolerated unavailable lines (serialize() shows
        // them as available:false, exactly as today).
        $customerToken = $this->loginCustomer($store, '+966500000106');
        $this->postJson('/commerce/v1/cart/items', ['product_id' => $anchor->id, 'quantity' => 1], $this->withCustomer($store['token'], $customerToken))->assertCreated();

        $guestAdd = $this->postJson('/commerce/v1/cart/items', ['product_id' => $stillGood->id, 'quantity' => 1], $this->withCart($store['token']))->assertCreated();
        $guestToken = $guestAdd->headers->get('X-Cart-Token');
        $this->postJson('/commerce/v1/cart/items', ['product_id' => $goingStale->id, 'quantity' => 1], $this->withCart($store['token'], $guestToken))->assertOk();

        // The second product becomes unpublished (no longer purchasable) before login.
        app(TenantContext::class)->set($store['tenant']->id);
        \App\Models\CommerceListing::query()->where('product_id', $goingStale->id)->update(['is_published' => false]);
        app(TenantContext::class)->forget();

        $response = $this->getJson('/commerce/v1/cart', $this->withCustomer($store['token'], $customerToken, $guestToken))->assertOk();

        $items = collect($response->json('data.items'))->pluck('product_id');
        $this->assertTrue($items->contains($anchor->id));
        $this->assertTrue($items->contains($stillGood->id));
        $this->assertFalse($items->contains($goingStale->id));
        $this->assertCount(2, $items);
    }

    // ═══════════════════════════════════════════════════════════
    //  Multi-device — a second device must not discard the first's cart
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_second_device_with_no_guest_cart_receives_the_customers_existing_cart_unchanged(): void
    {
        $store = $this->seedMobileStore('multidevice');
        $product = $this->product($store['tenant'], $store['channel'], 'MULTI-1');

        $customerToken = $this->loginCustomer($store, '+966500000107');
        $this->postJson('/commerce/v1/cart/items', ['product_id' => $product->id, 'quantity' => 3], $this->withCustomer($store['token'], $customerToken))->assertCreated();

        // Device B: same customer, no guest cart at all (fresh install).
        $deviceB = $this->getJson('/commerce/v1/cart', $this->withCustomer($store['token'], $customerToken))->assertOk();

        $deviceB->assertJsonPath('data.items.0.quantity', 3);
        $this->assertNotNull($deviceB->headers->get('X-Cart-Token'));
        $this->assertSame(1, CommerceCart::query()->count());
    }

    // ═══════════════════════════════════════════════════════════
    //  No pricing/availability logic duplicated — still resolved live
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function merged_cart_prices_are_resolved_live_not_frozen_from_either_source_cart(): void
    {
        $store = $this->seedMobileStore('live-price');
        $product = $this->product($store['tenant'], $store['channel'], 'PRICE-1', price: 10000);

        $customerToken = $this->loginCustomer($store, '+966500000108');
        $this->postJson('/commerce/v1/cart/items', ['product_id' => $product->id, 'quantity' => 1], $this->withCustomer($store['token'], $customerToken))->assertCreated();

        $guestAdd = $this->postJson('/commerce/v1/cart/items', ['product_id' => $product->id, 'quantity' => 1], $this->withCart($store['token']))->assertCreated();
        $guestToken = $guestAdd->headers->get('X-Cart-Token');

        // Price changes after both lines were added, before the merge read.
        app(TenantContext::class)->set($store['tenant']->id);
        $product->update(['sale_price' => 25000]);
        app(TenantContext::class)->forget();

        $response = $this->getJson('/commerce/v1/cart', $this->withCustomer($store['token'], $customerToken, $guestToken))->assertOk();

        $response->assertJsonPath('data.items.0.unit_price.amount_minor', 25000);
    }

    // ═══════════════════════════════════════════════════════════
    //  Tenant isolation
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_customer_token_from_a_foreign_tenant_never_resolves_or_merges_this_tenants_cart(): void
    {
        $storeA = $this->seedMobileStore('tenant-a');
        $storeB = $this->seedMobileStore('tenant-b');
        $product = $this->product($storeA['tenant'], $storeA['channel'], 'ISO-1');

        $add = $this->postJson('/commerce/v1/cart/items', ['product_id' => $product->id, 'quantity' => 1], $this->withCart($storeA['token']))->assertCreated();
        $guestToken = $add->headers->get('X-Cart-Token');

        // A customer authenticated against tenant B, presenting tenant A's guest cart token
        // alongside tenant B's own store bearer — the customer token itself will not even
        // validate under tenant B's ApiClient/TenantContext.
        $customerTokenB = $this->loginCustomer($storeB, '+966500000109');

        $response = $this->getJson('/commerce/v1/cart', $this->withCustomer($storeB['token'], $customerTokenB, $guestToken))->assertOk();

        // Tenant B's cart context never sees tenant A's guest cart (different tenant scope) —
        // resolves to an empty cart, not tenant A's data.
        $this->assertSame(0, count($response->json('data.items')));

        // Tenant A's guest cart is untouched (still active, still guest, still has its line).
        app(TenantContext::class)->set($storeA['tenant']->id);
        $cartA = CommerceCart::query()->first();
        $this->assertSame(CommerceCart::STATUS_ACTIVE, $cartA->status);
        $this->assertNull($cartA->customer_identity_id);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_cart_token_already_claimed_by_a_different_customer_never_leaks_to_this_customer(): void
    {
        $store = $this->seedMobileStore('cross-customer');
        $product = $this->product($store['tenant'], $store['channel'], 'XCUST-1');

        $victimToken = $this->loginCustomer($store, '+966500000111');
        $this->postJson('/commerce/v1/cart/items', ['product_id' => $product->id, 'quantity' => 7], $this->withCustomer($store['token'], $victimToken))->assertCreated();
        $victimCartToken = $this->getJson('/commerce/v1/cart', $this->withCustomer($store['token'], $victimToken))
            ->assertOk()->headers->get('X-Cart-Token');

        $attackerToken = $this->loginCustomer($store, '+966500000112');

        // The attacker somehow presents the victim's own (already-claimed)
        // cart token alongside their own valid customer token.
        $response = $this->getJson('/commerce/v1/cart', $this->withCustomer($store['token'], $attackerToken, $victimCartToken))
            ->assertOk();

        $this->assertSame(0, count($response->json('data.items')));

        // The victim's cart is untouched: still theirs, still 7, never reassigned.
        $victim = \App\Models\CustomerIdentity::query()->where('phone_e164', '+966500000111')->firstOrFail();
        $victimCart = CommerceCart::query()->where('customer_identity_id', $victim->id)->firstOrFail();
        $this->assertSame(7, $victimCart->items()->sum('quantity'));
    }

    // ═══════════════════════════════════════════════════════════
    //  Guest backward compatibility
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function guest_cart_flow_is_completely_unaffected_without_a_customer_token(): void
    {
        $store = $this->seedMobileStore('guest-compat');
        $product = $this->product($store['tenant'], $store['channel'], 'GUEST-1');

        $add = $this->postJson('/commerce/v1/cart/items', ['product_id' => $product->id, 'quantity' => 2], $this->withCart($store['token']))->assertCreated();
        $guestToken = $add->headers->get('X-Cart-Token');

        $show = $this->getJson('/commerce/v1/cart', $this->withCart($store['token'], $guestToken))->assertOk();
        $show->assertJsonPath('data.items.0.quantity', 2);

        $cart = CommerceCart::query()->firstOrFail();
        $this->assertNull($cart->customer_identity_id);
    }

    /** @test */
    public function a_brand_new_cart_created_while_authenticated_is_tagged_with_the_customer_identity_from_the_start(): void
    {
        $store = $this->seedMobileStore('fresh-auth');
        $product = $this->product($store['tenant'], $store['channel'], 'FRESH-1');

        $customerToken = $this->loginCustomer($store, '+966500000110');
        $this->postJson('/commerce/v1/cart/items', ['product_id' => $product->id, 'quantity' => 1], $this->withCustomer($store['token'], $customerToken))->assertCreated();

        $identity = \App\Models\CustomerIdentity::query()->where('phone_e164', '+966500000110')->firstOrFail();
        $cart = CommerceCart::query()->firstOrFail();
        $this->assertSame($identity->id, $cart->customer_identity_id);
    }
}
