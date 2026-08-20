<?php

namespace Tests\Feature;

use App\Models\PlatformAdministrator;
use App\Models\PlatformAdministratorAction;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PlatformTenantManagementTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function administratorToken(array $abilities = ['platform:read', 'platform:manage']): string
    {
        $administrator = PlatformAdministrator::create([
            'name'     => 'مشغّل نبراس',
            'email'    => 'ops+' . uniqid() . '@nebrax.test',
            'password' => 'platform-password-123',
        ]);

        return $administrator->createToken('platform-console', $abilities)->plainTextToken;
    }

    /** @test */
    public function it_lists_tenants_with_contact_and_user_count(): void
    {
        $this->registerTenant('alpha', 'owner@alpha.test');
        $this->registerTenant('beta', 'owner@beta.test');
        $token = $this->administratorToken();

        $response = $this->withToken($token)
            ->getJson('/api/platform/tenants')
            ->assertOk()
            ->assertJsonPath('pagination.total', 2);

        $names = collect($response->json('data'))->pluck('slug')->all();
        $this->assertEqualsCanonicalizing(['alpha', 'beta'], $names);

        $alpha = collect($response->json('data'))->firstWhere('slug', 'alpha');
        $this->assertSame('owner@alpha.test', $alpha['contact']['email']);
        $this->assertSame(1, $alpha['users_count']);
    }

    /** @test */
    public function it_exposes_the_owner_phone_number_for_contact_purposes(): void
    {
        $this->postJson('/api/register', [
            'company_name' => 'شركة جوال',
            'slug'         => 'phoney',
            'vat_number'   => '300000000000003',
            'name'         => 'مالك الجوال',
            'email'        => 'owner@phoney.test',
            'phone'        => '0500000000',
            'password'     => 'password123',
        ])->assertCreated();
        $token = $this->administratorToken();

        $response = $this->withToken($token)->getJson('/api/platform/tenants')->assertOk();
        $tenant = collect($response->json('data'))->firstWhere('slug', 'phoney');
        $this->assertSame('0500000000', $tenant['contact']['phone']);
        $this->assertSame('مالك الجوال', $tenant['contact']['name']);
    }

    /** @test */
    public function it_searches_tenants_by_owner_email(): void
    {
        $this->registerTenant('alpha', 'owner@alpha.test');
        $this->registerTenant('beta', 'owner@beta.test');
        $token = $this->administratorToken();

        $this->withToken($token)
            ->getJson('/api/platform/tenants?search=owner@beta.test')
            ->assertOk()
            ->assertJsonPath('pagination.total', 1)
            ->assertJsonPath('data.0.slug', 'beta');
    }

    /** @test */
    public function it_shows_tenant_detail_with_subscription_history(): void
    {
        $tenant = $this->registerTenant('alpha', 'owner@alpha.test');
        $token = $this->administratorToken();

        $this->artisan('platform:subscription:record', [
            'tenant'          => 'alpha',
            '--plan'          => 'pro',
            '--monthly-minor' => '199000',
            '--starts-on'     => now()->toDateString(),
        ])->assertExitCode(0);

        $this->withToken($token)
            ->getJson("/api/platform/tenants/{$tenant['tenant_id']}")
            ->assertOk()
            ->assertJsonPath('data.slug', 'alpha')
            ->assertJsonPath('data.contact.email', 'owner@alpha.test')
            ->assertJsonPath('data.subscriptions.0.plan', 'pro')
            ->assertJsonPath('data.subscriptions.0.monthly_amount_minor', 199000);
    }

    /** @test */
    public function it_changes_a_tenant_plan_and_logs_the_action(): void
    {
        $tenant = $this->registerTenant('alpha', 'owner@alpha.test');
        $token = $this->administratorToken();

        $this->withToken($token)
            ->patchJson("/api/platform/tenants/{$tenant['tenant_id']}", ['plan' => 'pro'])
            ->assertOk()
            ->assertJsonPath('data.plan', 'pro');

        $this->assertDatabaseHas('tenants', ['id' => $tenant['tenant_id'], 'plan' => 'pro']);
        $this->assertDatabaseHas('platform_administrator_actions', [
            'tenant_id'  => $tenant['tenant_id'],
            'action'     => PlatformAdministratorAction::ACTION_PLAN_CHANGED,
            'from_value' => 'free',
            'to_value'   => 'pro',
        ]);
    }

    /** @test */
    public function it_extends_a_tenant_trial_and_logs_the_action(): void
    {
        $tenant = $this->registerTenant('alpha', 'owner@alpha.test');
        $token = $this->administratorToken();
        $newTrialEnd = now()->addDays(30)->toDateString();

        $this->withToken($token)
            ->patchJson("/api/platform/tenants/{$tenant['tenant_id']}", ['trial_ends_at' => $newTrialEnd])
            ->assertOk()
            ->assertJsonPath('data.trial_ends_at', $newTrialEnd);

        $this->assertDatabaseHas('platform_administrator_actions', [
            'tenant_id' => $tenant['tenant_id'],
            'action'    => PlatformAdministratorAction::ACTION_TRIAL_EXTENDED,
            'to_value'  => $newTrialEnd,
        ]);
    }

    /** @test */
    public function it_deactivates_and_reactivates_a_tenant_and_logs_both_actions(): void
    {
        $tenant = $this->registerTenant('alpha', 'owner@alpha.test');
        $token = $this->administratorToken();

        $this->withToken($token)
            ->patchJson("/api/platform/tenants/{$tenant['tenant_id']}", ['is_active' => false])
            ->assertOk()
            ->assertJsonPath('data.is_active', false);

        $this->assertDatabaseHas('platform_administrator_actions', [
            'tenant_id' => $tenant['tenant_id'],
            'action'    => PlatformAdministratorAction::ACTION_DEACTIVATED,
        ]);

        $this->withToken($token)
            ->patchJson("/api/platform/tenants/{$tenant['tenant_id']}", ['is_active' => true])
            ->assertOk()
            ->assertJsonPath('data.is_active', true);

        $this->assertDatabaseHas('platform_administrator_actions', [
            'tenant_id' => $tenant['tenant_id'],
            'action'    => PlatformAdministratorAction::ACTION_ACTIVATED,
        ]);
    }

    /** @test */
    public function it_rejects_an_unknown_plan(): void
    {
        $tenant = $this->registerTenant('alpha', 'owner@alpha.test');
        $token = $this->administratorToken();

        $this->withToken($token)
            ->patchJson("/api/platform/tenants/{$tenant['tenant_id']}", ['plan' => 'not-a-plan'])
            ->assertStatus(422);
    }

    /** @test */
    public function it_rejects_an_empty_update_payload(): void
    {
        $tenant = $this->registerTenant('alpha', 'owner@alpha.test');
        $token = $this->administratorToken();

        $this->withToken($token)
            ->patchJson("/api/platform/tenants/{$tenant['tenant_id']}", [])
            ->assertStatus(422);
    }

    /** @test */
    public function a_read_only_token_cannot_update_a_tenant(): void
    {
        $tenant = $this->registerTenant('alpha', 'owner@alpha.test');
        $readOnlyToken = $this->administratorToken(['platform:read']);

        $this->withToken($readOnlyToken)
            ->patchJson("/api/platform/tenants/{$tenant['tenant_id']}", ['plan' => 'pro'])
            ->assertForbidden();

        $this->withToken($readOnlyToken)
            ->getJson('/api/platform/tenants')
            ->assertOk();
    }

    /** @test */
    public function a_tenant_user_cannot_reach_platform_tenant_endpoints(): void
    {
        $tenant = $this->registerTenant('alpha', 'owner@alpha.test');

        $this->withToken($tenant['token'])
            ->getJson('/api/platform/tenants')
            ->assertForbidden();

        $this->withToken($tenant['token'])
            ->patchJson("/api/platform/tenants/{$tenant['tenant_id']}", ['plan' => 'pro'])
            ->assertForbidden();
    }
}
