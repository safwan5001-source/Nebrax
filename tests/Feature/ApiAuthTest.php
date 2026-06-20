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
            'slug' => 'nibras', 'email' => 'owner@nibras.test', 'password' => 'password123',
        ])->assertOk()->assertJsonStructure(['token', 'user']);
    }

    /** @test */
    public function login_fails_with_wrong_password(): void
    {
        $this->registerTenant('nibras', 'owner@nibras.test');

        $this->postJson('/api/login', [
            'slug' => 'nibras', 'email' => 'owner@nibras.test', 'password' => 'wrong',
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
    public function logout_revokes_the_token(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])->postJson('/api/logout')->assertOk();
        $this->withToken($auth['token'])->getJson('/api/me')->assertUnauthorized();
    }
}
