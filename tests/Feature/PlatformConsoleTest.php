<?php

namespace Tests\Feature;

use App\Models\PlatformAdministrator;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PlatformConsoleTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function platform_overview_returns_aggregate_tenant_and_user_counts_to_a_platform_administrator(): void
    {
        $this->registerTenant('alpha', 'owner@alpha.test');
        $this->registerTenant('beta', 'owner@beta.test');

        $administrator = PlatformAdministrator::create([
            'name'     => 'مشغّل نبراس',
            'email'    => 'ops@nebrax.test',
            'password' => 'platform-password-123',
        ]);
        $token = $administrator->createToken('platform-console', ['platform:read'])->plainTextToken;

        $this->withToken($token)
            ->getJson('/api/platform/overview')
            ->assertOk()
            ->assertJsonPath('data.tenants.total', 2)
            ->assertJsonPath('data.tenants.active', 2)
            ->assertJsonPath('data.tenants.inactive', 0)
            ->assertJsonPath('data.users.total', 2)
            ->assertJsonPath('data.users.active', 2)
            ->assertJsonPath('data.users.inactive', 0)
            ->assertJsonMissingPath('data.tenants.items')
            ->assertJsonMissingPath('data.users.items');
    }

    /** @test */
    public function a_tenant_user_cannot_access_platform_overview(): void
    {
        $tenant = $this->registerTenant('alpha', 'owner@alpha.test');

        $this->withToken($tenant['token'])
            ->getJson('/api/platform/overview')
            ->assertForbidden();
    }

    /** @test */
    public function platform_overview_requires_a_platform_administrator_token(): void
    {
        $this->getJson('/api/platform/overview')->assertUnauthorized();
    }

    /** @test */
    public function platform_administrator_login_issues_a_read_only_platform_token(): void
    {
        PlatformAdministrator::create([
            'name'     => 'مشغّل نبراس',
            'email'    => 'ops@nebrax.test',
            'password' => 'platform-password-123',
        ]);

        $response = $this->postJson('/api/platform/login', [
            'email'    => 'ops@nebrax.test',
            'password' => 'platform-password-123',
        ])->assertOk()
            ->assertJsonPath('administrator.email', 'ops@nebrax.test')
            ->assertJsonStructure(['token', 'administrator' => ['id', 'name', 'email']]);

        $this->withToken($response['token'])
            ->getJson('/api/platform/overview')
            ->assertOk();
    }

    /** @test */
    public function inactive_platform_administrator_cannot_log_in_or_access_overview(): void
    {
        $administrator = PlatformAdministrator::create([
            'name'      => 'موقوف',
            'email'     => 'inactive@nebrax.test',
            'password'  => 'platform-password-123',
            'is_active' => false,
        ]);
        $token = $administrator->createToken('platform-console', ['platform:read'])->plainTextToken;

        $this->postJson('/api/platform/login', [
            'email'    => 'inactive@nebrax.test',
            'password' => 'platform-password-123',
        ])->assertForbidden();

        $this->withToken($token)
            ->getJson('/api/platform/overview')
            ->assertForbidden();
    }
}
