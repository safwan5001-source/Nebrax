<?php

namespace Tests\Feature;

use App\Models\CustomerIdentity;
use App\Models\CustomerOtpCode;
use App\Models\Partner;
use App\Models\PublicApiRequestLog;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Models\User;
use App\Services\ApiClientKeyService;
use App\Services\Commerce\Otp\FakeOtpProvider;
use App\Services\CustomerPartnerLinkService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  Public/Mobile Commerce API V1 — COM-MOBILE-AUTH-1
 * ═══════════════════════════════════════════════════════════════
 *  يثبت مصادقة عميل `/commerce/v1` بآليتين مستقلّتين: هاتف+OTP (أساسية،
 *  تسجيل أو دخول موحّد) وبريد+كلمة مرور (بديلة، تُعيد استخدام سلطة
 *  `/customer/v1` حرفياً). عزل مستأجرين، `X-Customer-Token` منفصل عن
 *  `Authorization` (ApiClient)، وضبط معدّل الإصدار لكل هاتف.
 *
 *  تشغيل: php artisan test --filter=CommerceCustomerAuthApiTest
 */
class CommerceCustomerAuthApiTest extends TestCase
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

    private function bearer(string $token): array
    {
        return ['Authorization' => 'Bearer '.$token];
    }

    private function withCustomerToken(string $apiToken, string $customerToken): array
    {
        return $this->bearer($apiToken) + ['X-Customer-Token' => $customerToken];
    }

    // ═══════════════════════════════════════════════════════════
    //  Phone + OTP — unified register-or-login
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function requesting_an_otp_code_for_a_new_phone_succeeds_and_creates_no_identity_yet(): void
    {
        $store = $this->seedMobileStore('otp-request');

        $this->postJson('/commerce/v1/auth/otp/request', ['phone' => '+966500000001'], $this->bearer($store['token']))
            ->assertStatus(202)
            ->assertJsonPath('data.sent', true);

        $this->assertSame(0, CustomerIdentity::query()->count());
        $this->assertSame(1, CustomerOtpCode::query()->count());
    }

    /** @test */
    public function verifying_a_correct_code_for_a_new_phone_creates_a_verified_identity_and_issues_a_token(): void
    {
        $store = $this->seedMobileStore('otp-new');
        $phone = '+966500000002';

        $this->postJson('/commerce/v1/auth/otp/request', ['phone' => $phone], $this->bearer($store['token']))
            ->assertStatus(202);

        $code = FakeOtpProvider::lastCodeFor($store['tenant']->id, $phone, 'login');
        $this->assertNotNull($code);

        $response = $this->postJson('/commerce/v1/auth/otp/verify', ['phone' => $phone, 'code' => $code], $this->bearer($store['token']))
            ->assertOk();

        $response->assertJsonPath('data.customer.phone_verified', true);
        $this->assertNotEmpty($response->json('data.token'));

        $identity = CustomerIdentity::query()->where('phone_e164', $phone)->first();
        $this->assertNotNull($identity);
        $this->assertNotNull($identity->phone_verified_at);
        $this->assertNull($identity->email);
    }

    /** @test */
    public function verifying_the_same_phone_twice_logs_into_the_same_identity_without_creating_a_duplicate(): void
    {
        $store = $this->seedMobileStore('otp-login');
        $phone = '+966500000003';

        $this->postJson('/commerce/v1/auth/otp/request', ['phone' => $phone], $this->bearer($store['token']));
        $firstCode = FakeOtpProvider::lastCodeFor($store['tenant']->id, $phone, 'login');
        $first = $this->postJson('/commerce/v1/auth/otp/verify', ['phone' => $phone, 'code' => $firstCode], $this->bearer($store['token']))->assertOk();
        $firstIdentityId = $first->json('data.customer.id');

        $this->postJson('/commerce/v1/auth/otp/request', ['phone' => $phone], $this->bearer($store['token']));
        $secondCode = FakeOtpProvider::lastCodeFor($store['tenant']->id, $phone, 'login');
        $second = $this->postJson('/commerce/v1/auth/otp/verify', ['phone' => $phone, 'code' => $secondCode], $this->bearer($store['token']))->assertOk();

        $this->assertSame($firstIdentityId, $second->json('data.customer.id'));
        $this->assertSame(1, CustomerIdentity::query()->count());
    }

    /** @test */
    public function a_wrong_code_is_rejected_and_does_not_consume_the_real_code(): void
    {
        $store = $this->seedMobileStore('otp-wrong');
        $phone = '+966500000004';

        $this->postJson('/commerce/v1/auth/otp/request', ['phone' => $phone], $this->bearer($store['token']));
        $realCode = FakeOtpProvider::lastCodeFor($store['tenant']->id, $phone, 'login');
        $wrongCode = $realCode === '000000' ? '111111' : '000000';

        $this->postJson('/commerce/v1/auth/otp/verify', ['phone' => $phone, 'code' => $wrongCode], $this->bearer($store['token']))
            ->assertStatus(422);

        $this->postJson('/commerce/v1/auth/otp/verify', ['phone' => $phone, 'code' => $realCode], $this->bearer($store['token']))
            ->assertOk();
    }

    /** @test */
    public function a_code_cannot_be_verified_more_than_the_configured_attempt_limit(): void
    {
        $store = $this->seedMobileStore('otp-attempts');
        $phone = '+966500000005';

        $this->postJson('/commerce/v1/auth/otp/request', ['phone' => $phone], $this->bearer($store['token']));
        $realCode = FakeOtpProvider::lastCodeFor($store['tenant']->id, $phone, 'login');
        $wrongCode = $realCode === '000000' ? '111111' : '000000';

        for ($i = 0; $i < 5; $i++) {
            $this->postJson('/commerce/v1/auth/otp/verify', ['phone' => $phone, 'code' => $wrongCode], $this->bearer($store['token']))
                ->assertStatus(422);
        }

        // The real code is now locked out too — attempts exhausted.
        $this->postJson('/commerce/v1/auth/otp/verify', ['phone' => $phone, 'code' => $realCode], $this->bearer($store['token']))
            ->assertStatus(422);
    }

    /** @test */
    public function an_expired_code_is_rejected(): void
    {
        $store = $this->seedMobileStore('otp-expired');
        $phone = '+966500000006';

        $this->postJson('/commerce/v1/auth/otp/request', ['phone' => $phone], $this->bearer($store['token']));
        $code = FakeOtpProvider::lastCodeFor($store['tenant']->id, $phone, 'login');

        CustomerOtpCode::query()->update(['expires_at' => now()->subMinute()]);

        $this->postJson('/commerce/v1/auth/otp/verify', ['phone' => $phone, 'code' => $code], $this->bearer($store['token']))
            ->assertStatus(422);
    }

    /** @test */
    public function requesting_too_many_codes_in_the_issuance_window_is_rejected(): void
    {
        $store = $this->seedMobileStore('otp-flood');
        $phone = '+966500000007';

        for ($i = 0; $i < 3; $i++) {
            $this->postJson('/commerce/v1/auth/otp/request', ['phone' => $phone], $this->bearer($store['token']))
                ->assertStatus(202);
        }

        $this->postJson('/commerce/v1/auth/otp/request', ['phone' => $phone], $this->bearer($store['token']))
            ->assertStatus(422);
    }

    /** @test */
    public function a_new_otp_request_invalidates_the_previous_unconsumed_code(): void
    {
        $store = $this->seedMobileStore('otp-invalidate');
        $phone = '+966500000008';

        $this->postJson('/commerce/v1/auth/otp/request', ['phone' => $phone], $this->bearer($store['token']));
        $firstCode = FakeOtpProvider::lastCodeFor($store['tenant']->id, $phone, 'login');

        $this->postJson('/commerce/v1/auth/otp/request', ['phone' => $phone], $this->bearer($store['token']));

        $this->postJson('/commerce/v1/auth/otp/verify', ['phone' => $phone, 'code' => $firstCode], $this->bearer($store['token']))
            ->assertStatus(422);
    }

    /** @test */
    public function otp_codes_are_isolated_per_tenant_even_for_the_same_phone_number(): void
    {
        $storeA = $this->seedMobileStore('otp-tenant-a');
        $storeB = $this->seedMobileStore('otp-tenant-b');
        $phone = '+966500000009';

        $this->postJson('/commerce/v1/auth/otp/request', ['phone' => $phone], $this->bearer($storeA['token']));
        $codeA = FakeOtpProvider::lastCodeFor($storeA['tenant']->id, $phone, 'login');

        // Tenant B never issued a code for this phone — A's code must not verify there.
        $this->postJson('/commerce/v1/auth/otp/verify', ['phone' => $phone, 'code' => $codeA], $this->bearer($storeB['token']))
            ->assertStatus(422);

        $this->postJson('/commerce/v1/auth/otp/verify', ['phone' => $phone, 'code' => $codeA], $this->bearer($storeA['token']))
            ->assertOk();
    }

    /** @test */
    public function an_invalid_phone_shape_is_rejected_by_validation(): void
    {
        $store = $this->seedMobileStore('otp-shape');

        $this->postJson('/commerce/v1/auth/otp/request', ['phone' => '0500000000'], $this->bearer($store['token']))
            ->assertStatus(422);
    }

    /**
     * A self-declared, never-verified phone entered through the
     * email+password registration path must not resolve an OTP login into
     * that identity — otherwise whoever later proves real control of the
     * number (a wrong/reused/squatted entry) would silently see the
     * original registrant's email/profile.
     */
    /** @test */
    public function proving_otp_control_of_an_unverified_self_declared_phone_does_not_log_into_that_identity(): void
    {
        $store = $this->seedMobileStore('otp-squatted-phone');
        $phone = '+966500000015';

        app(TenantContext::class)->set($store['tenant']->id);
        CustomerIdentity::create([
            'tenant_id' => $store['tenant']->id,
            'display_name' => 'مسجّل بالبريد',
            'email' => 'squatter@commerce-auth.test',
            'phone' => $phone,
            'password' => 'password123',
            'email_verified_at' => null,
            'is_active' => true,
        ]);
        app(TenantContext::class)->forget();

        $this->postJson('/commerce/v1/auth/otp/request', ['phone' => $phone], $this->bearer($store['token']))
            ->assertStatus(202);
        $code = FakeOtpProvider::lastCodeFor($store['tenant']->id, $phone, 'login');

        $this->postJson('/commerce/v1/auth/otp/verify', ['phone' => $phone, 'code' => $code], $this->bearer($store['token']))
            ->assertStatus(422);

        // No duplicate identity was created, and the original stays unverified.
        $this->assertSame(1, CustomerIdentity::query()->where('phone_e164', $phone)->count());
        $identity = CustomerIdentity::query()->where('phone_e164', $phone)->firstOrFail();
        $this->assertNull($identity->phone_verified_at);
    }

    // ═══════════════════════════════════════════════════════════
    //  Email + password — reuses /customer/v1's own authorities
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function email_registration_is_accepted_but_issues_no_token_pending_verification(): void
    {
        $store = $this->seedMobileStore('email-register');

        $response = $this->postJson('/commerce/v1/auth/register', [
            'display_name' => 'عميل جديد',
            'email' => 'new-customer@commerce-auth.test',
            'password' => 'password123',
        ], $this->bearer($store['token']))->assertStatus(202);

        $response->assertJsonPath('data.verification_required', true);
        $this->assertArrayNotHasKey('token', $response->json('data'));

        $identity = CustomerIdentity::query()->where('email_normalized', 'new-customer@commerce-auth.test')->first();
        $this->assertNotNull($identity);
        $this->assertNull($identity->email_verified_at);
    }

    /** @test */
    public function a_verified_email_identity_can_log_in_and_receive_a_token(): void
    {
        $store = $this->seedMobileStore('email-login');

        app(TenantContext::class)->set($store['tenant']->id);
        CustomerIdentity::create([
            'tenant_id' => $store['tenant']->id,
            'display_name' => 'عميل موثّق',
            'email' => 'verified@commerce-auth.test',
            'password' => 'password123',
            'email_verified_at' => now(),
            'is_active' => true,
        ]);
        app(TenantContext::class)->forget();

        $response = $this->postJson('/commerce/v1/auth/login', [
            'email' => 'verified@commerce-auth.test',
            'password' => 'password123',
        ], $this->bearer($store['token']))->assertOk();

        $this->assertNotEmpty($response->json('data.token'));
        $response->assertJsonPath('data.customer.email_verified', true);
    }

    /** @test */
    public function an_unverified_email_identity_cannot_log_in(): void
    {
        $store = $this->seedMobileStore('email-unverified');

        app(TenantContext::class)->set($store['tenant']->id);
        CustomerIdentity::create([
            'tenant_id' => $store['tenant']->id,
            'display_name' => 'غير موثّق',
            'email' => 'unverified@commerce-auth.test',
            'password' => 'password123',
            'email_verified_at' => null,
            'is_active' => true,
        ]);
        app(TenantContext::class)->forget();

        $this->postJson('/commerce/v1/auth/login', [
            'email' => 'unverified@commerce-auth.test',
            'password' => 'password123',
        ], $this->bearer($store['token']))->assertStatus(422);
    }

    // ═══════════════════════════════════════════════════════════
    //  Authenticated profile — X-Customer-Token, separate from Authorization
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function me_returns_the_authenticated_customer_using_the_customer_token_header(): void
    {
        $store = $this->seedMobileStore('me');
        $phone = '+966500000010';

        $this->postJson('/commerce/v1/auth/otp/request', ['phone' => $phone], $this->bearer($store['token']));
        $code = FakeOtpProvider::lastCodeFor($store['tenant']->id, $phone, 'login');
        $verify = $this->postJson('/commerce/v1/auth/otp/verify', ['phone' => $phone, 'code' => $code], $this->bearer($store['token']))->assertOk();
        $customerToken = $verify->json('data.token');

        $response = $this->getJson('/commerce/v1/me', $this->withCustomerToken($store['token'], $customerToken))->assertOk();
        $response->assertJsonPath('data.customer.phone', $phone);
        $response->assertJsonPath('data.partner_link.linked', false);
    }

    /** @test */
    public function me_without_a_customer_token_is_rejected_even_with_a_valid_store_bearer(): void
    {
        $store = $this->seedMobileStore('me-no-token');

        $this->getJson('/commerce/v1/me', $this->bearer($store['token']))->assertStatus(401);
    }

    /** @test */
    public function the_store_bearer_token_itself_is_rejected_as_a_customer_token(): void
    {
        $store = $this->seedMobileStore('me-wrong-token-type');

        // The ApiClient/store bearer is a different tokenable type entirely —
        // must not be accepted as a customer token even though it is a
        // structurally valid Sanctum token.
        $this->getJson('/commerce/v1/me', $this->withCustomerToken($store['token'], $store['token']))
            ->assertStatus(401);
    }

    /** @test */
    public function a_customer_token_from_a_foreign_tenant_is_rejected(): void
    {
        $storeA = $this->seedMobileStore('me-foreign-a');
        $storeB = $this->seedMobileStore('me-foreign-b');
        $phone = '+966500000011';

        $this->postJson('/commerce/v1/auth/otp/request', ['phone' => $phone], $this->bearer($storeA['token']));
        $code = FakeOtpProvider::lastCodeFor($storeA['tenant']->id, $phone, 'login');
        $verify = $this->postJson('/commerce/v1/auth/otp/verify', ['phone' => $phone, 'code' => $code], $this->bearer($storeA['token']))->assertOk();
        $customerToken = $verify->json('data.token');

        // Store B's own bearer + tenant A's customer token — must fail closed.
        $this->getJson('/commerce/v1/me', $this->withCustomerToken($storeB['token'], $customerToken))
            ->assertStatus(401);
    }

    /** @test */
    public function logout_revokes_the_customer_token_so_it_cannot_be_reused(): void
    {
        $store = $this->seedMobileStore('logout');
        $phone = '+966500000012';

        $this->postJson('/commerce/v1/auth/otp/request', ['phone' => $phone], $this->bearer($store['token']));
        $code = FakeOtpProvider::lastCodeFor($store['tenant']->id, $phone, 'login');
        $verify = $this->postJson('/commerce/v1/auth/otp/verify', ['phone' => $phone, 'code' => $code], $this->bearer($store['token']))->assertOk();
        $customerToken = $verify->json('data.token');

        $this->postJson('/commerce/v1/auth/logout', [], $this->withCustomerToken($store['token'], $customerToken))->assertOk();

        $this->getJson('/commerce/v1/me', $this->withCustomerToken($store['token'], $customerToken))->assertStatus(401);
    }

    /** @test */
    public function an_inactive_identity_cannot_authenticate_via_me(): void
    {
        $store = $this->seedMobileStore('inactive');
        $phone = '+966500000013';

        $this->postJson('/commerce/v1/auth/otp/request', ['phone' => $phone], $this->bearer($store['token']));
        $code = FakeOtpProvider::lastCodeFor($store['tenant']->id, $phone, 'login');
        $verify = $this->postJson('/commerce/v1/auth/otp/verify', ['phone' => $phone, 'code' => $code], $this->bearer($store['token']))->assertOk();
        $customerToken = $verify->json('data.token');

        CustomerIdentity::query()->where('phone_e164', $phone)->update(['is_active' => false]);

        $this->getJson('/commerce/v1/me', $this->withCustomerToken($store['token'], $customerToken))->assertStatus(401);
    }

    // ═══════════════════════════════════════════════════════════
    //  Audit trail survives the customer resolver swap
    // ═══════════════════════════════════════════════════════════

    /**
     * `PublicApiRequestAudit::terminate()` is terminable — it runs after the
     * full middleware stack unwinds and only writes a row when
     * `$request->user()` is still the `ApiClient` at that point.
     * `AuthenticateCommerceCustomer` must restore that resolver after
     * `$next()` returns, or every authenticated customer request would
     * silently lose its audit record.
     */
    /** @test */
    public function an_authenticated_customer_request_still_writes_an_api_client_audit_record(): void
    {
        $store = $this->seedMobileStore('audit');
        $phone = '+966500000016';

        $this->postJson('/commerce/v1/auth/otp/request', ['phone' => $phone], $this->bearer($store['token']));
        $code = FakeOtpProvider::lastCodeFor($store['tenant']->id, $phone, 'login');
        $verify = $this->postJson('/commerce/v1/auth/otp/verify', ['phone' => $phone, 'code' => $code], $this->bearer($store['token']))->assertOk();
        $customerToken = $verify->json('data.token');

        $before = PublicApiRequestLog::query()->count();

        $this->getJson('/commerce/v1/me', $this->withCustomerToken($store['token'], $customerToken))->assertOk();

        $this->assertSame($before + 1, PublicApiRequestLog::query()->count());
        $log = PublicApiRequestLog::query()->latest('created_at')->first();
        $this->assertSame($store['tenant']->id, $log->tenant_id);
    }

    // ═══════════════════════════════════════════════════════════
    //  A phone-verified-only identity is eligible for a Partner link
    // ═══════════════════════════════════════════════════════════

    /**
     * `CustomerPartnerLinkService::assertEligible()` must accept a
     * phone-OTP-verified identity even though it has no `email_verified_at`
     * at all — otherwise the primary (phone+OTP) mechanism could never be
     * partner-linked, and `EstablishCustomerContext` would always report it
     * as unlinked.
     */
    /** @test */
    public function a_phone_verified_only_identity_can_be_linked_to_a_partner(): void
    {
        $store = $this->seedMobileStore('link-phone');
        $phone = '+966500000017';

        $this->postJson('/commerce/v1/auth/otp/request', ['phone' => $phone], $this->bearer($store['token']));
        $code = FakeOtpProvider::lastCodeFor($store['tenant']->id, $phone, 'login');
        $this->postJson('/commerce/v1/auth/otp/verify', ['phone' => $phone, 'code' => $code], $this->bearer($store['token']))->assertOk();
        $identity = CustomerIdentity::query()->where('phone_e164', $phone)->firstOrFail();

        app(TenantContext::class)->set($store['tenant']->id);
        $partner = Partner::create([
            'tenant_id' => $store['tenant']->id, 'name' => 'عميل مرتبط بالهاتف', 'type' => 'customer', 'is_active' => true,
        ]);
        $actor = User::create([
            'tenant_id' => $store['tenant']->id, 'name' => 'Owner', 'email' => 'owner-link-phone@test.local',
            'password' => 'password123', 'role' => 'owner', 'is_active' => true,
        ]);

        $link = app(CustomerPartnerLinkService::class)->link($identity, $partner, $actor);
        app(TenantContext::class)->forget();

        $this->assertSame('active', $link->status);
        $this->assertSame($partner->id, $link->partner_id);
    }

    // ═══════════════════════════════════════════════════════════
    //  Hashing — OTP codes are never stored in plaintext
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function the_otp_code_is_stored_hashed_not_in_plaintext(): void
    {
        $store = $this->seedMobileStore('otp-hash');
        $phone = '+966500000014';

        $this->postJson('/commerce/v1/auth/otp/request', ['phone' => $phone], $this->bearer($store['token']));
        $code = FakeOtpProvider::lastCodeFor($store['tenant']->id, $phone, 'login');

        $record = CustomerOtpCode::query()->where('phone_e164', $phone)->firstOrFail();
        $this->assertNotSame($code, $record->code_hash);
        $this->assertTrue(Hash::check($code, $record->code_hash));
    }
}
