<?php

namespace Tests\Feature;

use App\Mail\BuyerPasswordResetMail;
use App\Mail\BuyerVerificationMail;
use App\Models\CommerceCustomerAddress;
use App\Models\CommerceListing;
use App\Models\CommerceOrder;
use App\Models\CommerceOrderOwnershipClaim;
use App\Models\CustomerIdentity;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Services\Commerce\CommerceCartService;
use App\Support\CommerceOrderReference;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use LogicException;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  B2C-ACCOUNTS — حسابات عملاء التجزئة الأصلية على `store/v1`
 *  البوابة المغلقة · التسجيل/الدخول/الجلسات · الملف والعناوين · الطلبات والملكية (IDOR) · ربط طلبات الضيف
 * ═══════════════════════════════════════════════════════════════
 */
class RetailCustomerAccountsTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private const SECRET = 'retail-acct-secret';

    private const BASE = 'http://laravel-internal.test/store/v1/';

    private const RA = 'a.retail.test';

    private const RB = 'b.retail.test';

    private const DTC = 'closed.retail.test';

    private const WS = 'ws.retail.test';

    private Tenant $tenant;

    private SalesChannel $ra;

    private SalesChannel $rb;

    private Product $product;

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'commerce.retail_accounts_enabled' => true,
            'commerce.wholesale_buyer_enabled' => true,
            'storefront.gateway_secret' => self::SECRET,
            'commerce.buyer_password_reset_resend_gap_seconds' => 0,
        ]);
        Mail::fake();

        $this->tenant = Tenant::create(['name' => 'متجر الورد', 'slug' => 'rc-'.Str::random(8), 'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true]);
        app(TenantContext::class)->set($this->tenant->id);
        $this->ra = $this->web(self::RA, retail: true);
        $this->rb = $this->web(self::RB, retail: true);
        $dtc = $this->web(self::DTC);
        $ws = $this->web(self::WS, wholesale: true);
        $this->product = Product::create(['name' => 'باقة', 'sku' => 'RC-1', 'unit' => 'piece', 'sale_price' => 1000, 'is_active' => true]);
        foreach ([$this->ra, $this->rb, $dtc, $ws] as $c) {
            CommerceListing::create(['product_id' => $this->product->id, 'sales_channel_id' => $c->id, 'is_published' => true]);
        }
        app(TenantContext::class)->forget();
    }

    // ───────────────────────── أدوات ─────────────────────────

    private function web(string $host, bool $retail = false, bool $wholesale = false): SalesChannel
    {
        $channel = SalesChannel::create(['slug' => 'c-'.Str::random(5), 'name' => $host, 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $flags = array_filter(['customer_accounts_enabled' => $retail, 'wholesale_membership_enabled' => $wholesale]);
        if ($flags !== []) {
            $channel->forceFill($flags)->save();
        }
        $storefront = Storefront::create(['slug' => 's-'.Str::random(5), 'name' => $host, 'sales_channel_id' => $channel->id, 'is_active' => true]);
        StorefrontDomain::create(['storefront_id' => $storefront->id, 'hostname' => $host, 'type' => StorefrontDomain::TYPE_CUSTOM, 'is_active' => true, 'is_primary' => true, 'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED]);

        return $channel;
    }

    private function api(string $method, string $path, string $host, ?string $token = null, array $body = [], ?string $cart = null, ?string $idem = null, array $extraHeaders = [])
    {
        $this->flushHeaders();
        $this->unencryptedCookies = [];
        $headers = array_filter([
            'X-Storefront-Forwarded-Host' => $host, 'X-Storefront-Gateway-Secret' => self::SECRET,
            'X-Customer-Token' => $token, 'Idempotency-Key' => $idem,
        ]) + $extraHeaders;
        $t = $this->withHeaders($headers)->withCredentials();
        if ($cart !== null) {
            $t = $t->withUnencryptedCookie(CommerceCartService::COOKIE_NAME, $cart);
        }

        return $t->json($method, self::BASE.$path, $body);
    }

    private function identity(string $email, bool $verified = true, ?Tenant $tenant = null): CustomerIdentity
    {
        $tenant ??= $this->tenant;
        app(TenantContext::class)->set($tenant->id);
        $identity = CustomerIdentity::create(['tenant_id' => $tenant->id, 'display_name' => 'Shopper', 'email' => $email, 'password' => 'correct-horse-9', 'email_verified_at' => $verified ? now() : null, 'is_active' => true]);
        app(TenantContext::class)->forget();

        return $identity;
    }

    private function login(string $email, string $host = self::RA, array $extra = []): ?string
    {
        return $this->api('POST', 'auth/login', $host, null, ['email' => $email, 'password' => 'correct-horse-9'] + $extra)->json('data.token');
    }

    /** A guest order through the real cart + checkout. @return array{id:string,number:string,reference:string} */
    private function guestOrder(string $host, string $email = 'guest@example.com', string $key = 'k1', ?string $token = null): array
    {
        $add = $this->api('POST', 'cart/items', $host, $token, ['product_id' => $this->product->id, 'quantity' => 1, 'unit_key' => 'base'])->assertSuccessful();
        $cart = $add->getCookie(CommerceCartService::COOKIE_NAME, false)->getValue();
        $this->api('POST', 'checkout', $host, $token, [], $cart)->assertCreated();
        $this->api('PATCH', 'checkout/contact', $host, $token, ['name' => 'سالم', 'phone' => '0501234567', 'email' => $email], $cart)->assertOk();
        $this->api('PATCH', 'checkout/address', $host, $token, ['country' => 'SA', 'city' => 'الدمام', 'district' => 'الشاطئ', 'street' => 'الملك فهد', 'postal_code' => '31411'], $cart)->assertOk();
        $this->api('PATCH', 'checkout/delivery', $host, $token, ['method' => 'pickup'], $cart)->assertOk();
        $done = $this->api('POST', 'checkout/complete', $host, $token, [], $cart, 'order-key-'.$key)->assertCreated();

        $id = (string) $done->json('data.order.id');
        app(TenantContext::class)->set($this->tenant->id);
        // the signed reference is only returned inline when online checkout is on; it is the same pure function of the order
        $reference = CommerceOrderReference::issue(CommerceOrder::query()->findOrFail($id));
        app(TenantContext::class)->forget();

        return ['id' => $id, 'number' => (string) $done->json('data.order.number'), 'reference' => $reference, 'owner' => $done->json('data.order.customer_identity_id')];
    }

    private function addressBody(array $over = []): array
    {
        return $over + ['recipient_name' => 'سارة', 'phone' => '+966501234567', 'country' => 'SA', 'city' => 'الدمام', 'district' => 'الشاطئ', 'street' => 'الملك فهد', 'building_no' => '1234', 'additional_number' => '5678', 'postal_code' => '31411'];
    }

    // ═══════════════════════ البوابة مغلقة افتراضياً ═══════════════════════

    #[Test]
    public function everything_is_a_uniform_404_when_the_host_has_no_retail_accounts_and_guest_checkout_is_untouched(): void
    {
        foreach ([self::DTC, self::RA] as $host) {
            if ($host === self::RA) {
                config(['commerce.retail_accounts_enabled' => false]); // deployment flag off beats the channel flag
            }
            $this->api('POST', 'auth/register', $host, null, ['display_name' => 'x', 'email' => 'x@a.test', 'password' => 'long-enough-1'])->assertNotFound();
            $this->api('POST', 'auth/login', $host, null, ['email' => 'x@a.test', 'password' => 'long-enough-1'])->assertNotFound();
            $this->api('GET', 'me', $host, 'whatever')->assertNotFound();
            foreach (['account/profile', 'account/addresses', 'account/orders', 'account/sessions'] as $path) {
                $this->api('GET', $path, $host, 'whatever')->assertNotFound();
            }
            $this->api('POST', 'account/orders/claim', $host, 'whatever', ['order_number' => 'X'])->assertNotFound();
            $this->api('GET', 'storefront', $host)->assertOk()->assertJsonPath('data.capabilities.customer_accounts', false);
            $order = $this->guestOrder($host, key: 'closed-'.$host); // guest checkout works exactly as before
            $this->assertNotSame('', $order['reference']);
        }
    }

    #[Test]
    public function an_open_host_announces_the_capability_and_wholesale_routes_stay_closed_there(): void
    {
        $this->api('GET', 'storefront', self::RA)->assertOk()->assertJsonPath('data.capabilities.customer_accounts', true)->assertJsonPath('data.capabilities.wholesale_buyer', false);
        foreach (['buyer/orders', 'wholesale/membership', 'wholesale/access'] as $path) {
            $this->api('GET', $path, self::RA, 'whatever')->assertNotFound();
        }
        // opening retail accounts does not open anything wholesale on a wholesale host, and the wholesale host is not a retail one
        $this->api('GET', 'storefront', self::WS)->assertOk()->assertJsonPath('data.capabilities.customer_accounts', false)->assertJsonPath('data.capabilities.wholesale_buyer', true);
        $this->api('GET', 'account/profile', self::WS, 'whatever')->assertNotFound();
    }

    // ═══════════════════════ التسجيل والتأكيد والدخول والجلسات ═══════════════════════

    #[Test]
    public function register_verify_login_logout_roundtrip_with_a_link_to_the_retail_pages(): void
    {
        $this->api('POST', 'auth/register', self::RA, null, ['display_name' => 'سارة', 'email' => 'Sara@Shop.test', 'password' => 'long-enough-1', 'locale_path' => '/sa/ar'])
            ->assertStatus(202)->assertJsonPath('data.verification_required', true);

        $mails = Mail::sent(BuyerVerificationMail::class)->values()->all();
        $this->assertCount(1, $mails);
        $this->assertStringContainsString('https://'.self::RA.'/sa/ar/account/verify?token=', $mails[0]->url); // retail page family, not /buyer
        $this->assertTrue($mails[0]->retail);
        $this->assertStringNotContainsString('جملة', $mails[0]->render()); // a shopper is never told this is a wholesale account
        $this->assertStringNotContainsString('wholesale', strtolower($mails[0]->render()));

        // an unverified account cannot sign in
        $this->api('POST', 'auth/login', self::RA, null, ['email' => 'sara@shop.test', 'password' => 'long-enough-1'])->assertStatus(422);

        parse_str((string) parse_url($mails[0]->url, PHP_URL_QUERY), $q);
        $this->api('POST', 'auth/verify-email', self::RA, null, ['token' => $q['token']])->assertOk();

        $login = $this->api('POST', 'auth/login', self::RA, null, ['email' => 'sara@shop.test', 'password' => 'long-enough-1'])->assertOk();
        $token = (string) $login->json('data.token');
        $this->assertSame(30, $login->json('data.session_days'));
        $this->api('GET', 'me', self::RA, $token)->assertOk()->assertJsonPath('data.customer.email', 'Sara@Shop.test');

        $this->api('POST', 'auth/logout', self::RA, $token)->assertOk();
        $this->api('GET', 'me', self::RA, $token)->assertUnauthorized(); // revoked server-side
    }

    #[Test]
    public function remember_me_chooses_a_persistent_or_a_one_day_token_and_a_wholesale_host_keeps_its_default(): void
    {
        $this->identity('rem@shop.test');
        $long = $this->api('POST', 'auth/login', self::RA, null, ['email' => 'rem@shop.test', 'password' => 'correct-horse-9'])->assertOk();
        $short = $this->api('POST', 'auth/login', self::RA, null, ['email' => 'rem@shop.test', 'password' => 'correct-horse-9', 'remember' => false])->assertOk();
        $this->assertSame(30, $long->json('data.session_days'));
        $this->assertSame(1, $short->json('data.session_days'));

        $expiry = fn (string $token) => \Laravel\Sanctum\PersonalAccessToken::findToken($token)->expires_at;
        $this->assertTrue($expiry($long->json('data.token'))->isAfter(now()->addDays(29)));
        $this->assertTrue($expiry($short->json('data.token'))->isBefore(now()->addDays(2)));

        $ws = $this->api('POST', 'auth/login', self::WS, null, ['email' => 'rem@shop.test', 'password' => 'correct-horse-9'])->assertOk();
        $this->assertNull($ws->json('data.session_days'));
        $this->assertTrue($expiry($ws->json('data.token'))->isBefore(now()->addDays(8))); // the unchanged 7-day wholesale lifetime
    }

    #[Test]
    public function a_session_is_bound_to_its_channel_and_a_wholesale_token_never_reaches_account_routes(): void
    {
        $this->identity('bind@shop.test');
        $a = (string) $this->login('bind@shop.test', self::RA);
        $this->api('GET', 'account/profile', self::RB, $a)->assertUnauthorized(); // minted for RA, replayed on RB
        $this->api('GET', 'account/profile', self::RA, 'not-a-token')->assertUnauthorized();
        $this->api('GET', 'account/profile', self::RA)->assertUnauthorized();

        $ws = (string) $this->login('bind@shop.test', self::WS);
        $this->api('GET', 'account/profile', self::RA, $ws)->assertUnauthorized();
    }

    #[Test]
    public function sessions_are_listed_per_store_and_revocable_without_touching_anyone_else(): void
    {
        $me = $this->identity('s1@shop.test');
        $other = $this->identity('s2@shop.test');
        $t1 = (string) $this->login('s1@shop.test');
        $t2 = (string) $this->login('s1@shop.test');
        $tb = (string) $this->login('s1@shop.test', self::RB);
        $to = (string) $this->login('s2@shop.test');

        $list = $this->api('GET', 'account/sessions', self::RA, $t1)->assertOk();
        $this->assertCount(2, $list->json('data.sessions')); // RB's session is not listed on RA
        $this->assertCount(1, array_filter($list->json('data.sessions'), fn ($s) => $s['current']));
        $this->assertStringNotContainsString($t1, (string) $list->getContent());

        $otherId = (string) \Laravel\Sanctum\PersonalAccessToken::findToken($to)->getKey();
        $this->api('DELETE', 'account/sessions/'.$otherId, self::RA, $t1)->assertNotFound(); // someone else's session
        $rbId = (string) \Laravel\Sanctum\PersonalAccessToken::findToken($tb)->getKey();
        $this->api('DELETE', 'account/sessions/'.$rbId, self::RA, $t1)->assertNotFound(); // own session, other store
        $this->api('GET', 'me', self::RA, $to)->assertOk();

        $this->api('DELETE', 'account/sessions', self::RA, $t1)->assertOk(); // sign out everywhere else (on this account)
        $this->api('GET', 'me', self::RA, $t2)->assertUnauthorized();
        $this->api('GET', 'me', self::RA, $t1)->assertOk();
        $this->api('GET', 'me', self::RA, $to)->assertOk();
    }

    #[Test]
    public function changing_the_password_needs_the_current_one_and_ends_every_other_session(): void
    {
        $this->identity('pw@shop.test');
        $t1 = (string) $this->login('pw@shop.test');
        $t2 = (string) $this->login('pw@shop.test');

        $this->api('PUT', 'account/password', self::RA, $t1, ['current_password' => 'wrong-pass-xx', 'password' => 'brand-new-pass-1'])->assertStatus(422);
        $this->api('PUT', 'account/password', self::RA, $t1, ['current_password' => 'correct-horse-9', 'password' => 'short'])->assertStatus(422);
        $this->api('PUT', 'account/password', self::RA, $t1, ['current_password' => 'correct-horse-9', 'password' => 'brand-new-pass-1'])->assertOk();

        $this->api('GET', 'me', self::RA, $t1)->assertOk();
        $this->api('GET', 'me', self::RA, $t2)->assertUnauthorized();
        $this->assertNotNull($this->api('POST', 'auth/login', self::RA, null, ['email' => 'pw@shop.test', 'password' => 'brand-new-pass-1'])->json('data.token'));
        $this->api('POST', 'auth/login', self::RA, null, ['email' => 'pw@shop.test', 'password' => 'correct-horse-9'])->assertStatus(422);
    }

    #[Test]
    public function a_password_change_never_overwrites_a_reset_that_revoked_its_session(): void
    {
        $this->identity('race@shop.test');
        $t = (string) $this->login('race@shop.test');

        // an e-mailed reset lands first and ends every session
        $this->api('POST', 'auth/password/forgot', self::RA, null, ['email' => 'race@shop.test'])->assertStatus(202);
        $mail = Mail::sent(BuyerPasswordResetMail::class)->values()->last();
        parse_str((string) parse_url($mail->url, PHP_URL_QUERY), $q);
        $this->api('POST', 'auth/password/reset', self::RA, null, ['token' => $q['token'], 'password' => 'reset-by-mail-1'])->assertOk();

        // the stale session is rejected and the reset password survives
        $this->api('PUT', 'account/password', self::RA, $t, ['current_password' => 'correct-horse-9', 'password' => 'attacker-pass-1'])->assertUnauthorized();
        $this->assertNotNull($this->api('POST', 'auth/login', self::RA, null, ['email' => 'race@shop.test', 'password' => 'reset-by-mail-1'])->json('data.token'));
    }

    #[Test]
    public function password_recovery_mails_a_retail_page_link_and_ends_all_sessions(): void
    {
        $this->identity('rec@shop.test');
        $t = (string) $this->login('rec@shop.test');

        $this->api('POST', 'auth/password/forgot', self::RA, null, ['email' => 'rec@shop.test', 'locale_path' => '/sa/ar'])->assertStatus(202);
        $this->api('POST', 'auth/password/forgot', self::RA, null, ['email' => 'nobody@shop.test'])->assertStatus(202); // neutral
        $mails = Mail::sent(BuyerPasswordResetMail::class)->values()->all();
        $this->assertCount(1, $mails);
        $this->assertStringContainsString('https://'.self::RA.'/sa/ar/account/reset-password?token=', $mails[0]->url);
        $this->assertStringNotContainsString('جملة', $mails[0]->render());

        parse_str((string) parse_url($mails[0]->url, PHP_URL_QUERY), $q);
        $this->api('POST', 'auth/password/reset', self::RB, null, ['token' => $q['token'], 'password' => 'brand-new-pass-1'])->assertStatus(422); // other channel
        $this->api('POST', 'auth/password/reset', self::RA, null, ['token' => $q['token'], 'password' => 'brand-new-pass-1'])->assertOk();
        $this->api('GET', 'me', self::RA, $t)->assertUnauthorized();
        $this->api('POST', 'auth/password/reset', self::RA, null, ['token' => $q['token'], 'password' => 'another-pass-123'])->assertStatus(422); // single use
    }

    // ═══════════════════════ الملف الشخصي ═══════════════════════

    #[Test]
    public function the_profile_is_the_callers_own_and_only_name_and_phone_are_editable(): void
    {
        $this->identity('pr@shop.test');
        $token = (string) $this->login('pr@shop.test');

        $this->api('PATCH', 'account/profile', self::RA, $token, ['display_name' => 'سارة العتيبي', 'phone' => '+966501112233'])->assertOk()
            ->assertJsonPath('data.customer.display_name', 'سارة العتيبي')->assertJsonPath('data.customer.phone', '+966501112233');
        $this->api('GET', 'account/profile', self::RA, $token)->assertOk()->assertJsonPath('data.customer.display_name', 'سارة العتيبي');

        foreach (['email' => 'x@y.test', 'email_verified_at' => now()->toIso8601String(), 'is_active' => false, 'tenant_id' => (string) Str::uuid(), 'customer_identity_id' => (string) Str::uuid(), 'id' => (string) Str::uuid()] as $field => $value) {
            $this->api('PATCH', 'account/profile', self::RA, $token, [$field => $value])->assertStatus(422);
        }
        $this->api('PATCH', 'account/profile', self::RA, $token, ['phone' => '0501112233'])->assertStatus(422); // E.164 only

        $other = $this->identity('pr2@shop.test');
        $this->api('PATCH', 'account/profile', self::RA, (string) $this->login('pr2@shop.test'), ['phone' => '+966501112233'])->assertStatus(422); // taken: generic, no leak
        $this->assertSame('Shopper', $other->fresh()->display_name);
    }

    // ═══════════════════════ العناوين (IDOR) ═══════════════════════

    #[Test]
    public function addresses_are_crud_for_the_owner_only(): void
    {
        $this->identity('ad1@shop.test');
        $this->identity('ad2@shop.test');
        $t1 = (string) $this->login('ad1@shop.test');
        $t2 = (string) $this->login('ad2@shop.test');

        $created = $this->api('POST', 'account/addresses', self::RA, $t1, $this->addressBody(['is_default_shipping' => true]))->assertCreated();
        $id = (string) $created->json('data.id');
        $this->api('POST', 'account/addresses', self::RA, $t2, $this->addressBody(['recipient_name' => 'خاص']))->assertCreated();

        $this->assertCount(1, $this->api('GET', 'account/addresses', self::RA, $t1)->assertOk()->json('data.data'));
        $this->assertStringNotContainsString('خاص', (string) $this->api('GET', 'account/addresses', self::RA, $t1)->getContent());

        // cross-customer access: indistinguishable from a missing address, nothing changes
        $this->api('PATCH', 'account/addresses/'.$id, self::RA, $t2, ['city' => 'جدة'])->assertStatus(422);
        $this->api('DELETE', 'account/addresses/'.$id, self::RA, $t2)->assertStatus(422);
        $this->assertSame('الدمام', CommerceCustomerAddress::query()->withoutGlobalScopes()->find($id)->city);

        // identity/tenant cannot be smuggled in
        $this->api('POST', 'account/addresses', self::RA, $t1, $this->addressBody(['customer_identity_id' => (string) Str::uuid()]))->assertStatus(422);
        $this->api('POST', 'account/addresses', self::RA, $t1, $this->addressBody(['tenant_id' => (string) Str::uuid()]))->assertStatus(422);
        // a Saudi address needs the national address fields
        $this->api('POST', 'account/addresses', self::RA, $t1, $this->addressBody(['postal_code' => 'abc']))->assertStatus(422);

        // an optional field can be explicitly cleared by a partial update
        $this->api('PATCH', 'account/addresses/'.$id, self::RA, $t1, ['delivery_notes' => 'ملاحظة'])->assertOk()->assertJsonPath('data.delivery_notes', 'ملاحظة');
        $this->api('PATCH', 'account/addresses/'.$id, self::RA, $t1, ['delivery_notes' => null])->assertOk()->assertJsonPath('data.delivery_notes', null);

        $this->api('PATCH', 'account/addresses/'.$id, self::RA, $t1, ['city' => 'الخبر'])->assertOk()->assertJsonPath('data.city', 'الخبر');
        $this->api('DELETE', 'account/addresses/'.$id, self::RA, $t1)->assertOk();
        $this->assertCount(0, $this->api('GET', 'account/addresses', self::RA, $t1)->json('data.data'));
    }

    #[Test]
    public function a_tenants_shoppers_never_see_another_tenants_data(): void
    {
        $this->identity('iso@shop.test');
        $token = (string) $this->login('iso@shop.test');
        $this->api('POST', 'account/addresses', self::RA, $token, $this->addressBody())->assertCreated();

        $foreign = Tenant::create(['name' => 'آخر', 'slug' => 'rc-f-'.Str::random(6), 'vat_number' => '300000000000011', 'currency' => 'SAR', 'is_active' => true]);
        $this->identity('iso@shop.test', tenant: $foreign); // same e-mail, other tenant: a different person
        $this->assertSame(1, CustomerIdentity::query()->withoutGlobalScopes()->where('tenant_id', $this->tenant->id)->where('email_normalized', 'iso@shop.test')->count());
        $this->api('GET', 'account/addresses', self::RA, $token)->assertOk(); // unaffected
        $this->assertCount(1, $this->api('GET', 'account/addresses', self::RA, $token)->json('data.data'));
    }

    // ═══════════════════════ الطلبات (الملكية) وربط طلبات الضيف ═══════════════════════

    #[Test]
    public function orders_list_and_detail_are_owner_and_channel_scoped_and_everything_else_is_one_404(): void
    {
        $this->identity('o1@shop.test');
        $this->identity('o2@shop.test');
        $t1 = (string) $this->login('o1@shop.test');
        $t2 = (string) $this->login('o2@shop.test');
        $t1b = (string) $this->login('o1@shop.test', self::RB);

        $mine = $this->guestOrder(self::RA, 'o1@shop.test', 'o-1');
        $this->api('POST', 'account/orders/claim', self::RA, $t1, ['order_number' => $mine['number']])->assertOk();
        $theirs = $this->guestOrder(self::RA, 'o2@shop.test', 'o-2');
        $this->api('POST', 'account/orders/claim', self::RA, $t2, ['order_number' => $theirs['number']])->assertOk();

        $list = $this->api('GET', 'account/orders', self::RA, $t1)->assertOk();
        $this->assertSame([$mine['id']], array_column($list->json('data'), 'id'));
        $this->assertCount(0, $this->api('GET', 'account/orders', self::RB, $t1b)->json('data')); // other store: nothing

        $this->api('GET', 'account/orders/'.$mine['id'], self::RA, $t1)->assertOk()->assertJsonPath('data.order.id', $mine['id']);
        $notFound = $this->api('GET', 'account/orders/'.$theirs['id'], self::RA, $t1);
        $missing = $this->api('GET', 'account/orders/'.Str::uuid(), self::RA, $t1);
        $notFound->assertNotFound();
        $this->assertSame($notFound->json('error.code'), $missing->json('error.code'));
        $this->api('GET', 'account/orders/'.$mine['id'], self::RB, $t1b)->assertNotFound();

        $blob = strtolower((string) $list->getContent().$this->api('GET', 'account/orders/'.$mine['id'], self::RA, $t1)->getContent());
        foreach (['journal', 'invoice_id', 'partner', 'price_list', 'tenant_id', 'customer_identity', 'ledger', 'cost'] as $forbidden) {
            $this->assertStringNotContainsString($forbidden, $blob, $forbidden);
        }
    }

    #[Test]
    public function a_guest_order_is_linked_only_with_a_verified_proof_and_only_once(): void
    {
        $this->identity('c1@shop.test');
        $this->identity('c2@shop.test');
        $unverified = $this->identity('c3@shop.test', verified: false);
        $t1 = (string) $this->login('c1@shop.test');
        $t2 = (string) $this->login('c2@shop.test');

        $order = $this->guestOrder(self::RA, 'C1@Shop.test', 'c-1'); // e-mail case-insensitively equals the verified account e-mail
        $stranger = $this->guestOrder(self::RA, 'someone-else@example.com', 'c-2');

        // no proof: another e-mail, no/wrong reference → one 404, nothing linked
        $this->api('POST', 'account/orders/claim', self::RA, $t2, ['order_number' => $order['number']])->assertNotFound();
        $this->api('POST', 'account/orders/claim', self::RA, $t1, ['order_number' => $stranger['number']])->assertNotFound();
        $this->api('POST', 'account/orders/claim', self::RA, $t1, ['order_number' => $stranger['number'], 'order_reference' => 'v1.'.str_repeat('0', 64)])->assertNotFound();
        $this->api('POST', 'account/orders/claim', self::RA, $t1, ['order_number' => 'CORD-NOPE'])->assertNotFound();
        // a reference for ANOTHER order proves nothing about this one
        $this->api('POST', 'account/orders/claim', self::RA, $t2, ['order_number' => $order['number'], 'order_reference' => $stranger['reference']])->assertNotFound();
        $this->assertNull(CommerceOrder::query()->withoutGlobalScopes()->find($order['id'])->customer_identity_id);

        // strict body
        $this->api('POST', 'account/orders/claim', self::RA, $t1, ['order_number' => $order['number'], 'customer_identity_id' => (string) Str::uuid()])->assertStatus(422);

        // verified e-mail proof
        $this->api('POST', 'account/orders/claim', self::RA, $t1, ['order_number' => $order['number']])->assertOk()->assertJsonPath('data.order.id', $order['id']);
        $this->assertSame(CommerceOrderOwnershipClaim::PROOF_VERIFIED_EMAIL, CommerceOrderOwnershipClaim::query()->withoutGlobalScopes()->where('commerce_order_id', $order['id'])->value('proof'));
        // idempotent for the owner, closed for everybody else — even with a valid reference
        $this->api('POST', 'account/orders/claim', self::RA, $t1, ['order_number' => $order['number']])->assertOk();
        $this->api('POST', 'account/orders/claim', self::RA, $t2, ['order_number' => $order['number'], 'order_reference' => $order['reference']])->assertNotFound();
        $this->assertSame(1, CommerceOrderOwnershipClaim::query()->withoutGlobalScopes()->where('commerce_order_id', $order['id'])->count());

        // order-reference proof (a shopper whose account e-mail differs from the checkout e-mail)
        $this->api('POST', 'account/orders/claim', self::RA, $t2, ['order_number' => $stranger['number'], 'order_reference' => $stranger['reference']])->assertOk();
        $this->assertSame(CommerceOrderOwnershipClaim::PROOF_ORDER_REFERENCE, CommerceOrderOwnershipClaim::query()->withoutGlobalScopes()->where('commerce_order_id', $stranger['id'])->value('proof'));
        $this->assertSame([$stranger['id']], array_column($this->api('GET', 'account/orders', self::RA, $t2)->json('data'), 'id'));

        // an unverified account cannot even hold a session, so it can never claim
        $this->assertNull($this->login($unverified->email));
    }

    #[Test]
    public function an_order_placed_while_signed_in_belongs_to_the_account_and_a_bad_token_just_means_guest(): void
    {
        $this->identity('si@shop.test');
        $token = (string) $this->login('si@shop.test');

        $mine = $this->guestOrder(self::RA, 'whatever@example.com', 'si-1', $token);
        $this->assertSame([$mine['id']], array_column($this->api('GET', 'account/orders', self::RA, $token)->json('data'), 'id')); // no claim needed

        // an invalid / revoked / foreign-host token never blocks shopping — it is simply a guest order
        $guest = $this->guestOrder(self::RA, 'si@shop.test', 'si-2', 'garbage-token');
        $this->assertSame([$mine['id']], array_column($this->api('GET', 'account/orders', self::RA, $token)->json('data'), 'id'));
        app(TenantContext::class)->set($this->tenant->id);
        $this->assertNull(CommerceOrder::query()->findOrFail($guest['id'])->customer_identity_id);
        app(TenantContext::class)->forget();

        // the guest order can then be linked through the verified-email claim
        $this->api('POST', 'account/orders/claim', self::RA, $token, ['order_number' => $guest['number']])->assertOk();
        $this->assertCount(2, $this->api('GET', 'account/orders', self::RA, $token)->json('data'));

        // a token minted for another store is ignored there too (guest order, not an error)
        $other = $this->guestOrder(self::RB, 'si@shop.test', 'si-3', $token);
        app(TenantContext::class)->set($this->tenant->id);
        $this->assertNull(CommerceOrder::query()->findOrFail($other['id'])->customer_identity_id);
        app(TenantContext::class)->forget();
    }

    #[Test]
    public function an_order_of_another_store_cannot_be_claimed_here(): void
    {
        $this->identity('x1@shop.test');
        $t = (string) $this->login('x1@shop.test', self::RA);
        $elsewhere = $this->guestOrder(self::RB, 'x1@shop.test', 'x-1');

        $this->api('POST', 'account/orders/claim', self::RA, $t, ['order_number' => $elsewhere['number'], 'order_reference' => $elsewhere['reference']])->assertNotFound();
        $this->assertNull(CommerceOrder::query()->withoutGlobalScopes()->find($elsewhere['id'])->customer_identity_id);
    }

    #[Test]
    public function the_owner_of_an_order_can_never_be_reassigned_or_cleared_outside_the_claim_service(): void
    {
        $identity = $this->identity('imm@shop.test');
        $other = $this->identity('imm2@shop.test');
        $order = $this->guestOrder(self::RA, 'imm@shop.test', 'imm-1');
        app(TenantContext::class)->set($this->tenant->id);

        $model = CommerceOrder::query()->findOrFail($order['id']);
        $model->customer_identity_id = $identity->id;
        try {
            $model->save(); // a bare save is still forbidden
            $this->fail('A bare owner change must be refused.');
        } catch (LogicException) {
            $this->addToAssertionCount(1);
        }

        $model = CommerceOrder::query()->findOrFail($order['id']);
        $model->attachOwnerAfterVerifiedClaim($identity->id);
        $this->assertSame($identity->id, $model->refresh()->customer_identity_id);

        foreach ([fn ($m) => $m->attachOwnerAfterVerifiedClaim($other->id), function ($m) use ($other) {
            $m->customer_identity_id = $other->id;
            $m->save();
        }, function ($m) {
            $m->customer_identity_id = null;
            $m->save();
        }] as $mutation) {
            try {
                $mutation(CommerceOrder::query()->findOrFail($order['id']));
                $this->fail('An owned order must stay owned by its owner.');
            } catch (LogicException) {
                $this->addToAssertionCount(1);
            }
        }
        $this->assertSame($identity->id, CommerceOrder::query()->findOrFail($order['id'])->customer_identity_id);
    }

    #[Test]
    public function claims_and_account_writes_are_rate_limited_per_account(): void
    {
        $this->identity('rl@shop.test');
        $t = (string) $this->login('rl@shop.test');
        $codes = [];
        for ($i = 0; $i < 12; $i++) {
            $codes[] = $this->api('POST', 'account/orders/claim', self::RA, $t, ['order_number' => 'CORD-X'.$i])->status();
        }
        $this->assertContains(429, $codes);
        $this->assertSame(404, $codes[0]);
    }

    #[Test]
    public function mutations_need_the_storefront_gateway_secret(): void
    {
        $this->identity('gw@shop.test');
        $t = (string) $this->login('gw@shop.test');

        // without the gateway secret the forwarded host is not trusted at all, so the store cannot even be resolved (404)
        $this->flushHeaders();
        $this->withHeaders(['X-Storefront-Forwarded-Host' => self::RA, 'X-Customer-Token' => $t])
            ->json('PATCH', self::BASE.'account/profile', ['display_name' => 'x'])->assertNotFound();
        $this->assertSame('Shopper', CustomerIdentity::query()->withoutGlobalScopes()->where('email_normalized', 'gw@shop.test')->value('display_name'));
    }

    #[Test]
    public function staff_can_switch_accounts_on_a_channel_only_while_the_deployment_flag_is_on(): void
    {
        app(TenantContext::class)->set($this->tenant->id);
        $owner = \App\Models\User::create(['tenant_id' => $this->tenant->id, 'name' => 'o', 'email' => 'o-'.Str::random(6).'@s.test', 'password' => 'password123', 'role' => 'owner']);
        $svc = app(\App\Services\Commerce\SalesChannelSettingsService::class);
        $channel = $this->web('new.retail.test');

        config(['commerce.retail_accounts_enabled' => false]);
        try {
            $svc->update($channel->id, ['customer_accounts_enabled' => true], $owner);
            $this->fail('Turning accounts on must be refused while the deployment flag is off.');
        } catch (\App\Services\Commerce\SalesChannelSettingsException $e) {
            $this->assertSame('customer_accounts_deployment_disabled', $e->reason);
        }

        config(['commerce.retail_accounts_enabled' => true]);
        $this->assertTrue((bool) $svc->update($channel->id, ['customer_accounts_enabled' => true], $owner)->customer_accounts_enabled);
        $this->assertFalse((bool) $svc->update($channel->id, ['customer_accounts_enabled' => false], $owner)->customer_accounts_enabled);

        $pos = SalesChannel::create(['slug' => 'pos-'.Str::random(4), 'name' => 'pos', 'type' => SalesChannel::TYPE_POS, 'is_active' => true]);
        $this->expectException(\DomainException::class);
        $pos->forceFill(['customer_accounts_enabled' => true])->save();
    }
}
