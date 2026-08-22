<?php

namespace Tests\Feature;

use App\Models\Tenant;
use App\Models\TenantApplicationEntitlement;
use App\Models\TenantApplicationState;
use App\Services\ApplicationAccessDecision;
use App\Services\EntitlementGrantService;
use App\Support\ApplicationAccessLevel;
use App\Support\ApplicationOperationClass;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

class GrantLegacyReachableZatcaCommandTest extends TestCase
{
    use RefreshDatabase;

    private const DOCUMENTED_TENANT_ID = 'a278e3a7-8eec-4ba7-a32b-7e433541042d';

    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = new Tenant([
            'name' => 'Legacy ZATCA Tenant',
            'slug' => 'legacy-zatca-tenant',
            'currency' => 'SAR',
        ]);
        $this->tenant->id = self::DOCUMENTED_TENANT_ID;
        $this->tenant->save();
        $this->tenant->forceFill(['created_at' => '2020-01-01 00:00:00'])->save();
        app(TenantContext::class)->set($this->tenant->id);

        TenantApplicationState::create([
            'application_key' => 'compliance.zatca',
            'requested_enabled' => true,
            'status' => 'enabled',
        ]);
        $this->grantDependencies();
    }

    #[Test]
    public function it_requires_explicit_tenant_and_apply_without_writing(): void
    {
        $this->artisan('entitlements:grant-legacy-reachable-zatca')
            ->expectsOutputToContain('يتطلب الأمر --tenant')
            ->assertExitCode(1);

        $this->artisan('entitlements:grant-legacy-reachable-zatca', [
            '--tenant' => $this->tenant->id,
        ])->expectsOutputToContain('يتطلب الأمر --apply')
            ->assertExitCode(1);

        $this->assertSame(2, TenantApplicationEntitlement::count());
    }

    #[Test]
    public function it_grants_the_documented_capability_once_with_postgresql_safe_reference_and_preserves_state(): void
    {
        $state = TenantApplicationState::where('application_key', 'compliance.zatca')->firstOrFail();

        $this->assertSame(ApplicationAccessLevel::DENIED, $this->zatcaDecision()->level);
        $this->artisan('entitlements:grant-legacy-reachable-zatca', [
            '--tenant' => $this->tenant->id,
            '--apply' => true,
        ])->assertExitCode(0);

        $grant = TenantApplicationEntitlement::where('capability_key', 'compliance.zatca')->firstOrFail();
        $this->assertSame(EntitlementAccessMode::FULL->value, $grant->access_mode);
        $this->assertSame(EntitlementSourceType::LEGACY_GRANDFATHER->value, $grant->source_type);
        $this->assertSame('legacy-backfill', $grant->source_reference_type);
        $this->assertSame($this->tenant->id, $grant->source_reference_id);
        $this->assertNull($grant->grant_group_id);
        $this->assertSame('LEGACY_REACHABLE', $grant->grant_reason_code);
        $this->assertSame('LEGACY_REACHABLE', $grant->reason);
        $this->assertSame([
            'evidence' => 'ENTITLEMENT_SHADOW_MISMATCH',
            'legacy_reachable' => true,
        ], $grant->metadata);
        $this->assertSame('enabled', $state->fresh()->status);
        $this->assertSame(ApplicationAccessLevel::ALLOWED, $this->zatcaDecision()->level);
    }

    #[Test]
    public function it_is_idempotent_and_does_not_grant_other_capabilities_or_other_tenants(): void
    {
        $other = Tenant::create([
            'name' => 'Other Legacy ZATCA Tenant',
            'slug' => 'other-legacy-zatca-tenant',
            'currency' => 'SAR',
        ]);
        $other->forceFill(['created_at' => '2020-01-01 00:00:00'])->save();

        $arguments = [
            '--tenant' => $this->tenant->id,
            '--apply' => true,
        ];
        $this->artisan('entitlements:grant-legacy-reachable-zatca', $arguments)->assertExitCode(0);
        $first = TenantApplicationEntitlement::where('capability_key', 'compliance.zatca')->firstOrFail();

        $this->artisan('entitlements:grant-legacy-reachable-zatca', $arguments)->assertExitCode(0);
        $this->assertSame(1, TenantApplicationEntitlement::where('capability_key', 'compliance.zatca')->count());
        $this->assertSame($first->idempotency_key, TenantApplicationEntitlement::where('capability_key', 'compliance.zatca')->firstOrFail()->idempotency_key);
        $this->assertSame(0, TenantApplicationEntitlement::where('capability_key', 'sales.pos')->count());

        app(TenantContext::class)->set($other->id);
        $this->assertSame(0, TenantApplicationEntitlement::count());
        app(TenantContext::class)->set($this->tenant->id);
    }

    #[Test]
    public function it_rejects_any_other_tenant_without_writing(): void
    {
        $newTenant = Tenant::create([
            'name' => 'New ZATCA Tenant',
            'slug' => 'new-zatca-tenant',
            'currency' => 'SAR',
        ]);

        $this->artisan('entitlements:grant-legacy-reachable-zatca', [
            '--tenant' => $newTenant->id,
            '--apply' => true,
        ])->expectsOutputToContain('مقيد بالمستأجر الموثق فقط')
            ->assertExitCode(1);

        $this->assertSame(0, TenantApplicationEntitlement::where('capability_key', 'compliance.zatca')->count());
    }

    private function grantDependencies(): void
    {
        $grants = app(EntitlementGrantService::class);
        foreach (['sales.invoicing', 'accounting.ledger'] as $capabilityKey) {
            $grants->grant(
                $this->tenant,
                $capabilityKey,
                EntitlementAccessMode::FULL,
                EntitlementSourceType::LEGACY_GRANDFATHER,
                $this->tenant->created_at,
                null,
                'test-dependency',
                $this->tenant->id,
                null,
                'TEST_DEPENDENCY',
            );
        }
    }

    private function zatcaDecision(): \App\Support\ApplicationAccessResult
    {
        return app(ApplicationAccessDecision::class)->decide(
            $this->tenant,
            'compliance.zatca',
            ApplicationOperationClass::READ,
        );
    }
}
