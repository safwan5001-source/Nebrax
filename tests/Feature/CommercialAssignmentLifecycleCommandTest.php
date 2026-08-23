<?php

namespace Tests\Feature;

use App\Models\CommercialProduct;
use App\Models\CommercialProductVersion;
use App\Models\Tenant;
use App\Models\TenantApplicationEntitlement;
use App\Models\TenantCommercialAssignment;
use App\Services\CommercialAssignmentLifecycleService;
use App\Services\CommercialAssignmentService;
use App\Services\CommercialProductVersionService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CommercialAssignmentLifecycleCommandTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;
    private TenantCommercialAssignment $assignment;

    protected function setUp(): void
    {
        parent::setUp();
        $this->tenant = Tenant::create(['name' => 'Lifecycle Command Tenant', 'slug' => 'lifecycle-command', 'currency' => 'SAR']);
        $product = CommercialProduct::create(['code' => 'lifecycle-command-hr', 'name' => 'Lifecycle Command HR']);
        $version = CommercialProductVersion::create(['commercial_product_id' => $product->id, 'version' => 1]);
        $products = app(CommercialProductVersionService::class);
        $products->setCapabilities($version, ['hr.employees']);
        $products->publish($version);
        $this->assignment = app(CommercialAssignmentService::class)->assignAddon(
            $this->tenant, null, $version, CarbonImmutable::parse('2026-01-01T00:00:00Z'),
        );
        app(CommercialAssignmentLifecycleService::class)->recordPaymentFailure(
            $this->assignment, null, CarbonImmutable::parse('2026-01-01T00:00:00Z'),
        );
    }

    /** @test */
    public function it_previews_read_only_transition_without_writing_then_applies_only_explicitly(): void
    {
        $arguments = [
            '--tenant' => $this->tenant->id,
            '--assignment' => $this->assignment->id,
            '--at' => '2026-01-09T00:00:00Z',
        ];
        $this->assertSame('read_only', app(CommercialAssignmentLifecycleService::class)->accessForGrant(
            $this->tenant, $this->assignment->id, CarbonImmutable::parse('2026-01-09T00:00:00Z'),
        )?->value);


        $this->artisan('entitlements:commercial-lifecycle-reconcile', $arguments)
            ->expectsOutputToContain('"mode": "dry-run"')
            ->expectsOutputToContain('Read-only lifecycle preview complete')
            ->assertExitCode(0);
        $this->assertSame(1, TenantApplicationEntitlement::where('grant_group_id', $this->assignment->id)->where('access_mode', 'full')->whereNull('revoked_at')->count());
        $this->assertSame(0, TenantApplicationEntitlement::where('grant_group_id', $this->assignment->id)->where('access_mode', 'read_only')->count());

        $this->artisan('entitlements:commercial-lifecycle-reconcile', [...$arguments, '--apply' => true])
            ->expectsOutputToContain('reconciled to grace_read_only')
            ->assertExitCode(0);
        $this->assertSame(0, TenantApplicationEntitlement::where('grant_group_id', $this->assignment->id)->where('access_mode', 'full')->whereNull('revoked_at')->count());
        $this->assertSame(1, TenantApplicationEntitlement::where('grant_group_id', $this->assignment->id)->where('access_mode', 'read_only')->whereNull('revoked_at')->count());
    }

    /** @test */
    public function it_rejects_invalid_or_cross_tenant_assignment_references_without_writing(): void
    {
        $this->artisan('entitlements:commercial-lifecycle-reconcile', ['--tenant' => 'invalid', '--assignment' => 'invalid'])
            ->expectsOutputToContain('Both --tenant and --assignment must be UUIDs.')
            ->assertExitCode(2);
        $other = Tenant::create(['name' => 'Other', 'slug' => 'lifecycle-command-other', 'currency' => 'SAR']);
        $this->artisan('entitlements:commercial-lifecycle-reconcile', ['--tenant' => $other->id, '--assignment' => $this->assignment->id])
            ->expectsOutputToContain('Commercial assignment not found for this tenant.')
            ->assertExitCode(1);
        $this->assertSame(TenantCommercialAssignment::LIFECYCLE_GRACE_FULL, $this->assignment->fresh()->lifecycle_state);
    }
}
