<?php

namespace Tests\Feature;

use App\Models\CustomerIdentity;
use App\Models\CustomerPartnerLink;
use App\Models\Partner;
use App\Models\Tenant;
use App\Models\User;
use App\Services\CustomerPartnerLinkService;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\PersonalAccessToken;
use Tests\TestCase;

class CustomerDigitalAccessTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    public function test_staff_group_enforces_user_principal_before_tenant_and_branch(): void
    {
        $route = Route::getRoutes()->match(Request::create('/api/me', 'GET'));
        $middleware = $route->gatherMiddleware();

        $auth = array_search('auth:sanctum', $middleware, true);
        $principal = array_search(\App\Http\Middleware\EnsureUserPrincipal::class, $middleware, true);
        $tenant = array_search(\App\Http\Middleware\SetTenant::class, $middleware, true);
        $branch = array_search(\App\Http\Middleware\SetBranch::class, $middleware, true);

        $this->assertIsInt($auth);
        $this->assertIsInt($principal);
        $this->assertIsInt($tenant);
        $this->assertIsInt($branch);
        $this->assertTrue($auth < $principal && $principal < $tenant && $tenant < $branch);
    }

    public function test_staff_user_works_customer_token_is_denied_from_staff_and_staff_token_is_denied_from_customer(): void
    {
        $staff = $this->registerTenant('principal-gate', 'owner@principal.test');
        $tenant = Tenant::findOrFail($staff['tenant_id']);
        $customer = $this->verifiedIdentity($tenant, 'customer@principal.test');
        $customerToken = $this->customerToken($customer);

        $this->withToken($staff['token'])->getJson('/api/me')->assertOk();
        $this->withToken($customerToken)->getJson('/api/me')->assertForbidden();
        $this->withToken($staff['token'])
            ->getJson("/api/customer/v1/{$tenant->slug}/me")
            ->assertForbidden();
    }

    public function test_same_normalized_email_is_allowed_across_tenants(): void
    {
        $alpha = $this->tenant('customer-alpha');
        $beta = $this->tenant('customer-beta');

        $this->verifiedIdentity($alpha, '  Shared@Example.Test ');
        $this->verifiedIdentity($beta, 'shared@example.test');

        $this->assertSame(
            2,
            CustomerIdentity::withoutGlobalScopes()
                ->where('email_normalized', 'shared@example.test')
                ->count()
        );
    }

    public function test_duplicate_normalized_email_is_rejected_by_database_inside_one_tenant(): void
    {
        $tenant = $this->tenant('customer-duplicate');
        $this->verifiedIdentity($tenant, 'Duplicate@Example.Test');

        app(TenantContext::class)->set($tenant->id);
        $this->expectException(QueryException::class);

        CustomerIdentity::create([
            'tenant_id' => $tenant->id,
            'display_name' => 'Duplicate',
            'email' => ' duplicate@example.test ',
            'password' => 'password123',
            'email_verified_at' => now(),
        ]);
    }

    public function test_registration_is_unverified_unlinked_and_non_enumerating_for_duplicates(): void
    {
        $tenant = $this->tenant('customer-register');
        $this->withTenant($tenant, fn () => Partner::create([
            'tenant_id' => $tenant->id,
            'name' => 'Matching Partner',
            'type' => 'customer',
            'email' => 'match@example.test',
        ]));

        $payload = [
            'display_name' => 'New Customer',
            'email' => 'Match@Example.Test',
            'password' => 'password123',
        ];

        $first = $this->postJson("/api/customer/v1/{$tenant->slug}/auth/register", $payload)
            ->assertAccepted()
            ->assertJsonMissingPath('token');
        $second = $this->postJson("/api/customer/v1/{$tenant->slug}/auth/register", $payload)
            ->assertAccepted();

        $this->assertSame($first->json(), $second->json());
        $this->assertSame(1, CustomerIdentity::withoutGlobalScopes()->count());
        $identity = CustomerIdentity::withoutGlobalScopes()->firstOrFail();
        $this->assertNull($identity->email_verified_at);
        $this->assertSame(0, CustomerPartnerLink::withoutGlobalScopes()->count());
        $this->assertSame(1, Partner::withoutGlobalScopes()->count());
    }

    public function test_tenant_is_resolved_before_credential_lookup(): void
    {
        $alpha = $this->tenant('login-alpha');
        $beta = $this->tenant('login-beta');
        $this->verifiedIdentity($alpha, 'same@login.test', 'alpha-password');
        $this->verifiedIdentity($beta, 'same@login.test', 'beta-password');

        $this->postJson("/api/customer/v1/{$alpha->slug}/auth/login", [
            'email' => 'same@login.test',
            'password' => 'beta-password',
        ])->assertUnprocessable();

        $this->postJson("/api/customer/v1/{$beta->slug}/auth/login", [
            'email' => 'SAME@LOGIN.TEST',
            'password' => 'beta-password',
        ])->assertOk()->assertJsonStructure(['token', 'customer' => ['id', 'email']]);
    }

    public function test_missing_unknown_inactive_and_deleted_tenants_fail_closed(): void
    {
        $inactive = $this->tenant('inactive-customer-tenant');
        $inactive->update(['is_active' => false]);
        $deleted = $this->tenant('deleted-customer-tenant');
        $deleted->delete();
        $payload = ['email' => 'nobody@example.test', 'password' => 'password123'];

        $this->postJson('/api/customer/v1/missing/auth/login', $payload)->assertNotFound();
        $this->postJson("/api/customer/v1/{$inactive->slug}/auth/login", $payload)->assertNotFound();
        $this->postJson("/api/customer/v1/{$deleted->slug}/auth/login", $payload)->assertNotFound();
        $this->postJson('/api/customer/v1//auth/login', $payload)->assertNotFound();
    }

    public function test_request_tenant_and_owner_ids_cannot_override_server_context(): void
    {
        $alpha = $this->tenant('context-alpha');
        $beta = $this->tenant('context-beta');
        $identity = $this->verifiedIdentity($alpha, 'owner-context@example.test');
        $other = $this->verifiedIdentity($beta, 'other-context@example.test');
        $token = $this->customerToken($identity);

        $this->postJson("/api/customer/v1/{$alpha->slug}/auth/login", [
            'email' => $identity->email,
            'password' => 'password123',
            'tenant_id' => $beta->id,
        ])->assertUnprocessable()->assertJsonValidationErrors(['tenant_id']);

        $this->withToken($token)
            ->getJson("/api/customer/v1/{$alpha->slug}/me?tenant_id={$beta->id}&customer_identity_id={$other->id}")
            ->assertOk()
            ->assertJsonPath('customer.id', $identity->id)
            ->assertJsonPath('partner_link.linked', false);

        $this->withToken($token)
            ->getJson("/api/customer/v1/{$beta->slug}/me")
            ->assertForbidden();
    }

    public function test_login_is_generic_for_invalid_unverified_and_inactive_identities(): void
    {
        $tenant = $this->tenant('login-states');
        $verified = $this->verifiedIdentity($tenant, 'verified@example.test');
        $unverified = $this->identity($tenant, 'unverified@example.test', verified: false);
        $inactive = $this->verifiedIdentity($tenant, 'inactive@example.test');
        $this->withTenant($tenant, fn () => $inactive->update(['is_active' => false]));

        $valid = $this->postJson("/api/customer/v1/{$tenant->slug}/auth/login", [
            'email' => $verified->email,
            'password' => 'password123',
        ])->assertOk();

        $wrong = $this->postJson("/api/customer/v1/{$tenant->slug}/auth/login", [
            'email' => $verified->email,
            'password' => 'not-the-password',
        ])->assertUnprocessable();
        $unknown = $this->postJson("/api/customer/v1/{$tenant->slug}/auth/login", [
            'email' => 'unknown@example.test',
            'password' => 'not-the-password',
        ])->assertUnprocessable();
        $pending = $this->postJson("/api/customer/v1/{$tenant->slug}/auth/login", [
            'email' => $unverified->email,
            'password' => 'password123',
        ])->assertUnprocessable();
        $disabled = $this->postJson("/api/customer/v1/{$tenant->slug}/auth/login", [
            'email' => $inactive->email,
            'password' => 'password123',
        ])->assertUnprocessable();

        $this->assertArrayHasKey('token', $valid->json());
        $this->assertSame($wrong->json(), $unknown->json());
        $this->assertSame($wrong->json(), $pending->json());
        $this->assertSame($wrong->json(), $disabled->json());
    }

    public function test_customer_token_expires_in_seven_days_me_is_safe_and_logout_revokes_current_token(): void
    {
        $tenant = $this->tenant('customer-session');
        $identity = $this->verifiedIdentity($tenant, 'session@example.test');

        $login = $this->postJson("/api/customer/v1/{$tenant->slug}/auth/login", [
            'email' => $identity->email,
            'password' => 'password123',
        ])->assertOk();
        $token = $login['token'];
        $storedToken = PersonalAccessToken::findToken($token);

        $this->assertNotNull($storedToken);
        $this->assertTrue($storedToken->can('customer:access'));
        $this->assertEqualsWithDelta(now()->addDays(7)->timestamp, $storedToken->expires_at->timestamp, 5);

        $this->withToken($token)->getJson("/api/customer/v1/{$tenant->slug}/me")
            ->assertOk()
            ->assertJsonPath('customer.id', $identity->id)
            ->assertJsonMissingPath('customer.tenant_id')
            ->assertJsonMissingPath('customer.password')
            ->assertJsonMissingPath('customer.email_normalized')
            ->assertJsonMissingPath('token');

        $this->withToken($token)->postJson("/api/customer/v1/{$tenant->slug}/auth/logout")->assertOk();
        $this->assertNull(PersonalAccessToken::findToken($token));
        $this->withToken($token)->getJson("/api/customer/v1/{$tenant->slug}/me")->assertUnauthorized();
    }

    public function test_partner_link_is_explicit_audited_and_supports_partner_one_to_many_identities(): void
    {
        [$tenant, $actor] = $this->tenantAndActor('partner-many');
        $partner = $this->partner($tenant, 'Shared Company');
        $first = $this->verifiedIdentity($tenant, 'first@company.test');
        $second = $this->verifiedIdentity($tenant, 'second@company.test');
        app(TenantContext::class)->set($tenant->id);
        $service = app(CustomerPartnerLinkService::class);

        $firstLink = $service->link($first, $partner, $actor);
        $secondLink = $service->link($second, $partner, $actor);

        $this->assertSame($actor->id, $firstLink->linked_by_user_id);
        $this->assertSame('staff_verified_claim', $firstLink->link_method);
        $this->assertSame($partner->id, $secondLink->partner_id);
        $this->assertSame(2, CustomerPartnerLink::where('partner_id', $partner->id)->count());
    }

    public function test_identity_has_only_one_active_link_and_revocation_removes_it_from_customer_context(): void
    {
        [$tenant, $actor] = $this->tenantAndActor('link-cardinality');
        $firstPartner = $this->partner($tenant, 'First Partner');
        $secondPartner = $this->partner($tenant, 'Second Partner');
        $identity = $this->verifiedIdentity($tenant, 'cardinality@example.test');
        app(TenantContext::class)->set($tenant->id);
        $service = app(CustomerPartnerLinkService::class);
        $firstLink = $service->link($identity, $firstPartner, $actor);
        $token = $this->customerToken($identity);

        try {
            $service->link($identity, $secondPartner, $actor);
            $this->fail('A second active Partner link must be rejected.');
        } catch (ValidationException) {
            $this->assertSame(1, CustomerPartnerLink::where('status', 'active')->count());
        }

        $this->withToken($token)->getJson("/api/customer/v1/{$tenant->slug}/me")
            ->assertOk()
            ->assertJsonPath('partner_link.partner_id', $firstPartner->id);

        app(TenantContext::class)->set($tenant->id);
        $service->revoke($firstLink, $actor);

        $this->withToken($token)->getJson("/api/customer/v1/{$tenant->slug}/me")
            ->assertOk()
            ->assertJsonPath('partner_link.linked', false)
            ->assertJsonPath('partner_link.partner_id', null);

        app(TenantContext::class)->set($tenant->id);
        $replacement = $service->link($identity, $secondPartner, $actor);
        $this->assertSame($secondPartner->id, $replacement->partner_id);
    }

    public function test_cross_tenant_and_ineligible_partner_links_are_rejected(): void
    {
        [$alpha, $actor] = $this->tenantAndActor('link-alpha');
        $beta = $this->tenant('link-beta');
        $identity = $this->verifiedIdentity($alpha, 'alpha-link@example.test');
        $foreignPartner = $this->partner($beta, 'Foreign Partner');
        $supplier = $this->partner($alpha, 'Supplier', 'supplier');
        $inactive = $this->partner($alpha, 'Inactive');
        $this->withTenant($alpha, fn () => $inactive->update(['is_active' => false]));
        app(TenantContext::class)->set($alpha->id);
        $service = app(CustomerPartnerLinkService::class);

        foreach ([$foreignPartner, $supplier, $inactive] as $partner) {
            try {
                $service->link($identity, $partner, $actor);
                $this->fail('Ineligible Partner link must be rejected.');
            } catch (ValidationException) {
                $this->assertSame(0, CustomerPartnerLink::withoutGlobalScopes()->count());
            }
        }
    }

    public function test_accountant_cannot_establish_customer_partner_link(): void
    {
        [$tenant] = $this->tenantAndActor('link-permission');
        $accountant = User::create([
            'tenant_id' => $tenant->id,
            'name' => 'Accountant',
            'email' => 'accountant@link-permission.test',
            'password' => 'password123',
            'role' => 'accountant',
            'is_active' => true,
        ]);
        $identity = $this->verifiedIdentity($tenant, 'permission@example.test');
        $partner = $this->partner($tenant, 'Permission Partner');
        app(TenantContext::class)->set($tenant->id);

        $this->expectException(ValidationException::class);
        app(CustomerPartnerLinkService::class)->link($identity, $partner, $accountant);
    }

    private function tenant(string $slug): Tenant
    {
        return Tenant::create([
            'name' => $slug,
            'slug' => $slug,
            'is_active' => true,
        ]);
    }

    /** @return array{Tenant,User} */
    private function tenantAndActor(string $slug): array
    {
        $tenant = $this->tenant($slug);
        $actor = User::create([
            'tenant_id' => $tenant->id,
            'name' => 'Authorized Staff',
            'email' => "staff@{$slug}.test",
            'password' => 'password123',
            'role' => 'owner',
            'is_active' => true,
        ]);

        return [$tenant, $actor];
    }

    private function verifiedIdentity(Tenant $tenant, string $email, string $password = 'password123'): CustomerIdentity
    {
        return $this->identity($tenant, $email, $password, true);
    }

    private function identity(
        Tenant $tenant,
        string $email,
        string $password = 'password123',
        bool $verified = true,
    ): CustomerIdentity {
        return $this->withTenant($tenant, fn () => CustomerIdentity::create([
            'tenant_id' => $tenant->id,
            'display_name' => 'Customer',
            'email' => $email,
            'password' => $password,
            'email_verified_at' => $verified ? now() : null,
            'is_active' => true,
        ]));
    }

    private function partner(Tenant $tenant, string $name, string $type = 'customer'): Partner
    {
        return $this->withTenant($tenant, fn () => Partner::create([
            'tenant_id' => $tenant->id,
            'name' => $name,
            'type' => $type,
            'is_active' => true,
        ]));
    }

    private function customerToken(CustomerIdentity $identity): string
    {
        return $identity->createToken('customer', ['customer:access'], now()->addDays(7))->plainTextToken;
    }

    private function withTenant(Tenant $tenant, callable $callback): mixed
    {
        $context = app(TenantContext::class);
        $context->set($tenant->id);

        try {
            return $callback();
        } finally {
            $context->forget();
        }
    }
}
