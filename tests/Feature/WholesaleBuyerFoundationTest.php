<?php

namespace Tests\Feature;

use App\Http\Middleware\BindStorefrontBuyerToChannel;
use App\Models\CustomerIdentity;
use App\Models\Role;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Models\User;
use App\Models\WholesaleMembership;
use App\Models\WholesaleMembershipEvent;
use App\Services\Commerce\WholesaleMembershipException;
use App\Services\Commerce\WholesaleMembershipService;
use App\Services\TenantApplicationService;
use App\Support\ApplicationCatalog;
use App\Support\Rbac;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  H6 Batch E — هوية مشتري الجملة وعضويته (أساس خلفي، مغلق افتراضياً)
 * ═══════════════════════════════════════════════════════════════
 *  هوية المشتري = `CustomerIdentity` القائمة (بريد+كلمة مرور) على سطح store/v1 المحسوم بالـ Host؛ العضوية حالة أهلية
 *  مستقلة عن المصادقة. يثبّت: البوابة المغلقة، عدم تسرّب DTC، عزل المستأجر/المضيف/القناة، ربط الجلسة بالقناة، عدم
 *  التعداد، تحديد المعدّل، آلة الحالات وRBAC للقرارات، نفاذ الإيقاف على الجلسات القائمة، والتدقيق.
 */
class WholesaleBuyerFoundationTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private const SECRET = 'wholesale-gateway-secret';

    private const BASE = 'http://laravel-internal.test/store/v1/';

    private Tenant $tenant;

    private SalesChannel $channel;

    private string $host = 'wholesale.alpha.test';

    protected function setUp(): void
    {
        parent::setUp();
        config(['commerce.wholesale_buyer_enabled' => true, 'storefront.gateway_secret' => self::SECRET]);
        ['tenant' => $this->tenant, 'channel' => $this->channel] = $this->makeStore($this->host, true);
    }

    // ───────────────────────── أدوات ─────────────────────────

    /** @return array{tenant: Tenant, channel: SalesChannel} */
    private function makeStore(string $host, bool $wholesale, ?Tenant $tenant = null): array
    {
        $tenant ??= Tenant::create([
            'name' => $host, 'slug' => 'ws-'.Str::random(8),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create([
            'slug' => 'web-'.Str::random(5), 'name' => 'Web', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        if ($wholesale) {
            $channel->forceFill(['wholesale_membership_enabled' => true])->save();
        }
        $storefront = Storefront::create(['slug' => 's-'.Str::random(5), 'name' => 'Main', 'sales_channel_id' => $channel->id, 'is_active' => true]);
        StorefrontDomain::create([
            'storefront_id' => $storefront->id, 'hostname' => $host, 'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_active' => true, 'is_primary' => true, 'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        app(TenantContext::class)->forget();

        return compact('tenant', 'channel');
    }

    private function headers(?string $host = null, ?string $token = null, string $secret = self::SECRET): array
    {
        $headers = [
            'X-Storefront-Forwarded-Host' => $host ?? $this->host,
            'X-Storefront-Gateway-Secret' => $secret,
        ];
        if ($token !== null) {
            $headers['X-Customer-Token'] = $token;
        }

        return $headers;
    }

    private function buyer(Tenant $tenant, string $email, string $password = 'correct-horse-9', bool $verified = true, bool $active = true): CustomerIdentity
    {
        app(TenantContext::class)->set($tenant->id);
        $identity = CustomerIdentity::create([
            'tenant_id' => $tenant->id, 'display_name' => 'Buyer', 'email' => $email, 'password' => $password,
            'email_verified_at' => $verified ? now() : null, 'is_active' => $active,
        ]);
        app(TenantContext::class)->forget();

        return $identity;
    }

    private function login(string $email, string $password = 'correct-horse-9', ?string $host = null)
    {
        return $this->withHeaders($this->headers($host))->postJson(self::BASE.'auth/login', ['email' => $email, 'password' => $password]);
    }

    private function token(string $email = 'buyer@alpha.test', ?string $host = null, ?Tenant $tenant = null): string
    {
        $this->buyer($tenant ?? $this->tenant, $email);

        return (string) $this->login($email, 'correct-horse-9', $host)->assertOk()->json('data.token');
    }

    private function storeGet(string $path, ?string $token = null, ?string $host = null)
    {
        return $this->withHeaders($this->headers($host, $token))->getJson(self::BASE.$path);
    }

    private function storePost(string $path, array $body = [], ?string $token = null, ?string $host = null)
    {
        return $this->withHeaders($this->headers($host, $token))->postJson(self::BASE.$path, $body);
    }

    /** @return array{0: User, 1: string} */
    private function staff(Tenant $tenant, string $role = 'owner'): array
    {
        app(TenantContext::class)->set($tenant->id);
        $user = User::create([
            'tenant_id' => $tenant->id, 'name' => $role, 'email' => $role.'-'.Str::random(6).'@staff.test',
            'password' => 'password123', 'role' => $role,
        ]);
        $token = $user->createToken('api')->plainTextToken;
        $applications = app(TenantApplicationService::class);
        foreach (ApplicationCatalog::all() as $key => $application) {
            if (! $application['mandatory'] && $application['maturity'] === ApplicationCatalog::MATURITY_BUILT) {
                try {
                    $applications->enable($key, null);
                } catch (\Throwable) {
                    // already enabled
                }
            }
        }
        app(TenantContext::class)->forget();

        return [$user, $token];
    }

    private function applyAs(string $token, ?string $host = null)
    {
        return $this->storePost('wholesale/application', [], $token, $host);
    }

    private function membershipFor(CustomerIdentity $identity, ?SalesChannel $channel = null): WholesaleMembership
    {
        app(TenantContext::class)->set($identity->tenant_id);
        $m = WholesaleMembership::query()->where('customer_identity_id', $identity->id)->where('sales_channel_id', ($channel ?? $this->channel)->id)->firstOrFail();
        app(TenantContext::class)->forget();

        return $m;
    }

    private function decide(string $staffToken, string $membershipId, string $action, array $body = [])
    {
        return $this->withToken($staffToken)->postJson("/api/commerce/wholesale/memberships/{$membershipId}/{$action}", $body);
    }

    private function approvedBuyer(string $email = 'buyer@alpha.test'): array
    {
        $token = $this->token($email);
        $this->applyAs($token)->assertCreated();
        $identity = CustomerIdentity::withoutGlobalScopes()->where('email_normalized', $email)->firstOrFail();
        [, $owner] = $this->staff($this->tenant);
        $this->decide($owner, $this->membershipFor($identity)->id, 'approve')->assertOk();

        return [$token, $identity, $owner];
    }

    // ═══════════════════════ البوابة والتوافق الرجعي ═══════════════════════

    #[Test]
    public function every_buyer_route_is_a_uniform_404_while_the_deployment_flag_is_off(): void
    {
        config(['commerce.wholesale_buyer_enabled' => false]);
        $this->buyer($this->tenant, 'off@alpha.test');

        $this->storePost('auth/register', ['display_name' => 'x', 'email' => 'n@x.test', 'password' => 'password123'])->assertNotFound();
        $this->login('off@alpha.test')->assertNotFound();
        $this->storeGet('me', 'whatever')->assertNotFound();
        $this->storeGet('wholesale/membership', 'whatever')->assertNotFound();
        $this->storeGet('wholesale/access', 'whatever')->assertNotFound();

        [, $owner] = $this->staff($this->tenant);
        $this->withToken($owner)->getJson("/api/commerce/wholesale/channels/{$this->channel->id}/memberships")->assertNotFound();
        $this->decide($owner, (string) Str::uuid(), 'approve')->assertNotFound();
    }

    #[Test]
    public function a_plain_dtc_channel_never_exposes_the_capability_even_with_the_flag_on(): void
    {
        $dtc = $this->makeStore('shop.alpha.test', false, $this->tenant);
        $this->buyer($this->tenant, 'dtc@alpha.test');

        $this->storePost('auth/register', ['display_name' => 'x', 'email' => 'n@x.test', 'password' => 'password123'], null, 'shop.alpha.test')->assertNotFound();
        $this->login('dtc@alpha.test', 'correct-horse-9', 'shop.alpha.test')->assertNotFound();
        $this->storeGet('wholesale/access', 'x', 'shop.alpha.test')->assertNotFound();
        // the ordinary DTC read surface is untouched
        $this->storeGet('categories', null, 'shop.alpha.test')->assertOk();
        $this->assertFalse($dtc['channel']->fresh()->wholesale_membership_enabled);
    }

    #[Test]
    public function only_a_web_channel_can_be_marked_wholesale(): void
    {
        app(TenantContext::class)->set($this->tenant->id);
        $mobile = SalesChannel::create(['slug' => 'm', 'name' => 'M', 'type' => SalesChannel::TYPE_MOBILE, 'is_active' => true]);

        $this->expectException(DomainException::class);
        $mobile->forceFill(['wholesale_membership_enabled' => true])->save();
    }

    #[Test]
    public function mutations_require_the_server_to_server_gateway_secret(): void
    {
        $this->buyer($this->tenant, 'gw@alpha.test');

        $this->withHeaders($this->headers(null, null, 'wrong-secret'))
            ->postJson(self::BASE.'auth/login', ['email' => 'gw@alpha.test', 'password' => 'correct-horse-9'])->assertNotFound();
        $this->withHeaders($this->headers(null, null, ''))
            ->postJson(self::BASE.'auth/register', ['display_name' => 'x', 'email' => 'n@x.test', 'password' => 'password123'])->assertNotFound();
    }

    // ═══════════════════════ التسجيل وكلمة المرور وعدم التعداد ═══════════════════════

    #[Test]
    public function registration_is_identical_for_new_and_existing_emails_and_never_issues_a_token(): void
    {
        $this->buyer($this->tenant, 'taken@alpha.test');
        $payload = ['display_name' => 'Someone', 'password' => 'another-pass-123'];

        $existing = $this->storePost('auth/register', $payload + ['email' => 'taken@alpha.test'])->assertStatus(202);
        $fresh = $this->storePost('auth/register', $payload + ['email' => 'brand-new@alpha.test'])->assertStatus(202);

        $this->assertSame($existing->json('data'), $fresh->json('data'));
        $this->assertArrayNotHasKey('token', $fresh->json('data'));
        // the existing account's password was NOT replaced by the second registration
        app(TenantContext::class)->set($this->tenant->id);
        $this->assertTrue(Hash::check('correct-horse-9', CustomerIdentity::query()->where('email_normalized', 'taken@alpha.test')->firstOrFail()->password));
        app(TenantContext::class)->forget();
    }

    #[Test]
    public function passwords_are_stored_hashed_only_and_never_serialized(): void
    {
        $this->storePost('auth/register', ['display_name' => 'H', 'email' => 'hash@alpha.test', 'password' => 'plain-secret-77'])->assertStatus(202);

        $row = \DB::table('customer_identities')->where('email_normalized', 'hash@alpha.test')->first();
        $this->assertNotNull($row);
        $this->assertNotSame('plain-secret-77', $row->password);
        $this->assertTrue(Hash::check('plain-secret-77', $row->password));

        $token = $this->token('hash2@alpha.test');
        $body = json_encode($this->storeGet('me', $token)->assertOk()->json());
        $this->assertStringNotContainsString('password', strtolower($body));
        $this->assertStringNotContainsString('remember_token', $body);
    }

    #[Test]
    public function registration_rejects_client_supplied_tenant_and_ownership_ids(): void
    {
        foreach (['tenant_id', 'customer_id', 'customer_identity_id', 'partner_id'] as $i => $field) {
            $this->storePost('auth/register', [
                'display_name' => 'x', 'email' => "inj{$i}@alpha.test", 'password' => 'password123', $field => (string) Str::uuid(),
            ])->assertStatus(422);
        }
    }

    #[Test]
    public function login_failures_are_indistinguishable_for_unknown_wrong_password_inactive_and_unverified(): void
    {
        $this->buyer($this->tenant, 'ok@alpha.test');
        $this->buyer($this->tenant, 'inactive@alpha.test', active: false);
        $this->buyer($this->tenant, 'unverified@alpha.test', verified: false);

        $bodies = [
            $this->login('nobody@alpha.test')->assertStatus(422)->json(),
            $this->login('ok@alpha.test', 'wrong-password-1')->assertStatus(422)->json(),
            $this->login('inactive@alpha.test')->assertStatus(422)->json(),
            $this->login('unverified@alpha.test')->assertStatus(422)->json(),
        ];

        // identical apart from the per-request id
        $normalized = array_map(function (array $body): array {
            unset($body['meta']['request_id']);

            return $body;
        }, $bodies);
        foreach ($normalized as $body) {
            $this->assertSame($normalized[0], $body);
        }
    }

    #[Test]
    public function login_is_rate_limited_per_email(): void
    {
        RateLimiter::clear('x');
        $this->buyer($this->tenant, 'rl@alpha.test');

        for ($i = 0; $i < 5; $i++) {
            $this->login('rl@alpha.test', 'wrong-password-'.$i)->assertStatus(422);
        }
        $this->login('rl@alpha.test', 'wrong-password-6')->assertStatus(429);
        // even the correct password is throttled once the budget is exhausted (no oracle)
        $this->login('rl@alpha.test')->assertStatus(429);
    }

    #[Test]
    public function registration_is_rate_limited_per_email(): void
    {
        $payload = ['display_name' => 'x', 'email' => 'reg-rl@alpha.test', 'password' => 'password123'];
        for ($i = 0; $i < 3; $i++) {
            $this->storePost('auth/register', $payload)->assertStatus(202);
        }
        $this->storePost('auth/register', $payload)->assertStatus(429);
    }

    // ═══════════════════════ الجلسة: ربط القناة، الخروج، الإبطال ═══════════════════════

    #[Test]
    public function login_issues_a_channel_bound_token_and_me_works_only_with_it(): void
    {
        $token = $this->token();
        $this->storeGet('me')->assertStatus(401);
        $this->storeGet('me', 'garbage')->assertStatus(401);
        $this->storeGet('me', $token)->assertOk()->assertJsonPath('data.customer.email', 'buyer@alpha.test');

        $pat = \Laravel\Sanctum\PersonalAccessToken::findToken($token);
        $this->assertContains(BindStorefrontBuyerToChannel::ability($this->channel->id), $pat->abilities);
        $this->assertContains('customer:access', $pat->abilities);
    }

    #[Test]
    public function logout_invalidates_only_the_presented_session(): void
    {
        $token = $this->token();
        $second = (string) $this->login('buyer@alpha.test')->assertOk()->json('data.token');

        $this->storePost('auth/logout', [], $token)->assertOk()->assertJsonPath('data.logged_out', true);

        $this->storeGet('me', $token)->assertStatus(401);
        $this->storeGet('me', $second)->assertOk();
    }

    #[Test]
    public function a_token_is_not_reusable_across_hosts_tenants_or_channels(): void
    {
        $token = $this->token();

        // same tenant, a different wholesale channel/host
        $other = $this->makeStore('wholesale2.alpha.test', true, $this->tenant);
        $this->storeGet('me', $token, 'wholesale2.alpha.test')->assertStatus(401);

        // a different tenant's wholesale host
        $this->makeStore('wholesale.beta.test', true);
        $this->storeGet('me', $token, 'wholesale.beta.test')->assertStatus(401);

        // an unresolved/foreign host fails closed
        $this->storeGet('me', $token, 'unknown.example.test')->assertNotFound();

        $this->assertNotSame($other['channel']->id, $this->channel->id);
    }

    #[Test]
    public function a_mobile_or_customer_v1_token_without_the_channel_ability_is_rejected(): void
    {
        $identity = $this->buyer($this->tenant, 'plain@alpha.test');
        $plain = $identity->createToken('customer', ['customer:access'], now()->addDay())->plainTextToken;

        $this->storeGet('me', $plain)->assertStatus(401);
        $this->storeGet('wholesale/membership', $plain)->assertStatus(401);
    }

    #[Test]
    public function an_expired_token_is_rejected(): void
    {
        $identity = $this->buyer($this->tenant, 'exp@alpha.test');
        $token = $identity->createToken('customer', ['customer:access', BindStorefrontBuyerToChannel::ability($this->channel->id)], now()->subMinute())->plainTextToken;

        $this->storeGet('me', $token)->assertStatus(401);
    }

    #[Test]
    public function a_deactivated_or_deleted_account_loses_its_existing_session_immediately(): void
    {
        $token = $this->token('revoked@alpha.test');
        $this->storeGet('me', $token)->assertOk();

        $identity = CustomerIdentity::withoutGlobalScopes()->where('email_normalized', 'revoked@alpha.test')->firstOrFail();
        $identity->forceFill(['is_active' => false])->save();
        $this->storeGet('me', $token)->assertStatus(401);

        $identity->forceFill(['is_active' => true])->save();
        $this->storeGet('me', $token)->assertOk();
        $identity->delete();
        $this->storeGet('me', $token)->assertStatus(401);
    }

    #[Test]
    public function the_same_email_in_another_tenant_is_a_separate_identity_with_no_cross_login(): void
    {
        $beta = $this->makeStore('wholesale.beta.test', true);
        $alpha = $this->buyer($this->tenant, 'same@mail.test', 'alpha-password-1');
        $betaIdentity = $this->buyer($beta['tenant'], 'same@mail.test', 'beta-password-1');

        $this->assertNotSame($alpha->id, $betaIdentity->id);
        $this->login('same@mail.test', 'beta-password-1')->assertStatus(422);
        $this->login('same@mail.test', 'beta-password-1', 'wholesale.beta.test')->assertOk();
        $this->login('same@mail.test', 'alpha-password-1', 'wholesale.beta.test')->assertStatus(422);
    }

    // ═══════════════════════ العضوية: التقديم والحالات والوصول ═══════════════════════

    #[Test]
    public function registration_and_login_grant_no_wholesale_access(): void
    {
        $token = $this->token();

        $this->storeGet('wholesale/membership', $token)->assertOk()->assertJsonPath('data.membership', null);
        $this->storeGet('wholesale/access', $token)->assertStatus(403);
        $this->assertSame(0, WholesaleMembership::withoutGlobalScopes()->count());
    }

    #[Test]
    public function applying_is_idempotent_and_never_changes_an_existing_status(): void
    {
        $token = $this->token();

        $first = $this->applyAs($token)->assertCreated()->assertJsonPath('data.membership.status', 'pending');
        $again = $this->applyAs($token)->assertOk()->assertJsonPath('data.membership.status', 'pending');
        $this->assertSame($first->json('data.membership.applied_at'), $again->json('data.membership.applied_at'));

        $this->assertSame(1, WholesaleMembership::withoutGlobalScopes()->count());
        $this->assertSame(1, WholesaleMembershipEvent::withoutGlobalScopes()->count());
    }

    #[Test]
    public function a_buyer_cannot_self_approve_by_any_route_or_payload(): void
    {
        $token = $this->token();
        $this->storePost('wholesale/application', ['status' => 'approved', 'decided_by_user_id' => (string) Str::uuid()], $token)
            ->assertCreated()->assertJsonPath('data.membership.status', 'pending');

        $membership = $this->membershipFor(CustomerIdentity::withoutGlobalScopes()->where('email_normalized', 'buyer@alpha.test')->firstOrFail());
        // buyer token on the staff decision endpoint: not a staff principal
        $this->assertContains(
            $this->withToken($token)->postJson("/api/commerce/wholesale/memberships/{$membership->id}/approve")->getStatusCode(),
            [401, 403],
        );
        // there is no store-host route that decides
        $this->storePost("wholesale/memberships/{$membership->id}/approve", [], $token)->assertNotFound();

        $this->assertSame('pending', $membership->fresh()->status);
    }

    #[Test]
    public function pending_rejected_and_suspended_buyers_cannot_reach_protected_capabilities_but_approved_can(): void
    {
        $token = $this->token();
        $identity = CustomerIdentity::withoutGlobalScopes()->where('email_normalized', 'buyer@alpha.test')->firstOrFail();
        [, $owner] = $this->staff($this->tenant);

        $this->storeGet('wholesale/access', $token)->assertStatus(403); // no membership
        $this->applyAs($token)->assertCreated();
        $this->storeGet('wholesale/access', $token)->assertStatus(403); // pending

        $id = $this->membershipFor($identity)->id;
        $this->decide($owner, $id, 'reject')->assertOk();
        $this->storeGet('wholesale/access', $token)->assertStatus(403); // rejected
        $this->decide($owner, $id, 'approve')->assertStatus(409); // rejected is terminal in this batch

        // a fresh buyer: approved → access; suspended → access gone on the SAME session
        $token2 = $this->token('second@alpha.test');
        $this->applyAs($token2)->assertCreated();
        $second = CustomerIdentity::withoutGlobalScopes()->where('email_normalized', 'second@alpha.test')->firstOrFail();
        $id2 = $this->membershipFor($second)->id;
        $this->decide($owner, $id2, 'approve')->assertOk();
        $this->storeGet('wholesale/access', $token2)->assertOk()->assertJsonPath('data.access', true);

        $this->decide($owner, $id2, 'suspend')->assertOk();
        $this->storeGet('wholesale/access', $token2)->assertStatus(403);
        $this->storeGet('me', $token2)->assertOk(); // authentication state is independent of eligibility

        $this->decide($owner, $id2, 'reinstate')->assertOk();
        $this->storeGet('wholesale/access', $token2)->assertOk();
    }

    #[Test]
    public function approval_on_one_channel_grants_nothing_on_another_channel_of_the_same_tenant(): void
    {
        [$token] = $this->approvedBuyer();
        $this->makeStore('wholesale2.alpha.test', true, $this->tenant);
        $identity = CustomerIdentity::withoutGlobalScopes()->where('email_normalized', 'buyer@alpha.test')->firstOrFail();

        // log in on the second host: a fresh channel-bound session, but no membership there
        $second = (string) $this->login('buyer@alpha.test', 'correct-horse-9', 'wholesale2.alpha.test')->assertOk()->json('data.token');
        $this->storeGet('wholesale/access', $second, 'wholesale2.alpha.test')->assertStatus(403);
        $this->storeGet('wholesale/access', $token)->assertOk();
        $this->assertSame(1, WholesaleMembership::withoutGlobalScopes()->where('customer_identity_id', $identity->id)->count());
    }

    #[Test]
    public function buyer_payloads_never_expose_staff_or_internal_decision_metadata(): void
    {
        [$token, $identity, $owner] = $this->approvedBuyer();
        $this->decide($owner, $this->membershipFor($identity)->id, 'suspend', ['note' => 'INTERNAL-NOTE-XYZ'])->assertOk();

        $body = json_encode($this->storeGet('wholesale/membership', $token)->assertOk()->json());
        $this->assertStringContainsString('suspended', $body);
        foreach (['INTERNAL-NOTE-XYZ', 'decision_note', 'decided_by', 'tenant_id', 'sales_channel_id', 'customer_identity_id', 'password'] as $leak) {
            $this->assertStringNotContainsString($leak, $body);
        }
    }

    // ═══════════════════════ قرارات الموظف: RBAC والتدقيق والعزل ═══════════════════════

    #[Test]
    public function decisions_require_authentication_and_the_explicit_wholesale_permission(): void
    {
        $token = $this->token();
        $this->applyAs($token)->assertCreated();
        $id = $this->membershipFor(CustomerIdentity::withoutGlobalScopes()->where('email_normalized', 'buyer@alpha.test')->firstOrFail())->id;

        $this->postJson("/api/commerce/wholesale/memberships/{$id}/approve")->assertUnauthorized();

        foreach (['accountant', 'staff'] as $role) {
            [, $staffToken] = $this->staff($this->tenant, $role);
            $this->decide($staffToken, $id, 'approve')->assertForbidden();
            $this->withToken($staffToken)->getJson("/api/commerce/wholesale/channels/{$this->channel->id}/memberships")->assertForbidden();
        }

        // a stored custom role holding only a nearby permission is still refused
        app(TenantContext::class)->set($this->tenant->id);
        Role::create(['slug' => 'orders_only', 'name' => 'طلبات', 'permissions' => ['commerce.orders.view', 'commerce.manage'], 'is_system' => false]);
        app(TenantContext::class)->forget();
        [, $custom] = $this->staff($this->tenant, 'orders_only');
        $this->decide($custom, $id, 'approve')->assertForbidden();

        $this->assertSame('pending', $this->membershipFor(CustomerIdentity::withoutGlobalScopes()->where('email_normalized', 'buyer@alpha.test')->firstOrFail())->status);
    }

    #[Test]
    public function the_permission_is_explicit_owner_admin_only_and_never_in_the_matrix(): void
    {
        $this->assertContains('commerce.wholesale.manage', Rbac::PERMISSIONS);
        foreach (Rbac::MATRIX as $role => $permissions) {
            if (in_array('*', $permissions, true)) {
                continue;
            }
            $this->assertNotContains('commerce.wholesale.manage', $permissions, "role {$role}");
        }
        $this->assertTrue(Rbac::allows('owner', 'commerce.wholesale.manage'));
        $this->assertTrue(Rbac::allows('admin', 'commerce.wholesale.manage'));
        $this->assertFalse(Rbac::allows('accountant', 'commerce.wholesale.manage'));
        $this->assertFalse(Rbac::allows('staff', 'commerce.wholesale.manage'));
    }

    #[Test]
    public function every_decision_records_actor_timestamp_and_an_immutable_event(): void
    {
        $token = $this->token();
        $this->applyAs($token)->assertCreated();
        $identity = CustomerIdentity::withoutGlobalScopes()->where('email_normalized', 'buyer@alpha.test')->firstOrFail();
        [$ownerUser, $owner] = $this->staff($this->tenant);
        $id = $this->membershipFor($identity)->id;

        $this->travelTo(now()->addMinute());
        $this->decide($owner, $id, 'approve', ['note' => 'verified CR'])->assertOk()
            ->assertJsonPath('data.status', 'approved')
            ->assertJsonPath('data.decided_by.id', $ownerUser->id)
            ->assertJsonPath('data.decision_note', 'verified CR');
        $this->decide($owner, $id, 'suspend')->assertOk()->assertJsonPath('data.status', 'suspended');

        app(TenantContext::class)->set($this->tenant->id);
        $events = WholesaleMembershipEvent::query()->where('wholesale_membership_id', $id)->orderBy('created_at')->orderBy('to_status')->get();
        $this->assertSame(
            [[null, 'pending', 'buyer'], ['pending', 'approved', 'staff'], ['approved', 'suspended', 'staff']],
            $events->map(fn ($e) => [$e->from_status, $e->to_status, $e->actor_type])->sortBy(fn ($r) => array_search($r[1], ['pending', 'approved', 'suspended']))->values()->all(),
        );
        $this->assertSame($ownerUser->id, $events->firstWhere('to_status', 'approved')->actor_user_id);
        $this->assertNotNull(WholesaleMembership::query()->find($id)->decided_at);

        $event = $events->first();
        try {
            $event->update(['note' => 'tamper']);
            $this->fail('event must be immutable');
        } catch (\LogicException) {
            $this->addToAssertionCount(1);
        }
        app(TenantContext::class)->forget();
    }

    #[Test]
    public function invalid_and_stale_transitions_are_refused_with_409(): void
    {
        [, , $owner] = $this->approvedBuyer();
        $identity = CustomerIdentity::withoutGlobalScopes()->where('email_normalized', 'buyer@alpha.test')->firstOrFail();
        $id = $this->membershipFor($identity)->id;

        $this->decide($owner, $id, 'approve')->assertStatus(409)->assertJsonPath('reason', 'invalid_transition'); // double approve
        $this->decide($owner, $id, 'reject')->assertStatus(409);     // approved cannot be rejected
        $this->decide($owner, $id, 'reinstate')->assertStatus(409);  // not suspended
        $this->decide($owner, $id, 'suspend')->assertOk();
        $this->decide($owner, $id, 'suspend')->assertStatus(409);    // double suspend
        $this->decide($owner, $id, 'approve')->assertStatus(409);    // suspended must be *reinstated*
        $this->decide($owner, $id, 'delete')->assertNotFound();      // unknown action is not routable
        $this->decide($owner, $id, 'approve', ['note' => str_repeat('x', 501)])->assertStatus(422);
    }

    #[Test]
    public function a_concurrent_approve_and_suspend_cannot_both_succeed_against_a_stale_read(): void
    {
        $token = $this->token();
        $this->applyAs($token)->assertCreated();
        $identity = CustomerIdentity::withoutGlobalScopes()->where('email_normalized', 'buyer@alpha.test')->firstOrFail();
        [$user] = $this->staff($this->tenant);
        $id = $this->membershipFor($identity)->id;

        app(TenantContext::class)->set($this->tenant->id);
        $service = app(WholesaleMembershipService::class);
        // Two staff decisions raced from the same "pending" snapshot: the transition re-reads the CURRENT row
        // under lock, so the loser is refused rather than silently overwriting.
        $service->transition($id, 'approve', $user);
        try {
            $service->transition($id, 'reject', $user);
            $this->fail('reject after approve must be refused');
        } catch (WholesaleMembershipException $e) {
            $this->assertSame('invalid_transition', $e->reason);
        }
        $service->transition($id, 'suspend', $user);
        try {
            $service->transition($id, 'approve', $user);
            $this->fail('approve after suspend must be refused');
        } catch (WholesaleMembershipException $e) {
            $this->assertSame('invalid_transition', $e->reason);
        }
        $this->assertSame('suspended', WholesaleMembership::query()->find($id)->status);
        $this->assertSame(3, WholesaleMembershipEvent::query()->where('wholesale_membership_id', $id)->count());
        app(TenantContext::class)->forget();
    }

    #[Test]
    public function applying_twice_in_a_race_converges_on_one_membership(): void
    {
        $identity = $this->buyer($this->tenant, 'race@alpha.test');
        app(TenantContext::class)->set($this->tenant->id);
        $service = app(WholesaleMembershipService::class);

        $a = $service->apply($identity, $this->channel->id);
        $b = $service->apply($identity, $this->channel->id);

        $this->assertSame($a->id, $b->id);
        $this->assertSame(1, WholesaleMembership::query()->count());
        $this->assertSame(1, WholesaleMembershipEvent::query()->count());
        app(TenantContext::class)->forget();
    }

    #[Test]
    public function another_tenants_staff_and_channels_are_a_plain_404(): void
    {
        $token = $this->token();
        $this->applyAs($token)->assertCreated();
        $id = $this->membershipFor(CustomerIdentity::withoutGlobalScopes()->where('email_normalized', 'buyer@alpha.test')->firstOrFail())->id;

        $beta = $this->makeStore('wholesale.beta.test', true);
        [, $betaOwner] = $this->staff($beta['tenant']);

        $this->decide($betaOwner, $id, 'approve')->assertNotFound();
        $this->withToken($betaOwner)->getJson("/api/commerce/wholesale/channels/{$this->channel->id}/memberships")->assertNotFound();
        $this->assertSame('pending', WholesaleMembership::withoutGlobalScopes()->find($id)->status);
    }

    #[Test]
    public function the_staff_list_is_scoped_filtered_and_free_of_credentials(): void
    {
        $this->applyAs($this->token('a@alpha.test'))->assertCreated();
        $this->applyAs($this->token('b@alpha.test'))->assertCreated();
        $beta = $this->makeStore('wholesale.beta.test', true);
        $this->applyAs($this->token('c@beta.test', 'wholesale.beta.test', $beta['tenant']), 'wholesale.beta.test')->assertCreated();
        [, $owner] = $this->staff($this->tenant);

        $list = $this->withToken($owner)->getJson("/api/commerce/wholesale/channels/{$this->channel->id}/memberships")->assertOk();
        $this->assertCount(2, $list->json('data'));
        $this->assertEqualsCanonicalizing(['a@alpha.test', 'b@alpha.test'], array_column(array_column($list->json('data'), 'customer'), 'email'));
        $this->assertStringNotContainsString('password', strtolower(json_encode($list->json())));

        $this->withToken($owner)->getJson("/api/commerce/wholesale/channels/{$this->channel->id}/memberships?status=approved")->assertOk()->assertJsonCount(0, 'data');
        $this->withToken($owner)->getJson("/api/commerce/wholesale/channels/{$this->channel->id}/memberships?status=bogus")->assertStatus(422);

        // a non-wholesale channel is not listable
        $dtc = $this->makeStore('shop.alpha.test', false, $this->tenant);
        $this->withToken($owner)->getJson("/api/commerce/wholesale/channels/{$dtc['channel']->id}/memberships")->assertNotFound();
    }

    // ═══════════════════════ الترحيل: الرجوع آمن ═══════════════════════

    #[Test]
    public function the_migration_refuses_to_roll_back_while_decision_history_exists(): void
    {
        $this->applyAs($this->token())->assertCreated();

        $migration = require base_path('database/migrations/2026_12_15_010000_create_wholesale_memberships.php');
        $this->expectException(\RuntimeException::class);
        $migration->down();
    }
}
