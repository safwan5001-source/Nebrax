<?php

namespace Tests\Feature;

use App\Models\CommercialPlanVersion;
use App\Models\CommercialProduct;
use App\Models\CommercialProductVersion;
use App\Models\Tenant;
use App\Models\TenantApplicationEntitlement;
use App\Models\TenantCommercialAssignment;
use App\Models\TenantCommercialAssignmentEvent;
use App\Services\CommercialPlanVersionService;
use App\Services\CommercialProductVersionService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CommercialAssignmentDryRunCommandTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;
    private CommercialPlanVersion $plan;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create(['name' => 'Dry Run Tenant', 'slug' => 'commercial-dry-run', 'currency' => 'SAR']);
        $product = CommercialProduct::create(['code' => 'dry-run-hr', 'name' => 'Dry Run HR']);
        $productVersion = CommercialProductVersion::create(['commercial_product_id' => $product->id, 'version' => 1]);
        $products = app(CommercialProductVersionService::class);
        $products->setCapabilities($productVersion, ['hr.employees']);
        $products->publish($productVersion);

        $plan = CommercialPlanVersion::create(['plan_code' => 'dry-run-starter', 'version' => 1]);
        $plans = app(CommercialPlanVersionService::class);
        $plans->setProducts($plan, [$productVersion]);
        $this->plan = $plans->publish($plan);
    }

    /** @test */
    public function it_requires_one_tenant_uuid_and_exactly_one_commercial_version(): void
    {
        $this->artisan('entitlements:commercial-assignment-dry-run')
            ->expectsOutputToContain('The --tenant option must be a UUID.')
            ->assertExitCode(2);
        $this->artisan('entitlements:commercial-assignment-dry-run', ['--tenant' => $this->tenant->id])
            ->expectsOutputToContain('Supply exactly one')
            ->assertExitCode(2);
        $this->assertSame(0, TenantCommercialAssignment::count());
        $this->assertSame(0, TenantApplicationEntitlement::count());
    }

    /** @test */
    public function it_previews_a_plan_read_only_then_applies_idempotently_only_with_the_explicit_flag(): void
    {
        $arguments = [
            '--tenant' => $this->tenant->id,
            '--plan-version' => $this->plan->id,
            '--starts-at' => '2026-08-23T00:00:00Z',
        ];

        $this->artisan('entitlements:commercial-assignment-dry-run', $arguments)
            ->expectsOutputToContain('"mode": "dry-run"')
            ->expectsOutputToContain('Read-only dry run complete')
            ->assertExitCode(0);
        $this->assertSame(0, TenantCommercialAssignment::count());
        $this->assertSame(0, TenantApplicationEntitlement::count());

        $this->artisan('entitlements:commercial-assignment-dry-run', [...$arguments, '--apply' => true])
            ->expectsOutputToContain('"mode": "apply"')
            ->expectsOutputToContain('applied through CommercialAssignmentService')
            ->assertExitCode(0);
        $this->artisan('entitlements:commercial-assignment-dry-run', [...$arguments, '--apply' => true])
            ->assertExitCode(0);

        $this->assertSame(1, TenantCommercialAssignment::count());
        $this->assertSame(1, TenantCommercialAssignmentEvent::count());
        $grant = TenantApplicationEntitlement::sole();
        $this->assertSame('plan', $grant->source_type);
        $this->assertSame('commercial-plan-version', $grant->source_reference_type);
        $this->assertSame($this->plan->id, $grant->source_reference_id);
    }
}
