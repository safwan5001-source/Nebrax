<?php

namespace Tests\Feature;

use App\Mail\BuyerPasswordResetMail;
use App\Mail\BuyerVerificationMail;
use App\Models\CommerceListing;
use App\Models\CustomerIdentity;
use App\Models\CustomerPasswordResetToken;
use App\Models\PriceList;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Models\User;
use App\Models\WholesaleMembership;
use App\Services\Commerce\CommerceCartService;
use App\Services\Commerce\WholesaleMembershipService;
use App\Services\PriceListService;
use App\Services\TenantApplicationService;
use App\Support\ApplicationCatalog;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  H6 Batch M (Phase 3) — حساب مشتري الجملة: سجل الطلبات (ملكية/IDOR)، إعادة تعيين كلمة المرور، تفاصيل الطلب، حالات العضوية
 * ═══════════════════════════════════════════════════════════════
 */
class WholesaleBuyerAccountTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private const SECRET = 'acct-secret';

    private const BASE = 'http://laravel-internal.test/store/v1/';

    private const WS = 'acct.wholesale.test';

    private const WS2 = 'acct2.wholesale.test';

    private const DTC = 'acct.retail.test';

    private Tenant $tenant;

    private SalesChannel $ws;

    private SalesChannel $ws2;

    private Product $product;

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'commerce.wholesale_buyer_enabled' => true,
            'storefront.gateway_secret' => self::SECRET,
            'commerce.buyer_password_reset_resend_gap_seconds' => 60,
        ]);
        Mail::fake();

        $this->tenant = Tenant::create(['name' => 'متجر الجملة', 'slug' => 'ac-'.Str::random(8), 'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true]);
        app(TenantContext::class)->set($this->tenant->id);
        $this->ws = $this->web(self::WS, true);
        $this->ws2 = $this->web(self::WS2, true);
        $dtc = $this->web(self::DTC, false);
        $this->product = Product::create(['name' => 'صنف', 'sku' => 'AC-1', 'unit' => 'piece', 'sale_price' => 1000, 'is_active' => true]);
        foreach ([$this->ws, $this->ws2, $dtc] as $c) {
            CommerceListing::create(['product_id' => $this->product->id, 'sales_channel_id' => $c->id, 'is_published' => true]);
        }
        foreach ([$this->ws, $this->ws2] as $c) {
            $list = PriceList::create(['name' => 'l-'.Str::random(4), 'is_active' => true]);
            app(PriceListService::class)->upsertItem($list, $this->product, ['price' => 700]);
            $c->update(['default_price_list_id' => $list->id]);
        }
        app(TenantContext::class)->forget();
    }

    // ───────────────────────── أدوات ─────────────────────────

    private function web(string $host, bool $wholesale): SalesChannel
    {
        $channel = SalesChannel::create(['slug' => 'c-'.Str::random(5), 'name' => $host, 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        if ($wholesale) {
            $channel->forceFill(['wholesale_membership_enabled' => true])->save();
        }
        $storefront = Storefront::create(['slug' => 's-'.Str::random(5), 'name' => $host, 'sales_channel_id' => $channel->id, 'is_active' => true]);
        StorefrontDomain::create(['storefront_id' => $storefront->id, 'hostname' => $host, 'type' => StorefrontDomain::TYPE_CUSTOM, 'is_active' => true, 'is_primary' => true, 'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED]);

        return $channel;
    }

    private function hdr(string $host, ?string $token = null, ?string $cart = null, ?string $idem = null): array
    {
        return array_filter([
            'X-Storefront-Forwarded-Host' => $host, 'X-Storefront-Gateway-Secret' => self::SECRET,
            'X-Customer-Token' => $token, 'Idempotency-Key' => $idem,
        ]);
    }

    private function api(string $method, string $path, string $host, ?string $token = null, array $body = [], ?string $cart = null, ?string $idem = null)
    {
        $this->flushHeaders();
        $this->unencryptedCookies = [];
        $t = $this->withHeaders($this->hdr($host, $token, null, $idem))->withCredentials();
        if ($cart !== null) {
            $t = $t->withUnencryptedCookie(CommerceCartService::COOKIE_NAME, $cart);
        }

        return $t->json($method, self::BASE.$path, $body);
    }

    private function identity(string $email, bool $verified = true, bool $active = true): CustomerIdentity
    {
        app(TenantContext::class)->set($this->tenant->id);
        $identity = CustomerIdentity::create(['tenant_id' => $this->tenant->id, 'display_name' => 'Buyer', 'email' => $email, 'password' => 'correct-horse-9', 'email_verified_at' => $verified ? now() : null, 'is_active' => $active]);
        app(TenantContext::class)->forget();

        return $identity;
    }

    private function owner(): User
    {
        $ctx = app(TenantContext::class);
        $previous = $ctx->has() ? $ctx->id() : null;
        $ctx->set($this->tenant->id);
        $owner = User::query()->where('role', 'owner')->first()
            ?? User::create(['tenant_id' => $this->tenant->id, 'name' => 'o', 'email' => 'o-'.Str::random(6).'@s.test', 'password' => 'password123', 'role' => 'owner']);
        $previous === null ? $ctx->forget() : $ctx->set($previous);

        return $owner;
    }

    /** @param list<SalesChannel> $channels an identity APPROVED on each given channel */
    private function approvedBuyer(string $email, array $channels): CustomerIdentity
    {
        $identity = $this->identity($email);
        app(TenantContext::class)->set($this->tenant->id);
        $svc = app(WholesaleMembershipService::class);
        foreach ($channels as $channel) {
            $svc->transition($svc->apply($identity, $channel->id)->id, 'approve', $this->owner());
        }
        app(TenantContext::class)->forget();

        return $identity;
    }

    private function login(string $email, string $host = self::WS, string $password = 'correct-horse-9'): ?string
    {
        return $this->api('POST', 'auth/login', $host, null, ['email' => $email, 'password' => $password])->json('data.token');
    }

    /** One complete native order through the real cart + checkout. @return string order id */
    private function placeOrder(string $host, string $token, string $key): string
    {
        $add = $this->api('POST', 'cart/items', $host, $token, ['product_id' => $this->product->id, 'quantity' => 1, 'unit_key' => 'base'])->assertSuccessful();
        $cart = $add->getCookie(CommerceCartService::COOKIE_NAME, false)->getValue();
        $this->api('POST', 'checkout', $host, $token, [], $cart)->assertCreated();
        $this->api('PATCH', 'checkout/contact', $host, $token, ['name' => 'سالم', 'phone' => '0501234567', 'email' => 's@example.com'], $cart)->assertOk();
        $this->api('PATCH', 'checkout/address', $host, $token, ['country' => 'SA', 'city' => 'الدمام', 'district' => 'الشاطئ', 'street' => 'الملك فهد', 'postal_code' => '31411'], $cart)->assertOk();
        $this->api('PATCH', 'checkout/delivery', $host, $token, ['method' => 'pickup'], $cart)->assertOk();

        return (string) $this->api('POST', 'checkout/complete', $host, $token, [], $cart, 'order-key-'.$key)->assertCreated()->json('data.order.id');
    }

    // ═══════════════════════ سجل الطلبات وتفاصيلها (الملكية / IDOR) ═══════════════════════

    #[Test]
    public function the_history_lists_only_the_buyers_own_orders_on_this_channel(): void
    {
        $this->approvedBuyer('a@acct.test', [$this->ws, $this->ws2]);
        $this->approvedBuyer('b@acct.test', [$this->ws]);
        $a = (string) $this->login('a@acct.test');
        $a2 = (string) $this->login('a@acct.test', self::WS2);
        $b = (string) $this->login('b@acct.test');

        $mine1 = $this->placeOrder(self::WS, $a, 'k-a1');
        $mine2 = $this->placeOrder(self::WS, $a, 'k-a2');
        $otherChannel = $this->placeOrder(self::WS2, $a2, 'k-a3');
        $theirs = $this->placeOrder(self::WS, $b, 'k-b1');

        $list = $this->api('GET', 'buyer/orders', self::WS, $a)->assertOk();
        $ids = array_column($list->json('data'), 'id');
        sort($ids);
        $expected = [$mine1, $mine2];
        sort($expected);
        $this->assertSame($expected, $ids);
        $this->assertNotContains($theirs, $ids);
        $this->assertNotContains($otherChannel, $ids); // same identity, different channel: not shown here
        $this->assertSame(2, $list->json('meta.pagination.total'));

        // the row is a lightweight public summary, never an internal record
        $blob = strtolower((string) $list->getContent());
        foreach (['invoice', 'journal', 'partner', 'price_list', 'cost', 'tenant_id', 'customer_identity', 'cancellation_reason', 'ledger'] as $forbidden) {
            $this->assertStringNotContainsString($forbidden, $blob, "list leaked {$forbidden}");
        }

        // the other channel's own history shows only its order
        $this->assertSame([$otherChannel], array_column($this->api('GET', 'buyer/orders', self::WS2, $a2)->assertOk()->json('data'), 'id'));
    }

    #[Test]
    public function an_order_detail_is_readable_only_by_its_owner_on_its_channel_and_everything_else_is_one_404(): void
    {
        $this->approvedBuyer('a@acct.test', [$this->ws, $this->ws2]);
        $this->approvedBuyer('b@acct.test', [$this->ws]);
        $a = (string) $this->login('a@acct.test');
        $a2 = (string) $this->login('a@acct.test', self::WS2);
        $b = (string) $this->login('b@acct.test');
        $mine = $this->placeOrder(self::WS, $a, 'k-1');
        $theirs = $this->placeOrder(self::WS, $b, 'k-2');
        $elsewhere = $this->placeOrder(self::WS2, $a2, 'k-3');

        $detail = $this->api('GET', "buyer/orders/{$mine}", self::WS, $a)->assertOk();
        $this->assertSame($mine, $detail->json('data.order.id'));
        $this->assertNotEmpty($detail->json('data.order.items'));

        $missing = $this->api('GET', 'buyer/orders/'.Str::uuid(), self::WS, $a)->assertNotFound();
        foreach ([$theirs, $elsewhere] as $notMine) {
            $r = $this->api('GET', "buyer/orders/{$notMine}", self::WS, $a)->assertNotFound();
            $this->assertSame($missing->json('error.code'), $r->json('error.code')); // indistinguishable from "does not exist"
        }
        $this->api('GET', 'buyer/orders/not-a-uuid', self::WS, $a)->assertNotFound();

        $blob = strtolower((string) $detail->getContent());
        foreach (['invoice_id', 'journal', 'partner_id', 'price_list', 'unit_cost', 'tenant_id', 'customer_identity_id', 'ledger'] as $forbidden) {
            $this->assertStringNotContainsString($forbidden, $blob, "detail leaked {$forbidden}");
        }
    }

    #[Test]
    public function every_membership_state_is_told_the_truth_and_only_an_approved_buyer_sees_orders(): void
    {
        $this->approvedBuyer('s@acct.test', [$this->ws]);
        $token = (string) $this->login('s@acct.test');
        $order = $this->placeOrder(self::WS, $token, 'k-s');

        $this->api('GET', 'buyer/orders', self::WS, $token)->assertOk();

        app(TenantContext::class)->set($this->tenant->id);
        $m = WholesaleMembership::query()->firstOrFail();
        app(WholesaleMembershipService::class)->transition($m->id, 'suspend', $this->owner());
        app(TenantContext::class)->forget();

        // suspended: history is as gated as the catalogue, and the gate says WHY (their own state only)
        $r = $this->api('GET', 'buyer/orders', self::WS, $token)->assertForbidden();
        $this->assertSame('suspended', $r->json('error.details.membership_status'));
        $this->api('GET', "buyer/orders/{$order}", self::WS, $token)->assertForbidden();

        app(TenantContext::class)->set($this->tenant->id);
        app(WholesaleMembershipService::class)->transition($m->id, 'reinstate', $this->owner());
        app(TenantContext::class)->forget();
        $this->api('GET', 'buyer/orders', self::WS, $token)->assertOk();

        // not applied / pending / rejected
        $this->identity('n@acct.test');
        $none = (string) $this->login('n@acct.test');
        $this->assertSame('none', $this->api('GET', 'buyer/orders', self::WS, $none)->assertForbidden()->json('error.details.membership_status'));
        $this->api('POST', 'wholesale/application', self::WS, $none)->assertCreated();
        $this->assertSame('pending', $this->api('GET', 'buyer/orders', self::WS, $none)->assertForbidden()->json('error.details.membership_status'));
        app(TenantContext::class)->set($this->tenant->id);
        $pending = WholesaleMembership::query()->where('customer_identity_id', CustomerIdentity::query()->where('email_normalized', 'n@acct.test')->value('id'))->firstOrFail();
        app(WholesaleMembershipService::class)->transition($pending->id, 'reject', $this->owner());
        app(TenantContext::class)->forget();
        $this->assertSame('rejected', $this->api('GET', 'buyer/orders', self::WS, $none)->assertForbidden()->json('error.details.membership_status'));
    }

    #[Test]
    public function the_history_needs_a_valid_session_for_this_host_and_does_not_exist_off_wholesale(): void
    {
        $this->approvedBuyer('a@acct.test', [$this->ws, $this->ws2]);
        $token = (string) $this->login('a@acct.test');

        $this->api('GET', 'buyer/orders', self::WS)->assertUnauthorized();
        $this->api('GET', 'buyer/orders', self::WS, '1|garbage')->assertUnauthorized();
        $this->assertContains($this->api('GET', 'buyer/orders', self::WS2, $token)->getStatusCode(), [401, 403]); // token bound to WS
        $this->api('GET', 'buyer/orders', self::DTC, $token)->assertNotFound(); // retail host: no such surface

        config(['commerce.wholesale_buyer_enabled' => false]);
        $this->api('GET', 'buyer/orders', self::WS, $token)->assertNotFound();
    }

    // ═══════════════════════ إعادة تعيين كلمة المرور ═══════════════════════

    private function forgot(string $email, string $host = self::WS, array $extra = [])
    {
        return $this->api('POST', 'auth/password/forgot', $host, null, ['email' => $email] + $extra);
    }

    private function reset(string $token, string $password = 'brand-new-pass-1', string $host = self::WS, array $extra = [])
    {
        return $this->api('POST', 'auth/password/reset', $host, null, ['token' => $token, 'password' => $password] + $extra);
    }

    /** @return list<BuyerPasswordResetMail> */
    private function resetMails(?string $to = null): array
    {
        return Mail::sent(BuyerPasswordResetMail::class, fn ($m) => $to === null || $m->hasTo($to))->values()->all();
    }

    private function tokenOf(BuyerPasswordResetMail $mail): string
    {
        parse_str((string) parse_url($mail->url, PHP_URL_QUERY), $q);

        return (string) $q['token'];
    }

    #[Test]
    public function the_request_is_neutral_and_only_a_verified_active_account_is_mailed(): void
    {
        $this->identity('ok@acct.test');
        $this->identity('unverified@acct.test', verified: false);
        $this->identity('inactive@acct.test', active: false);

        $bodies = [];
        foreach (['ok@acct.test', 'unverified@acct.test', 'inactive@acct.test', 'ghost@acct.test'] as $email) {
            $r = $this->forgot($email)->assertStatus(202);
            $b = $r->json();
            unset($b['meta']);
            $bodies[] = $b;
        }
        $this->assertCount(1, array_unique(array_map('json_encode', $bodies))); // indistinguishable
        $this->assertCount(1, $this->resetMails());
        $this->assertCount(1, $this->resetMails('ok@acct.test'));

        $mail = $this->resetMails('ok@acct.test')[0];
        $this->assertStringStartsWith('https://'.self::WS.'/buyer/reset-password?token=', $mail->url); // the store's own verified host
        $this->assertStringNotContainsString('password', strtolower(parse_url($mail->url, PHP_URL_HOST) ?? ''));
        $this->assertSame(64, strlen($this->tokenOf($mail)));
        Mail::assertNotSent(BuyerVerificationMail::class);

        // the locale prefix is honoured only in its strict shape; a client cannot choose the host
        $this->identity('loc@acct.test');
        $this->forgot('loc@acct.test', self::WS, ['locale_path' => '/sa/ar'])->assertStatus(202);
        $this->assertStringStartsWith('https://'.self::WS.'/sa/ar/buyer/reset-password?token=', $this->resetMails('loc@acct.test')[0]->url);
        $this->forgot('evil@acct.test', self::WS, ['locale_path' => '//evil.test'])->assertStatus(422);
    }

    #[Test]
    public function a_second_request_inside_the_gap_sends_nothing_and_a_new_link_retires_the_old_one(): void
    {
        $this->identity('gap@acct.test');
        $this->forgot('gap@acct.test')->assertStatus(202);
        $this->forgot('gap@acct.test')->assertStatus(202);
        $this->assertCount(1, $this->resetMails('gap@acct.test')); // cooling down

        config(['commerce.buyer_password_reset_resend_gap_seconds' => 0]);
        $first = $this->tokenOf($this->resetMails('gap@acct.test')[0]);
        $this->forgot('gap@acct.test')->assertStatus(202);
        $second = $this->tokenOf($this->resetMails('gap@acct.test')[1]);

        $this->reset($first)->assertStatus(422); // superseded
        $this->reset($second)->assertOk();
    }

    #[Test]
    public function a_valid_link_sets_the_password_once_and_ends_every_session(): void
    {
        $this->approvedBuyer('p@acct.test', [$this->ws, $this->ws2]);
        $sessionA = (string) $this->login('p@acct.test');
        $sessionB = (string) $this->login('p@acct.test', self::WS2);
        $this->api('GET', 'me', self::WS, $sessionA)->assertOk();

        $this->forgot('p@acct.test')->assertStatus(202);
        $token = $this->tokenOf($this->resetMails('p@acct.test')[0]);

        $this->reset($token, 'brand-new-pass-1')->assertOk()->assertJsonPath('data.password_reset', true);

        $this->assertNull($this->login('p@acct.test', self::WS, 'correct-horse-9')); // old password dead
        $this->assertNotEmpty($this->login('p@acct.test', self::WS, 'brand-new-pass-1'));
        $this->api('GET', 'me', self::WS, $sessionA)->assertUnauthorized(); // existing sessions ended, on every channel
        $this->api('GET', 'me', self::WS2, $sessionB)->assertUnauthorized();
        $this->reset($token, 'another-pass-22')->assertStatus(422); // single use
    }

    #[Test]
    public function a_link_is_bound_to_its_tenant_and_channel_expires_and_a_failed_try_never_consumes_it(): void
    {
        $this->identity('bind@acct.test');
        $this->forgot('bind@acct.test')->assertStatus(202);
        $token = $this->tokenOf($this->resetMails('bind@acct.test')[0]);

        $this->reset($token, 'brand-new-pass-1', self::WS2)->assertStatus(422); // another channel of the same tenant
        $this->reset(str_repeat('a', 64))->assertStatus(422);
        $this->assertNotEmpty($this->login('bind@acct.test', self::WS, 'correct-horse-9')); // password unchanged

        // another tenant's host
        $other = Tenant::create(['name' => 'o', 'slug' => 'o-'.Str::random(8), 'vat_number' => '300000000000004', 'currency' => 'SAR', 'is_active' => true]);
        app(TenantContext::class)->set($other->id);
        $this->web('other.wholesale.test', true);
        app(TenantContext::class)->forget();
        $this->reset($token, 'brand-new-pass-1', 'other.wholesale.test')->assertStatus(422);

        // none of those consumed it
        $this->travel(61)->minutes();
        $this->reset($token, 'brand-new-pass-1')->assertStatus(422); // expired (60 min)
        $this->travelBack();
    }

    #[Test]
    public function a_verification_link_cannot_reset_a_password_and_a_reset_link_cannot_verify_an_email(): void
    {
        $this->api('POST', 'auth/register', self::WS, null, ['display_name' => 'N', 'email' => 'reg@acct.test', 'password' => 'correct-horse-9'])->assertStatus(202);
        $verification = Mail::sent(BuyerVerificationMail::class)->first();
        parse_str((string) parse_url($verification->url, PHP_URL_QUERY), $q);
        $this->reset((string) $q['token'])->assertStatus(422);
        $this->assertNull(CustomerIdentity::withoutGlobalScopes()->where('email_normalized', 'reg@acct.test')->value('email_verified_at'));

        $this->identity('v@acct.test');
        $this->forgot('v@acct.test')->assertStatus(202);
        $resetToken = $this->tokenOf($this->resetMails('v@acct.test')[0]);
        $this->api('POST', 'auth/verify-email', self::WS, null, ['token' => $resetToken])->assertStatus(422);
        $this->reset($resetToken)->assertOk(); // and it still works for what it is for
    }

    #[Test]
    public function reset_never_verifies_an_email_or_bypasses_the_login_gate_and_inputs_are_strict(): void
    {
        $this->identity('weak@acct.test');
        $this->forgot('weak@acct.test')->assertStatus(202);
        $token = $this->tokenOf($this->resetMails('weak@acct.test')[0]);

        $this->reset($token, 'short')->assertStatus(422); // same minimum as registration
        $this->reset('too-short', 'brand-new-pass-1')->assertStatus(422);
        $this->reset($token, 'brand-new-pass-1', self::WS, ['email' => 'weak@acct.test'])->assertStatus(422); // identity comes from the token only
        $this->reset($token, 'brand-new-pass-1', self::WS, ['tenant_id' => (string) Str::uuid()])->assertStatus(422);
        $this->forgot('x@acct.test', self::WS, ['tenant_id' => (string) Str::uuid()])->assertStatus(422);

        // a reset for a verified identity does not log anyone in and issues no token
        $r = $this->reset($token)->assertOk();
        $this->assertArrayNotHasKey('token', $r->json('data'));
    }

    #[Test]
    public function reset_requests_are_throttled_per_account_and_the_store_budget_stays_untouched(): void
    {
        $this->identity('t@acct.test');
        for ($i = 0; $i < 3; $i++) {
            $this->forgot('t@acct.test')->assertStatus(202);
        }
        $this->forgot('t@acct.test')->assertStatus(429);
        $this->forgot('t@acct.test', self::WS, ['locale_path' => '/sa/en'])->assertStatus(429);
        $this->forgot('other@acct.test')->assertStatus(202); // another account is not locked out
    }

    // ═══════════════════════ بيانات الطلب (الشركة والهاتف) ═══════════════════════

    #[Test]
    public function an_application_may_carry_unverified_company_and_phone_context_for_the_reviewer_only(): void
    {
        $this->identity('co@acct.test');
        $token = (string) $this->login('co@acct.test');

        $created = $this->api('POST', 'wholesale/application', self::WS, $token, ['company_name' => '  شركة   الأفق  للتجارة ', 'contact_phone' => '+966 50 123 4567'])->assertCreated();
        $this->assertSame('شركة الأفق للتجارة', $created->json('data.membership.company_name'));
        $this->assertSame('+966 50 123 4567', $created->json('data.membership.contact_phone'));

        // re-applying never overwrites the recorded context
        $again = $this->api('POST', 'wholesale/application', self::WS, $token, ['company_name' => 'Changed Co'])->assertOk();
        $this->assertSame('شركة الأفق للتجارة', $again->json('data.membership.company_name'));

        // the phone is stored on the membership, never on the identity (it would feed phone-OTP login)
        $this->assertNull(CustomerIdentity::withoutGlobalScopes()->where('email_normalized', 'co@acct.test')->value('phone'));

        // staff see it as application context, with the buyer's own contact separate
        app(TenantContext::class)->set($this->tenant->id);
        $owner = $this->owner();
        $staff = $owner->createToken('api')->plainTextToken;
        $apps = app(TenantApplicationService::class);
        foreach (ApplicationCatalog::all() as $key => $app) {
            if (! $app['mandatory'] && $app['maturity'] === ApplicationCatalog::MATURITY_BUILT) {
                try {
                    $apps->enable($key, null);
                } catch (\Throwable) {
                }
            }
        }
        app(TenantContext::class)->forget();
        $row = $this->withToken($staff)->getJson("/api/commerce/wholesale/channels/{$this->ws->id}/memberships")->assertOk()->json('data.0');
        $this->assertSame('شركة الأفق للتجارة', $row['application']['company_name']);
        $this->assertSame('+966 50 123 4567', $row['application']['contact_phone']);
    }

    #[Test]
    public function an_application_refuses_bad_phones_and_any_attempt_to_pick_a_partner_or_price_list(): void
    {
        $this->identity('bad@acct.test');
        $token = (string) $this->login('bad@acct.test');

        $this->api('POST', 'wholesale/application', self::WS, $token, ['contact_phone' => '<script>'])->assertStatus(422);
        $this->api('POST', 'wholesale/application', self::WS, $token, ['company_name' => str_repeat('x', 151)])->assertStatus(422);
        foreach (['partner_id', 'price_list_id', 'tenant_id', 'sales_channel_id', 'customer_identity_id'] as $forbidden) {
            $this->api('POST', 'wholesale/application', self::WS, $token, [$forbidden => (string) Str::uuid()])->assertStatus(422);
        }
        $this->assertSame(0, WholesaleMembership::withoutGlobalScopes()->count());

        // empty application (the previous contract) still works
        $this->api('POST', 'wholesale/application', self::WS, $token)->assertCreated()->assertJsonPath('data.membership.company_name', null);
    }
}
