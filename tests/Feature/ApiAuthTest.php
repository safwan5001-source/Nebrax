<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبارات المصادقة عبر Sanctum: تسجيل، دخول، المستخدم الحالي، خروج.
 * تشغيل:  php artisan test --filter=ApiAuthTest
 */
class ApiAuthTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function the_health_endpoint_is_public_and_ok(): void
    {
        $this->getJson('/api/health')->assertOk()->assertJson(['status' => 'ok']);
    }

    /** @test */
    public function register_creates_a_tenant_and_returns_a_token(): void
    {
        $res = $this->postJson('/api/register', [
            'company_name' => 'نبراس',
            'slug'         => 'nibras',
            'vat_number'   => '300000000000003',
            'name'         => 'المالك',
            'email'        => 'owner@nibras.test',
            'password'     => 'password123',
        ]);

        $res->assertCreated()
            ->assertJsonStructure(['token', 'user' => ['id', 'email', 'role'], 'tenant' => ['id', 'slug']]);
        $this->assertSame('owner', $res['user']['role']);
    }

    /** @test */
    public function login_returns_a_token_for_valid_credentials(): void
    {
        $this->registerTenant('nibras', 'owner@nibras.test');

        $this->postJson('/api/login', [
            'email' => 'owner@nibras.test', 'password' => 'password123',
        ])->assertOk()->assertJsonStructure(['token', 'user']);
    }

    /** @test */
    public function login_works_by_email_only_and_resolves_the_tenant(): void
    {
        $this->registerTenant('alpha', 'a@x.test');
        $this->registerTenant('beta', 'b@x.test');

        // الدخول بالبريد وحده (بلا معرّف) يجد المستأجر الصحيح
        $res = $this->postJson('/api/login', ['email' => 'b@x.test', 'password' => 'password123'])
            ->assertOk()->assertJsonStructure(['token', 'user']);

        $this->withToken($res['token'])->getJson('/api/me')
            ->assertOk()->assertJsonPath('user.email', 'b@x.test');
    }

    /** @test */
    public function registration_rejects_a_duplicate_email_across_tenants(): void
    {
        $this->registerTenant('alpha', 'dup@x.test');

        $this->postJson('/api/register', [
            'company_name' => 'شركة ثانية', 'slug' => 'beta', 'name' => 'مالك',
            'email' => 'dup@x.test', 'password' => 'password123',
        ])->assertStatus(422)->assertJsonValidationErrors(['email']);
    }

    /** @test */
    public function login_fails_with_wrong_password(): void
    {
        $this->registerTenant('nibras', 'owner@nibras.test');

        $this->postJson('/api/login', [
            'email' => 'owner@nibras.test', 'password' => 'wrong',
        ])->assertStatus(422);
    }

    /** @test */
    public function me_requires_authentication(): void
    {
        $this->getJson('/api/me')->assertUnauthorized(); // 401
    }

    /** @test */
    public function me_returns_the_current_user_when_authenticated(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])->getJson('/api/me')
            ->assertOk()
            ->assertJsonPath('user.tenant_id', $auth['tenant_id']);
    }

    /** @test */
    public function me_includes_company_seller_info_for_documents(): void
    {
        $auth = $this->registerTenant('acme', 'owner@acme.test');

        $this->withToken($auth['token'])->getJson('/api/me')
            ->assertOk()
            ->assertJsonPath('company.name', 'شركة acme')
            ->assertJsonPath('company.vat_number', '300000000000003');
    }

    /** @test */
    public function logout_revokes_the_token(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])->postJson('/api/logout')->assertOk();
        $this->withToken($auth['token'])->getJson('/api/me')->assertUnauthorized();
    }
}
