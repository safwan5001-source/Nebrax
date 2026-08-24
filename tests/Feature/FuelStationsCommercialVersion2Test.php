<?php

namespace Tests\Feature;

use App\Models\CommercialProduct;
use App\Models\CommercialProductVersion;
use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Models\TenantApplicationEntitlement;
use App\Models\TenantApplicationState;
use App\Models\TenantCommercialAssignment;
use App\Services\CommercialAssignmentService;
use App\Support\ApplicationCatalog;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

class FuelStationsCommercialVersion2Test extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const PRODUCT_CODE = 'fuel-stations';

    /** @var list<string> */
    private const VERSION_2_CAPABILITIES = [
        'fuel_stations.avi',
        'fuel_stations.core',
        'fuel_stations.integrations',
        'fuel_stations.maintenance',
    ];

    #[Test]
    public function version_one_remains_published_and_unchanged_while_version_two_contains_only_built_fuel_station_capabilities(): void
    {
        $product = $this->product();
        $v1 = $product->versions()->where('version', 1)->firstOrFail();
        $v2 = $product->versions()->where('version', 2)->firstOrFail();

        $this->assertNotNull($v1->published_at);
        $this->assertSame(['fuel_stations.core'], $this->capabilities($v1));
        $this->assertNotNull($v2->published_at);
        $this->assertSame($product->id, $v2->commercial_product_id);
        $this->assertSame(self::VERSION_2_CAPABILITIES, $this->capabilities($v2));
        $builtFuelCapabilities = array_keys(array_filter(ApplicationCatalog::all(), fn (array $capability): bool => $capability['group'] === 'fuel_stations' && $capability['maturity'] === ApplicationCatalog::MATURITY_BUILT));
        $this->assertSame(self::VERSION_2_CAPABILITIES, $this->sorted($builtFuelCapabilities));
        foreach ($this->capabilities($v2) as $capability) {
            $this->assertTrue(ApplicationCatalog::isActivatable($capability));
        }
        $this->assertNotContains('fuel_stations.inventory', $this->capabilities($v2));
        $this->assertNotContains('fuel_stations.forecourt', $this->capabilities($v2));
        $this->assertNotContains('fuel_stations.fleet', $this->capabilities($v2));
    }

    #[Test]
    public function publishing_version_two_is_idempotent_and_never_creates_tenant_assignments_or_operational_state_changes(): void
    {
        $this->assertSame(0, TenantCommercialAssignment::query()->count());
        $this->assertSame(0, TenantApplicationEntitlement::query()->count());
        $this->assertSame(0, TenantApplicationState::query()->count());
        $v2 = $this->product()->versions()->where('version', 2)->sole();

        $this->rerunVersionTwoMigration();

        $this->assertSame(1, $this->product()->versions()->where('version', 2)->count());
        $this->assertSame($v2->id, $this->product()->versions()->where('version', 2)->sole()->id);
        $this->assertSame(self::VERSION_2_CAPABILITIES, $this->capabilities($v2->fresh()));
        $this->assertSame(0, TenantCommercialAssignment::query()->count());
        $this->assertSame(0, TenantApplicationEntitlement::query()->count());
        $this->assertSame(0, TenantApplicationState::query()->count());
    }

    #[Test]
    public function rerunning_the_migration_preserves_historical_version_one_assignments_without_assigning_version_two(): void
    {
        $auth = $this->registerTenant('fuel-commercial-history', 'owner-fuel-commercial-history@example.test');
        $tenant = Tenant::findOrFail($auth['tenant_id']);
        $v1 = $this->product()->versions()->where('version', 1)->sole();
        $admin = PlatformAdministrator::create([
            'name' => 'Commercial History Admin',
            'email' => 'commercial-history+' . uniqid() . '@nebrax.test',
            'password' => 'platform-password-123',
        ]);
        $assignment = app(CommercialAssignmentService::class)->assignAddon($tenant, $admin, $v1, CarbonImmutable::now('UTC'), reason: 'تأكيد ثبات الإسناد التاريخي.');
        $statesBefore = TenantApplicationState::query()->orderBy('application_key')->get(['application_key', 'status'])->map->toArray()->all();

        $this->rerunVersionTwoMigration();

        $this->assertSame($assignment->id, TenantCommercialAssignment::query()->sole()->id);
        $this->assertSame($v1->id, TenantCommercialAssignment::query()->sole()->commercial_product_version_id);
        $this->assertSame($v1->id, TenantApplicationEntitlement::query()->sole()->source_reference_id);
        $this->assertSame(1, TenantCommercialAssignment::query()->count());
        $this->assertSame(1, TenantApplicationEntitlement::query()->count());
        $this->assertSame($statesBefore, TenantApplicationState::query()->orderBy('application_key')->get(['application_key', 'status'])->map->toArray()->all());
        $this->assertSame(0, TenantCommercialAssignment::query()->where('commercial_product_version_id', $this->product()->versions()->where('version', 2)->sole()->id)->count());
    }

    #[Test]
    public function platform_catalog_discovers_published_version_two_without_expanding_tenant_access_or_platform_rbac(): void
    {
        $tenant = $this->registerTenant('fuel-commercial-catalog', 'owner-fuel-commercial-catalog@example.test');
        $admin = PlatformAdministrator::create([
            'name' => 'Fuel Catalog Admin',
            'email' => 'fuel-catalog+' . uniqid() . '@nebrax.test',
            'password' => 'platform-password-123',
        ]);
        $readToken = $admin->createToken('fuel-catalog-read', ['platform:read'])->plainTextToken;
        $manageToken = $admin->createToken('fuel-catalog-manage', ['platform:manage'])->plainTextToken;

        $this->withToken($tenant['token'])->getJson('/api/platform/commercial-catalog')->assertForbidden();
        $this->withToken($readToken)->getJson('/api/platform/commercial-catalog')->assertForbidden();
        $products = $this->withToken($manageToken)->getJson('/api/platform/commercial-catalog')->assertOk()->json('data.products');
        $catalogProduct = collect($products)->firstWhere('code', self::PRODUCT_CODE);
        $version = collect($catalogProduct['versions'])->firstWhere('version', 2);

        $this->assertNotNull($version);
        $this->assertNotNull($version['published_at']);
        $this->assertSame(self::VERSION_2_CAPABILITIES, $this->sorted($version['capabilities']));
        $this->assertSame(0, TenantCommercialAssignment::query()->count());
        $this->assertSame(0, TenantApplicationEntitlement::query()->count());
    }

    private function product(): CommercialProduct
    {
        return CommercialProduct::query()->where('code', self::PRODUCT_CODE)->firstOrFail();
    }

    /** @return list<string> */
    private function capabilities(CommercialProductVersion $version): array
    {
        return $this->sorted($version->capabilities()->pluck('capability_key')->all());
    }

    /** @param list<string> $keys @return list<string> */
    private function sorted(array $keys): array
    {
        sort($keys);

        return $keys;
    }

    private function rerunVersionTwoMigration(): void
    {
        $migration = require database_path('migrations/2025_01_01_000118_publish_fuel_stations_commercial_version_2.php');
        $migration->up();
    }
}
