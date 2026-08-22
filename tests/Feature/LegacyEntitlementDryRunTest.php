<?php

namespace Tests\Feature;

use App\Models\Employee;
use App\Models\Tenant;
use App\Models\TenantApplicationEntitlement;
use App\Models\TenantApplicationState;
use App\Services\ApplicationAccessDecision;
use App\Services\LegacyEntitlementDryRunService;
use App\Support\ApplicationCatalog;
use App\Support\ApplicationOperationClass;
use App\Support\ApplicationAccessLevel;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

class LegacyEntitlementDryRunTest extends TestCase
{
    use RefreshDatabase;

    private LegacyEntitlementDryRunService $dryRun;
    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();

        $this->dryRun = app(LegacyEntitlementDryRunService::class);
        $this->tenant = Tenant::create([
            'name' => 'Legacy Dry Run Tenant',
            'slug' => 'legacy-dry-run-tenant',
            'currency' => 'SAR',
        ]);
        $this->tenant->forceFill(['created_at' => '2020-01-01 00:00:00'])->save();
        app(TenantContext::class)->set($this->tenant->id);
    }

    #[Test]
    public function mandatory_and_explicitly_enabled_capabilities_recommend_full_access(): void
    {
        TenantApplicationState::create([
            'application_key' => 'hr.employees',
            'requested_enabled' => true,
            'status' => 'enabled',
        ]);

        $rows = $this->keyed($this->dryRun->recommendFor($this->tenant));

        $this->assertSame(['FULL', 'MANDATORY_CAPABILITY'], $this->decision($rows, 'sales.invoicing'));
        $this->assertSame(['FULL', 'EXPLICIT_APPLICATION_STATE'], $this->decision($rows, 'hr.employees'));
    }

    #[Test]
    public function operational_evidence_uses_the_existing_application_service_detector(): void
    {
        Employee::create(['employee_no' => 'EMP-DRY-1', 'name' => 'Operational Evidence']);

        $rows = $this->keyed($this->dryRun->recommendFor($this->tenant));

        $this->assertSame(['FULL', 'OPERATIONAL_DATA_PRESENT'], $this->decision($rows, 'hr.employees'));
    }

    #[Test]
    public function no_evidence_does_not_grant_every_built_capability_to_a_legacy_tenant(): void
    {
        $rows = $this->keyed($this->dryRun->recommendFor($this->tenant));

        $this->assertSame(['NO_GRANT', 'NO_EVIDENCE'], $this->decision($rows, 'sales.pos'));
        $this->assertSame(['NO_GRANT', 'NO_EVIDENCE'], $this->decision($rows, 'compliance.zatca'));
    }

    #[Test]
    public function coming_soon_and_retired_capabilities_are_excluded_from_recommendations(): void
    {
        $keys = array_keys($this->keyed($this->dryRun->recommendFor($this->tenant)));
        $catalog = ApplicationCatalog::all();

        $this->assertNotContains('sales.commissions', $keys);
        foreach ($keys as $key) {
            $this->assertSame(ApplicationCatalog::MATURITY_BUILT, $catalog[$key]['maturity']);
        }
    }

    #[Test]
    public function dry_run_is_tenant_isolated_and_restores_the_callers_context(): void
    {
        $other = Tenant::create(['name' => 'Other Tenant', 'slug' => 'other-dry-run-tenant', 'currency' => 'SAR']);
        app(TenantContext::class)->set($other->id);
        Employee::create(['employee_no' => 'EMP-DRY-OTHER', 'name' => 'Other Evidence']);
        app(TenantContext::class)->set($this->tenant->id);

        $rows = $this->keyed($this->dryRun->recommendFor($this->tenant));

        $this->assertSame(['NO_GRANT', 'NO_EVIDENCE'], $this->decision($rows, 'hr.employees'));
        $this->assertSame($this->tenant->id, app(TenantContext::class)->id());
    }

    #[Test]
    public function repeated_dry_runs_create_no_grants_and_do_not_change_access_decisions(): void
    {
        $decision = app(ApplicationAccessDecision::class)->decide(
            $this->tenant,
            'sales.pos',
            ApplicationOperationClass::READ,
        );

        $first = $this->dryRun->recommendFor($this->tenant);
        $second = $this->dryRun->recommendFor($this->tenant);

        $this->assertSame($first, $second);
        $this->assertSame(0, TenantApplicationEntitlement::count());
        $this->assertSame(ApplicationAccessLevel::DENIED, $decision->level);
        $this->assertSame(ApplicationAccessLevel::DENIED, app(ApplicationAccessDecision::class)->decide(
            $this->tenant,
            'sales.pos',
            ApplicationOperationClass::READ,
        )->level);
    }

    #[Test]
    public function command_prints_recommendations_without_creating_grants(): void
    {
        $this->artisan('entitlements:legacy-dry-run', [
            '--tenant' => $this->tenant->id,
            '--include-no-grant' => true,
        ])->assertExitCode(0);

        $this->assertSame(0, TenantApplicationEntitlement::count());
    }

    /** @param list<array{tenant_id:string,capability_key:string,recommended_access_mode:string,reason:string}> $rows */
    private function keyed(array $rows): array
    {
        return collect($rows)->keyBy('capability_key')->all();
    }

    private function decision(array $rows, string $key): array
    {
        return [$rows[$key]['recommended_access_mode'], $rows[$key]['reason']];
    }
}
