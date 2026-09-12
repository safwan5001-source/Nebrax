<?php

namespace Tests\Feature;

use App\Models\Tenant;
use App\Tenancy\HostnameTenantContext;
use App\Tenancy\TenantContext;
use App\Tenancy\TenantHostnameResolver;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * حدود أمن النطاق الفرعي لمستأجر ERP: الحسم قبل الدخول، ورفض العبور بين المستأجرين.
 * تشغيل: php artisan test --filter=TenantSubdomainAuthTest
 */
class TenantSubdomainAuthTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function tenantUrl(string $slug, string $path): string
    {
        return "http://{$slug}.awj.app/api/{$path}";
    }

    private function forgetTenancy(): void
    {
        app(TenantContext::class)->forget();
        app(HostnameTenantContext::class)->forget();
    }

    /** @test */
    public function a_valid_slug_resolves_the_correct_tenant(): void
    {
        $a = $this->registerTenant('alnoor', 'owner@alnoor.test');
        $this->registerTenant('other', 'owner@other.test');
        $this->forgetTenancy();

        $id = app(TenantHostnameResolver::class)->tenantIdForSlug('alnoor');
        $this->assertSame($a['tenant_id'], $id);
        $this->assertFalse(app(TenantContext::class)->has());
    }

    /** @test */
    public function an_unknown_slug_fails_closed_without_falling_back(): void
    {
        $this->registerTenant('alnoor', 'owner@alnoor.test');
        $this->forgetTenancy();

        $this->postJson($this->tenantUrl('does-not-exist', 'login'), [
            'email' => 'owner@alnoor.test', 'password' => 'password123',
        ])->assertStatus(404)->assertJsonMissingPath('token');

        $this->assertFalse(app(TenantContext::class)->has());
        $this->assertFalse(app(HostnameTenantContext::class)->has());
    }

    /** @test */
    public function a_reserved_slug_cannot_be_registered(): void
    {
        $this->withoutMiddleware(\Illuminate\Routing\Middleware\ThrottleRequests::class);

        foreach (['www', 'api', 'app', 'admin', 'platform', 'support'] as $slug) {
            $this->postJson('/api/register', [
                'company_name' => 'محجوز',
                'slug'         => $slug,
                'name'         => 'مالك',
                'email'        => $slug.'@reserved.test',
                'password'     => 'password123',
            ])->assertStatus(422)->assertJsonValidationErrors(['slug']);
        }

        $this->postJson('/api/register', [
            'company_name' => 'نبراس',
            'slug'         => 'nibras',
            'name'         => 'المالك',
            'email'        => 'owner@nibras.test',
            'password'     => 'password123',
        ])->assertCreated()->assertJsonPath('tenant.slug', 'nibras');
    }

    /** @test */
    public function registration_still_rejects_duplicate_slugs(): void
    {
        $this->registerTenant('alnoor', 'owner@alnoor.test');

        $this->postJson('/api/register', [
            'company_name' => 'شركة ثانية',
            'slug'         => 'alnoor',
            'name'         => 'مالك',
            'email'        => 'other@alnoor.test',
            'password'     => 'password123',
        ])->assertStatus(422)->assertJsonValidationErrors(['slug']);
    }

    /** @test */
    public function a_malformed_hostname_cannot_establish_a_tenant(): void
    {
        $this->registerTenant('alnoor', 'owner@alnoor.test');
        $this->forgetTenancy();

        $this->assertNull(app(TenantHostnameResolver::class)->extractSlug('localhost'));
        $this->assertNull(app(TenantHostnameResolver::class)->extractSlug('shop..awj.app'));

        $this->postJson('/api/login', [
            'email' => 'owner@alnoor.test', 'password' => 'password123',
        ])->assertOk()->assertJsonStructure(['token']);

        $this->assertFalse(app(TenantContext::class)->has());
    }

    /** @test */
    public function tenant_a_user_can_authenticate_through_tenant_a_hostname(): void
    {
        $this->registerTenant('company-a', 'a@alpha.test');
        $this->forgetTenancy();

        $this->postJson($this->tenantUrl('company-a', 'login'), [
            'email' => 'a@alpha.test', 'password' => 'password123',
        ])->assertOk()->assertJsonPath('user.email', 'a@alpha.test');
    }

    /** @test */
    public function tenant_b_user_can_authenticate_through_tenant_b_hostname(): void
    {
        $this->registerTenant('company-a', 'a@alpha.test');
        $this->registerTenant('company-b', 'b@beta.test');
        $this->forgetTenancy();

        $this->postJson($this->tenantUrl('company-b', 'login'), [
            'email' => 'b@beta.test', 'password' => 'password123',
        ])->assertOk()->assertJsonPath('user.email', 'b@beta.test');
    }

    /** @test */
    public function tenant_b_credentials_are_rejected_through_tenant_a_hostname(): void
    {
        $this->registerTenant('company-a', 'a@alpha.test');
        $this->registerTenant('company-b', 'b@beta.test');
        $this->forgetTenancy();

        $res = $this->postJson($this->tenantUrl('company-a', 'login'), [
            'email' => 'b@beta.test', 'password' => 'password123',
        ]);

        $res->assertStatus(422)->assertJsonMissingPath('token');
        $this->assertFalse(app(TenantContext::class)->has());
        $this->assertFalse(app(HostnameTenantContext::class)->has());
        $this->assertSame('بيانات الدخول غير صحيحة.', $res->json('message'));
    }

    /** @test */
    public function failed_cross_tenant_login_does_not_establish_the_foreign_tenant_context(): void
    {
        $a = $this->registerTenant('company-a', 'a@alpha.test');
        $b = $this->registerTenant('company-b', 'b@beta.test');
        $this->forgetTenancy();

        $this->postJson($this->tenantUrl('company-a', 'login'), [
            'email' => 'b@beta.test', 'password' => 'password123',
        ])->assertStatus(422);

        $this->assertFalse(app(TenantContext::class)->has());
        $this->assertNotSame($b['tenant_id'], app(TenantContext::class)->id());
        $this->assertNotSame($a['tenant_id'], app(TenantContext::class)->id());

        $this->getJson($this->tenantUrl('company-a', 'partners'))->assertUnauthorized();
    }

    /** @test */
    public function an_unknown_hostname_cannot_authenticate_a_valid_user(): void
    {
        $this->registerTenant('alnoor', 'owner@alnoor.test');
        $this->forgetTenancy();

        $this->postJson($this->tenantUrl('missing-company', 'login'), [
            'email' => 'owner@alnoor.test', 'password' => 'password123',
        ])->assertStatus(404)->assertJsonMissingPath('token');
    }

    /** @test */
    public function existing_non_tenant_host_login_remains_available(): void
    {
        $this->registerTenant('alpha', 'a@x.test');
        $this->registerTenant('beta', 'b@x.test');
        $this->forgetTenancy();

        $res = $this->postJson('/api/login', [
            'email' => 'b@x.test', 'password' => 'password123',
        ])->assertOk();

        $this->withToken($res['token'])->getJson('/api/me')
            ->assertOk()
            ->assertJsonPath('user.email', 'b@x.test');
    }

    /** @test */
    public function browser_origin_on_the_api_host_is_the_tenant_boundary(): void
    {
        $this->registerTenant('company-a', 'a@alpha.test');
        $this->registerTenant('company-b', 'b@beta.test');
        $this->forgetTenancy();

        $this->postJson('/api/login', [
            'email' => 'a@alpha.test', 'password' => 'password123',
        ], ['Origin' => 'https://company-a.awj.app'])->assertOk();

        $this->postJson('/api/login', [
            'email' => 'b@beta.test', 'password' => 'password123',
        ], ['Origin' => 'https://company-a.awj.app'])->assertStatus(422)->assertJsonMissingPath('token');
    }

    /** @test */
    public function conflicting_host_and_origin_tenants_fail_closed(): void
    {
        $this->registerTenant('company-a', 'a@alpha.test');
        $this->registerTenant('company-b', 'b@beta.test');
        $this->forgetTenancy();

        $this->postJson($this->tenantUrl('company-a', 'login'), [
            'email' => 'a@alpha.test', 'password' => 'password123',
        ], ['Origin' => 'https://company-b.awj.app'])->assertStatus(404)->assertJsonMissingPath('token');
    }

    /** @test */
    public function a_client_supplied_tenant_header_cannot_override_the_hostname(): void
    {
        $this->registerTenant('company-a', 'a@alpha.test');
        $b = $this->registerTenant('company-b', 'b@beta.test');
        $this->forgetTenancy();

        $this->postJson($this->tenantUrl('company-a', 'login'), [
            'email' => 'b@beta.test',
            'password' => 'password123',
            'tenant_id' => $b['tenant_id'],
            'slug' => 'company-b',
        ], ['X-Tenant-Slug' => 'company-b', 'X-Tenant-ID' => $b['tenant_id']])
            ->assertStatus(422)
            ->assertJsonMissingPath('token');
    }

    /** @test */
    public function hostname_manipulation_cannot_expose_another_tenants_protected_data(): void
    {
        $a = $this->registerTenant('company-a', 'a@alpha.test');
        $b = $this->registerTenant('company-b', 'b@beta.test');

        $partnerA = $this->withToken($a['token'])->postJson('/api/partners', [
            'name' => 'عميل ألفا السري', 'type' => 'customer',
        ])->assertCreated()['data']['id'];

        $partnerB = $this->withToken($b['token'])->postJson('/api/partners', [
            'name' => 'عميل بيتا السري', 'type' => 'customer',
        ])->assertCreated()['data']['id'];

        $this->forgetTenancy();

        $denied = $this->withToken($b['token'])->getJson($this->tenantUrl('company-a', 'partners'));
        $denied->assertStatus(403);
        $this->assertStringNotContainsString('عميل ألفا السري', $denied->getContent());
        $this->assertStringNotContainsString('عميل بيتا السري', $denied->getContent());
        $this->assertFalse(app(TenantContext::class)->has());

        $this->withToken($b['token'])
            ->getJson($this->tenantUrl('company-a', "partners/{$partnerA}"))
            ->assertStatus(403);

        $this->withToken($a['token'])
            ->getJson($this->tenantUrl('company-b', "partners/{$partnerB}"))
            ->assertStatus(403);

        $this->withToken($a['token'])
            ->getJson($this->tenantUrl('does-not-exist', 'partners'))
            ->assertStatus(404);

        $visible = $this->withToken($a['token'])->getJson($this->tenantUrl('company-a', 'partners'))->assertOk();
        $this->assertSame('عميل ألفا السري', $visible['data'][0]['name']);
        $this->assertCount(1, $visible['data']);
    }

    /** @test */
    public function an_inactive_tenant_subdomain_fails_closed(): void
    {
        $auth = $this->registerTenant('dormant', 'owner@dormant.test');
        Tenant::query()->whereKey($auth['tenant_id'])->update(['is_active' => false]);
        $this->forgetTenancy();

        $this->postJson($this->tenantUrl('dormant', 'login'), [
            'email' => 'owner@dormant.test', 'password' => 'password123',
        ])->assertStatus(404)->assertJsonMissingPath('token');
    }
}
