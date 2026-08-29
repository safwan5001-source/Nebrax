<?php

namespace Tests\Feature;

use App\Models\CommercialPlanVersion;
use App\Models\CommercialProduct;
use App\Models\CommercialProductVersion;
use App\Models\JournalEntry;
use App\Models\PlatformAdministrator;
use App\Models\PlatformAdministratorAction;
use App\Models\Tenant;
use App\Models\TenantApplicationEntitlement;
use App\Models\TenantApplicationState;
use App\Services\CommercialPlanVersionService;
use App\Services\CommercialProductVersionService;
use App\Services\PlatformApplicationOverrideService;
use App\Services\PlatformGlobalApplicationOverrideService;
use App\Services\TenantApplicationService;
use App\Support\ApplicationCatalog;
use App\Support\EntitlementSourceType;
use App\Support\TenantApplicationEntitlementDecision;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\TenantApplicationEntitlementResolver;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PlatformGlobalApplicationOverrideTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const COMMERCIAL_KEY = 'document_center.core';

    /** @return array{administrator: PlatformAdministrator, token: string} */
    private function platformAdministrator(array $abilities = ['platform:read', 'platform:manage']): array
    {
        $administrator = PlatformAdministrator::create([
            'name' => 'مدير التحكم العام',
            'email' => 'global-override+' . uniqid() . '@nebrax.test',
            'password' => 'platform-password-123',
        ]);

        return [
            'administrator' => $administrator,
            'token' => $administrator->createToken('global-overrides', $abilities)->plainTextToken,
        ];
    }

    /** @param  array<string, mixed>  $payload */
    private function globalPreview(string $token, array $payload): \Illuminate\Testing\TestResponse
    {
        return $this->withToken($token)
            ->postJson('/api/platform/application-overrides/global/preview', $payload);
    }

    /** @param  array<string, mixed>  $payload */
    private function globalApply(string $token, array $payload): \Illuminate\Testing\TestResponse
    {
        $preview = $this->globalPreview($token, $payload)->assertOk();

        return $this->withToken($token)
            ->postJson('/api/platform/application-overrides/global/apply', array_merge($payload, [
                'confirmation_token' => $preview->json('data.confirmation_token'),
            ]));
    }

    /** @return array{tenant_id: string} */
    private function registerIsolatedTenant(string $slug, bool $autoEnableApplications = false): array
    {
        return $this->registerTenant(
            $slug,
            $slug . '+' . uniqid('', true) . '@nebrax.test',
            autoEnableApplications: $autoEnableApplications,
        );
    }

    /** @return array{CommercialPlanVersion, CommercialProductVersion} */
    private function publishedPlan(string $planCode, array $capabilities): array
    {
        $product = CommercialProduct::create(['code' => 'product-' . $planCode, 'name' => 'منتج ' . $planCode]);
        $productVersion = CommercialProductVersion::create(['commercial_product_id' => $product->id, 'version' => 1]);
        $products = app(CommercialProductVersionService::class);
        $products->setCapabilities($productVersion, $capabilities);
        $products->publish($productVersion);

        $plan = CommercialPlanVersion::create(['plan_code' => $planCode, 'version' => 1]);
        $plans = app(CommercialPlanVersionService::class);
        $plans->setProducts($plan, [$productVersion]);

        return [$plans->publish($plan), $productVersion];
    }

    /** @test */
    public function global_summary_lists_applications_with_aggregate_flags(): void
    {
        $tenantA = $this->registerIsolatedTenant('global-summary-a', autoEnableApplications: false);
        $tenantB = $this->registerIsolatedTenant('global-summary-b', autoEnableApplications: false);
        $platform = $this->platformAdministrator();

        $this->withToken($platform['token'])
            ->postJson("/api/platform/tenants/{$tenantA['tenant_id']}/application-overrides/grant", [
                'application_key' => self::COMMERCIAL_KEY,
            ])
            ->assertOk();

        $response = $this->withToken($platform['token'])
            ->getJson('/api/platform/application-overrides/global/summary')
            ->assertOk();

        $entry = collect($response->json('data.applications'))->firstWhere('key', self::COMMERCIAL_KEY);
        $this->assertNotNull($entry);
        $this->assertSame(1, $entry['global_commercial']['granted']);
        $this->assertGreaterThanOrEqual(2, $response->json('data.tenant_count'));
        $this->assertTrue($entry['can_revert_all_tenants']);
    }

    /** @test */
    public function global_grant_all_tenants_creates_administrative_override_only(): void
    {
        $tenantA = $this->registerIsolatedTenant('global-grant-a', autoEnableApplications: false);
        $tenantB = $this->registerIsolatedTenant('global-grant-b', autoEnableApplications: false);
        $platform = $this->platformAdministrator();
        $journalBefore = JournalEntry::count();

        $preview = $this->globalPreview($platform['token'], [
            'operation' => PlatformGlobalApplicationOverrideService::GLOBAL_GRANT_ALL_TENANTS,
            'application_key' => self::COMMERCIAL_KEY,
            'tenant_ids' => [$tenantA['tenant_id'], $tenantB['tenant_id']],
        ])->assertOk();

        $this->assertSame(2, $preview->json('data.counts.will_apply'));
        $this->assertNotEmpty($preview->json('data.confirmation_token'));
        $this->assertSame(0, TenantApplicationEntitlement::withoutGlobalScopes()->count());

        $apply = $this->globalApply($platform['token'], [
            'operation' => PlatformGlobalApplicationOverrideService::GLOBAL_GRANT_ALL_TENANTS,
            'application_key' => self::COMMERCIAL_KEY,
            'tenant_ids' => [$tenantA['tenant_id'], $tenantB['tenant_id']],
            'reason' => 'منح عام',
        ])
            ->assertOk()
            ->assertJsonPath('data.counts.will_apply', 2);

        $this->assertSame(2, TenantApplicationEntitlement::withoutGlobalScopes()
            ->where('source_type', EntitlementSourceType::ADMINISTRATIVE_OVERRIDE->value)
            ->count());
        $this->assertSame($journalBefore, JournalEntry::count());
        $this->assertSame(1, PlatformAdministratorAction::query()
            ->whereNull('tenant_id')
            ->where('action', PlatformAdministratorAction::ACTION_APPLICATION_GLOBAL_BULK)
            ->count());
        $this->assertSame(0, PlatformAdministratorAction::query()
            ->where('action', PlatformAdministratorAction::ACTION_APPLICATION_GRANTED)
            ->count());
    }

    /** @test */
    public function global_revert_all_tenants_preserves_plan_grant(): void
    {
        $tenant = $this->registerIsolatedTenant('global-revert-plan', autoEnableApplications: false);
        [$plan] = $this->publishedPlan('global-revert-plan', [self::COMMERCIAL_KEY]);
        $platform = $this->platformAdministrator();

        $this->withToken($platform['token'])
            ->postJson("/api/platform/tenants/{$tenant['tenant_id']}/commercial-assignments/plan", [
                'version_id' => $plan->id,
                'starts_at' => '2026-08-23T00:00:00Z',
            ])
            ->assertCreated();

        $planGrant = TenantApplicationEntitlement::withoutGlobalScopes()
            ->where('source_type', EntitlementSourceType::PLAN->value)
            ->sole();

        $this->globalApply($platform['token'], [
            'operation' => PlatformGlobalApplicationOverrideService::GLOBAL_GRANT_ALL_TENANTS,
            'application_key' => self::COMMERCIAL_KEY,
            'tenant_ids' => [$tenant['tenant_id']],
        ])->assertOk();

        $overrideGrant = TenantApplicationEntitlement::withoutGlobalScopes()
            ->where('source_type', EntitlementSourceType::ADMINISTRATIVE_OVERRIDE->value)
            ->sole();

        $this->globalApply($platform['token'], [
            'operation' => PlatformGlobalApplicationOverrideService::GLOBAL_REVERT_ALL_TENANTS,
            'application_key' => self::COMMERCIAL_KEY,
            'tenant_ids' => [$tenant['tenant_id']],
        ])
            ->assertOk()
            ->assertJsonPath('data.counts.will_apply', 1);

        $this->assertNotNull($overrideGrant->fresh()->revoked_at);
        $this->assertNull($planGrant->fresh()->revoked_at);

        app(TenantContext::class)->set($tenant['tenant_id']);
        $this->assertSame(
            TenantApplicationEntitlementDecision::FULL,
            app(TenantApplicationEntitlementResolver::class)->resolve(
                Tenant::findOrFail($tenant['tenant_id']),
                self::COMMERCIAL_KEY,
                now('UTC'),
            ),
        );
    }

    /** @test */
    public function global_show_all_tenants_enables_operational_state(): void
    {
        $tenantA = $this->registerIsolatedTenant('global-show-a', autoEnableApplications: false);
        $tenantB = $this->registerIsolatedTenant('global-show-b', autoEnableApplications: false);
        $platform = $this->platformAdministrator();

        $this->globalApply($platform['token'], [
            'operation' => PlatformGlobalApplicationOverrideService::GLOBAL_SHOW_ALL_TENANTS,
            'application_key' => 'hr.employees',
            'tenant_ids' => [$tenantA['tenant_id'], $tenantB['tenant_id']],
        ])
            ->assertOk()
            ->assertJsonPath('data.counts.will_apply', 2);

        app(TenantContext::class)->set($tenantA['tenant_id']);
        $this->assertSame('enabled', app(TenantApplicationService::class)->statusFor('hr.employees'));
        app(TenantContext::class)->set($tenantB['tenant_id']);
        $this->assertSame('enabled', app(TenantApplicationService::class)->statusFor('hr.employees'));
    }

    /** @test */
    public function global_hide_all_tenants_respects_mandatory_block(): void
    {
        $tenant = $this->registerIsolatedTenant('global-hide-mandatory');
        $platform = $this->platformAdministrator();

        $preview = $this->withToken($platform['token'])
            ->postJson('/api/platform/application-overrides/global/preview', [
                'operation' => PlatformGlobalApplicationOverrideService::GLOBAL_HIDE_ALL_TENANTS,
                'application_key' => 'sales.invoicing',
                'tenant_ids' => [$tenant['tenant_id']],
            ])
            ->assertOk();

        $this->assertSame(0, $preview->json('data.counts.will_apply'));
        $this->assertGreaterThan(0, $preview->json('data.counts.skipped'));
    }

    /** @test */
    public function global_all_apps_show_all_tenants_uses_bulk_semantics(): void
    {
        $tenant = $this->registerIsolatedTenant('global-all-apps', autoEnableApplications: false);
        $platform = $this->platformAdministrator();

        $this->globalApply($platform['token'], [
            'operation' => PlatformGlobalApplicationOverrideService::GLOBAL_SHOW_ALL_APPS_ALL_TENANTS,
            'tenant_ids' => [$tenant['tenant_id']],
        ])
            ->assertOk()
            ->assertJsonPath('data.counts.will_apply', 1);

        app(TenantContext::class)->set($tenant['tenant_id']);
        $this->assertSame('enabled', app(TenantApplicationService::class)->statusFor('hr.employees'));
        $this->assertSame('enabled', app(TenantApplicationService::class)->statusFor('inventory.core'));
    }

    /** @test */
    public function idempotent_global_grant_marks_repeat_as_skipped_not_failed(): void
    {
        $tenant = $this->registerIsolatedTenant('global-idempotent', autoEnableApplications: false);
        $platform = $this->platformAdministrator();

        $this->globalApply($platform['token'], [
            'operation' => PlatformGlobalApplicationOverrideService::GLOBAL_GRANT_ALL_TENANTS,
            'application_key' => self::COMMERCIAL_KEY,
            'tenant_ids' => [$tenant['tenant_id']],
        ])->assertOk();

        $repeat = $this->globalApply($platform['token'], [
            'operation' => PlatformGlobalApplicationOverrideService::GLOBAL_GRANT_ALL_TENANTS,
            'application_key' => self::COMMERCIAL_KEY,
            'tenant_ids' => [$tenant['tenant_id']],
        ])
            ->assertOk();

        $this->assertSame(0, $repeat->json('data.counts.will_apply'));
        $this->assertSame(1, $repeat->json('data.counts.skipped'));
        $this->assertSame(0, $repeat->json('data.counts.failed'));
        $this->assertSame(1, TenantApplicationEntitlement::withoutGlobalScopes()
            ->where('source_type', EntitlementSourceType::ADMINISTRATIVE_OVERRIDE->value)
            ->count());
    }

    /** @test */
    public function global_preview_is_read_only(): void
    {
        $tenant = $this->registerIsolatedTenant('global-preview-readonly', autoEnableApplications: false);
        $platform = $this->platformAdministrator();

        $this->withToken($platform['token'])
            ->postJson('/api/platform/application-overrides/global/preview', [
                'operation' => PlatformGlobalApplicationOverrideService::GLOBAL_GRANT_ALL_TENANTS,
                'application_key' => self::COMMERCIAL_KEY,
                'tenant_ids' => [$tenant['tenant_id']],
            ])
            ->assertOk();

        $this->assertSame(0, TenantApplicationEntitlement::withoutGlobalScopes()->count());
        $this->assertSame(0, PlatformAdministratorAction::count());
    }

    /** @test */
    public function global_routes_require_platform_manage(): void
    {
        $readOnly = $this->platformAdministrator(['platform:read']);

        $this->withToken($readOnly['token'])
            ->getJson('/api/platform/application-overrides/global/summary')
            ->assertForbidden();

        $this->withToken($readOnly['token'])
            ->postJson('/api/platform/application-overrides/global/preview', [
                'operation' => PlatformGlobalApplicationOverrideService::GLOBAL_SHOW_ALL_TENANTS,
                'application_key' => 'hr.employees',
            ])
            ->assertForbidden();
    }

    /** @test */
    public function global_apply_isolates_tenant_changes(): void
    {
        $tenantA = $this->registerIsolatedTenant('global-isolation-a', autoEnableApplications: false);
        $tenantB = $this->registerIsolatedTenant('global-isolation-b', autoEnableApplications: false);
        $platform = $this->platformAdministrator();

        $this->globalApply($platform['token'], [
            'operation' => PlatformGlobalApplicationOverrideService::GLOBAL_SHOW_ALL_TENANTS,
            'application_key' => 'hr.employees',
            'tenant_ids' => [$tenantA['tenant_id']],
        ])->assertOk();

        app(TenantContext::class)->set($tenantA['tenant_id']);
        $this->assertSame('enabled', app(TenantApplicationService::class)->statusFor('hr.employees'));
        app(TenantContext::class)->set($tenantB['tenant_id']);
        $this->assertSame('disabled', app(TenantApplicationService::class)->statusFor('hr.employees'));
    }

    /** @test */
    public function global_coming_soon_grant_is_skipped(): void
    {
        $tenant = $this->registerIsolatedTenant('global-coming-soon', autoEnableApplications: false);
        $platform = $this->platformAdministrator();

        $response = $this->withToken($platform['token'])
            ->postJson('/api/platform/application-overrides/global/preview', [
                'operation' => PlatformGlobalApplicationOverrideService::GLOBAL_GRANT_ALL_TENANTS,
                'application_key' => 'sales.promotions',
                'tenant_ids' => [$tenant['tenant_id']],
            ])
            ->assertOk();

        $this->assertSame(0, $response->json('data.counts.will_apply'));
        $this->assertArrayHasKey('القدرة غير مبنية بعد.', $response->json('data.skip_reasons'));
    }

    /** @test */
    public function global_suspended_dependent_blocks_parent_hide(): void
    {
        $tenant = $this->registerIsolatedTenant('global-suspended-dep', autoEnableApplications: false);
        $platform = $this->platformAdministrator();

        $this->withToken($platform['token'])
            ->postJson("/api/platform/tenants/{$tenant['tenant_id']}/application-overrides/show", [
                'application_key' => 'fuel_stations.core',
            ])
            ->assertOk();

        $this->withToken($platform['token'])
            ->postJson("/api/platform/tenants/{$tenant['tenant_id']}/application-overrides/show", [
                'application_key' => 'fuel_stations.avi',
            ])
            ->assertOk();

        TenantApplicationState::query()->where('application_key', 'fuel_stations.avi')->update([
            'requested_enabled' => false,
            'status' => 'suspended',
        ]);

        $response = $this->withToken($platform['token'])
            ->postJson('/api/platform/application-overrides/global/preview', [
                'operation' => PlatformGlobalApplicationOverrideService::GLOBAL_HIDE_ALL_TENANTS,
                'application_key' => 'fuel_stations.core',
                'tenant_ids' => [$tenant['tenant_id']],
            ])
            ->assertOk();

        $this->assertSame(0, $response->json('data.counts.will_apply'));
    }

    /** @test */
    public function global_partial_success_applies_some_tenants_and_skips_others(): void
    {
        $tenantReady = $this->registerIsolatedTenant('global-partial-ready', autoEnableApplications: false);
        $tenantGranted = $this->registerIsolatedTenant('global-partial-granted', autoEnableApplications: false);
        $platform = $this->platformAdministrator();

        $this->withToken($platform['token'])
            ->postJson("/api/platform/tenants/{$tenantGranted['tenant_id']}/application-overrides/grant", [
                'application_key' => self::COMMERCIAL_KEY,
            ])
            ->assertOk();

        $response = $this->globalApply($platform['token'], [
            'operation' => PlatformGlobalApplicationOverrideService::GLOBAL_GRANT_ALL_TENANTS,
            'application_key' => self::COMMERCIAL_KEY,
            'tenant_ids' => [$tenantReady['tenant_id'], $tenantGranted['tenant_id']],
        ])
            ->assertOk();

        $this->assertSame(1, $response->json('data.counts.will_apply'));
        $this->assertSame(1, $response->json('data.counts.skipped'));
        $this->assertSame(0, $response->json('data.counts.failed'));
    }

    /** @test */
    public function global_audit_summary_is_single_row_without_per_tenant_duplicates(): void
    {
        $tenantA = $this->registerIsolatedTenant('global-audit-a', autoEnableApplications: false);
        $tenantB = $this->registerIsolatedTenant('global-audit-b', autoEnableApplications: false);
        $platform = $this->platformAdministrator();

        $this->globalApply($platform['token'], [
            'operation' => PlatformGlobalApplicationOverrideService::GLOBAL_SHOW_ALL_TENANTS,
            'application_key' => 'hr.employees',
            'tenant_ids' => [$tenantA['tenant_id'], $tenantB['tenant_id']],
        ])->assertOk();

        $this->assertSame(1, PlatformAdministratorAction::query()
            ->where('action', PlatformAdministratorAction::ACTION_APPLICATION_GLOBAL_BULK)
            ->count());
        $this->assertSame(0, PlatformAdministratorAction::query()
            ->where('action', PlatformAdministratorAction::ACTION_APPLICATION_SHOWN)
            ->count());
        $this->assertSame(0, PlatformAdministratorAction::query()
            ->where('action', PlatformAdministratorAction::ACTION_APPLICATION_BULK)
            ->count());

        $audit = PlatformAdministratorAction::query()
            ->where('action', PlatformAdministratorAction::ACTION_APPLICATION_GLOBAL_BULK)
            ->sole();
        $payload = json_decode((string) $audit->to_value, true);
        $this->assertSame('platform_global_override', $payload['source']);
        $this->assertSame(2, $payload['applied']);
    }

    /** @test */
    public function grandfathered_tenant_is_eligible_for_global_show_with_relaxed_dependencies(): void
    {
        $legacy = $this->legacyTenantForGlobalOverrides();
        $newTenant = $this->registerIsolatedTenant('global-new-deps', autoEnableApplications: false);
        $platform = $this->platformAdministrator();

        app(TenantContext::class)->set($legacy['tenant_id']);
        TenantApplicationState::query()->create([
            'application_key' => 'fuel_stations.avi',
            'requested_enabled' => false,
            'status' => 'disabled',
        ]);

        $response = $this->withToken($platform['token'])
            ->postJson('/api/platform/application-overrides/global/preview', [
                'operation' => PlatformGlobalApplicationOverrideService::GLOBAL_SHOW_ALL_TENANTS,
                'application_key' => 'fuel_stations.avi',
                'tenant_ids' => [$legacy['tenant_id'], $newTenant['tenant_id']],
            ])
            ->assertOk();

        $results = collect($response->json('data.sample_tenants'))->keyBy('tenant_id');
        $this->assertSame('applied', $results[$legacy['tenant_id']]['outcome']);
        $this->assertSame('skipped', $results[$newTenant['tenant_id']]['outcome']);
    }

    /** @test */
    public function global_apply_requires_confirmation_token(): void
    {
        $platform = $this->platformAdministrator();

        $this->withToken($platform['token'])
            ->postJson('/api/platform/application-overrides/global/apply', [
                'operation' => PlatformGlobalApplicationOverrideService::GLOBAL_SHOW_ALL_TENANTS,
                'application_key' => 'hr.employees',
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['confirmation_token']);
    }

    /** @test */
    public function global_apply_rejects_reused_confirmation_token(): void
    {
        $tenant = $this->registerIsolatedTenant('global-token-reuse', autoEnableApplications: false);
        $platform = $this->platformAdministrator();
        $payload = [
            'operation' => PlatformGlobalApplicationOverrideService::GLOBAL_SHOW_ALL_TENANTS,
            'application_key' => 'hr.employees',
            'tenant_ids' => [$tenant['tenant_id']],
        ];

        $preview = $this->globalPreview($platform['token'], $payload)->assertOk();
        $token = $preview->json('data.confirmation_token');

        $this->withToken($platform['token'])
            ->postJson('/api/platform/application-overrides/global/apply', array_merge($payload, [
                'confirmation_token' => $token,
            ]))
            ->assertOk();

        $this->withToken($platform['token'])
            ->postJson('/api/platform/application-overrides/global/apply', array_merge($payload, [
                'confirmation_token' => $token,
            ]))
            ->assertStatus(422);
    }

    /** @test */
    public function global_summary_rejects_invalid_tenant_ids(): void
    {
        $platform = $this->platformAdministrator();

        $this->withToken($platform['token'])
            ->getJson('/api/platform/application-overrides/global/summary?tenant_ids=not-a-uuid')
            ->assertStatus(422)
            ->assertJsonValidationErrors(['tenant_ids.0']);
    }

    /** @return array{tenant_id: string} */
    private function legacyTenantForGlobalOverrides(): array
    {
        $tenant = Tenant::create([
            'name' => 'مؤسسة قديمة عامة',
            'slug' => 'legacy-global-' . uniqid(),
            'vat_number' => '3000000000000' . random_int(10, 99),
            'currency' => 'SAR',
        ]);
        $tenant->forceFill(['created_at' => '2020-01-01 00:00:00'])->save();

        app(TenantContext::class)->set($tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($tenant->id);

        return ['tenant_id' => $tenant->id];
    }
}
