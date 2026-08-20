<?php

namespace Tests\Feature;

use App\Models\PlatformAdministrator;
use App\Models\PlatformSubscription;
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
    public function platform_overview_aggregates_active_subscription_metrics_without_tenant_details(): void
    {
        $alpha = $this->registerTenant('alpha', 'owner@alpha.test');
        $beta = $this->registerTenant('beta', 'owner@beta.test');
        $trial = $this->registerTenant('trial', 'owner@trial.test');

        PlatformSubscription::create([
            'tenant_id'      => $alpha['tenant_id'],
            'plan'           => 'pro',
            'status'         => PlatformSubscription::STATUS_ACTIVE,
            'monthly_amount' => 199000,
            'starts_on'      => now()->subDay()->toDateString(),
            'ends_on'        => now()->addDays(14)->toDateString(),
        ]);
        PlatformSubscription::create([
            'tenant_id'      => $beta['tenant_id'],
            'plan'           => 'basic',
            'status'         => PlatformSubscription::STATUS_ACTIVE,
            'monthly_amount' => 99000,
            'starts_on'      => now()->subDay()->toDateString(),
        ]);
        PlatformSubscription::create([
            'tenant_id'      => $trial['tenant_id'],
            'plan'           => 'pro',
            'status'         => PlatformSubscription::STATUS_TRIAL,
            'monthly_amount' => 0,
            'starts_on'      => now()->subDay()->toDateString(),
            'ends_on'        => now()->addDays(7)->toDateString(),
        ]);

        $administrator = PlatformAdministrator::create([
            'name'     => 'مشغّل نبراس',
            'email'    => 'ops@nebrax.test',
            'password' => 'platform-password-123',
        ]);
        $token = $administrator->createToken('platform-console', ['platform:read'])->plainTextToken;

        $this->withToken($token)
            ->getJson('/api/platform/overview')
            ->assertOk()
            ->assertJsonPath('data.subscriptions.active', 2)
            ->assertJsonPath('data.subscriptions.trials', 1)
            ->assertJsonPath('data.subscriptions.renewals_next_30_days', 1)
            ->assertJsonPath('data.subscriptions.monthly_recurring_revenue_minor', 298000)
            ->assertJsonPath('data.subscriptions.monthly_recurring_revenue', '2980.00')
            ->assertJsonPath('data.subscriptions.renewal_value_at_risk_minor', 199000)
            ->assertJsonPath('data.subscriptions.by_plan.0.plan', 'basic')
            ->assertJsonPath('data.subscriptions.by_plan.0.active', 1)
            ->assertJsonPath('data.subscriptions.by_plan.1.plan', 'pro')
            ->assertJsonPath('data.subscriptions.by_plan.1.monthly_recurring_revenue_minor', 199000)
            ->assertJsonMissingPath('data.subscriptions.tenants');
    }

    /** @test */
    public function platform_subscription_command_records_an_active_contract_and_rejects_an_overlap(): void
    {
        $tenant = $this->registerTenant('contract', 'owner@contract.test');

        $this->artisan('platform:subscription:record', [
            'tenant'          => 'contract',
            '--plan'          => 'pro',
            '--monthly-minor' => '199000',
            '--starts-on'     => now()->toDateString(),
            '--reference'     => 'contract-001',
        ])->assertExitCode(0);

        $this->assertDatabaseHas('platform_subscriptions', [
            'tenant_id'      => $tenant['tenant_id'],
            'plan'           => 'pro',
            'status'         => PlatformSubscription::STATUS_ACTIVE,
            'monthly_amount' => 199000,
        ]);

        $this->artisan('platform:subscription:record', [
            'tenant'          => 'contract',
            '--plan'          => 'basic',
            '--monthly-minor' => '99000',
            '--starts-on'     => now()->toDateString(),
            '--reference'     => 'contract-002',
        ])->assertExitCode(1);
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
