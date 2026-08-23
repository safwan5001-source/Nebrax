<?php

namespace Tests\Feature;

use App\Models\CommercialProduct;
use App\Models\FuelStation;
use App\Models\FuelStationConfigurationEvent;
use App\Models\FuelStationIntegrationEvent;
use App\Models\Tenant;
use App\Models\User;
use App\Services\EntitlementGrantService;
use App\Services\FuelStationDeviceIdentity;
use App\Services\FuelStationEventType;
use App\Services\FuelStationIntegrationEventService;
use App\Services\FuelStationNormalizedEvent;
use App\Services\FuelStationSettingsService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

class FuelStationsFoundationTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function the_fuel_stations_commercial_product_is_published_with_only_the_built_foundation_capability(): void
    {
        $product = CommercialProduct::query()->where('code', 'fuel-stations')->firstOrFail();
        $version = $product->versions()->where('version', 1)->firstOrFail();

        $this->assertNotNull($version->published_at);
        $this->assertSame(['fuel_stations.core'], $version->capabilities()->pluck('capability_key')->all());
    }

    /** @test */
    public function workspace_is_fail_closed_until_the_owner_has_both_operational_enablement_and_commercial_entitlement(): void
    {
        $auth = $this->registerTenant(autoEnableApplications: true);

        $this->withToken($auth['token'])->getJson('/api/fuel-stations/workspace')->assertStatus(403);

        $this->grantFoundation($auth['tenant_id']);

        $this->withToken($auth['token'])->getJson('/api/fuel-stations/workspace')
            ->assertOk()
            ->assertJsonPath('data.application_key', 'fuel_stations.core')
            ->assertJsonPath('data.workspace_status', 'foundation_ready');
    }

    /** @test */
    public function workspace_requires_a_fuel_stations_role_permission_even_when_the_entitlement_is_active(): void
    {
        $auth = $this->registerTenant(autoEnableApplications: true);
        $this->grantFoundation($auth['tenant_id']);
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'fuel-stations-staff@example.test');

        $this->withToken($staff)->getJson('/api/fuel-stations/workspace')->assertStatus(403);
    }

    /** @test */
    public function settings_inherit_tenant_then_station_then_device_and_every_change_is_audited(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $owner = User::where('tenant_id', $auth['tenant_id'])->firstOrFail();
        $station = FuelStation::create(['code' => 'FS-001', 'name' => 'محطة الاختبار']);
        $settings = app(FuelStationSettingsService::class);

        $settings->putTenant(['operating_timezone' => 'UTC'], $owner, 'اختبار وراثة إعدادات المستأجر');
        $settings->putStation($station, 'operating_timezone', 'Asia/Riyadh', $owner, 'تخصيص المحطة');
        $settings->putDevice($station, 'terminal-01', 'operating_timezone', 'Asia/Dubai', $owner, 'تخصيص الجهاز');

        $this->assertSame('Asia/Riyadh', $settings->get($station, 'operating_timezone'));
        $this->assertSame('Asia/Dubai', $settings->get($station, 'operating_timezone', 'terminal-01'));
        $this->assertSame(3, FuelStationConfigurationEvent::query()->count());
        $this->assertSame(1, FuelStationConfigurationEvent::query()->where('device_key', 'terminal-01')->count());
    }

    /** @test */
    public function normalized_device_events_are_idempotent_and_reject_conflicting_sequences_or_payloads(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $station = FuelStation::create(['code' => 'FS-002', 'name' => 'محطة الساحة']);
        $service = app(FuelStationIntegrationEventService::class);
        $identity = new FuelStationDeviceIdentity($station->id, 'atg-01', 'generic-atg', 'tank-console-01');
        $event = new FuelStationNormalizedEvent('evt-001', FuelStationEventType::ATG_READING_RECORDED, CarbonImmutable::parse('2026-08-23 00:00:00Z'), ['reading' => ['volume_liters' => 1200, 'temperature' => 27]], 42, 'corr-001');

        $accepted = $service->accept($identity, $event);
        $replayed = $service->accept($identity, new FuelStationNormalizedEvent('evt-001', FuelStationEventType::ATG_READING_RECORDED, CarbonImmutable::parse('2026-08-23 00:00:00Z'), ['reading' => ['temperature' => 27, 'volume_liters' => 1200]], 42, 'corr-001'));

        $this->assertSame($accepted->id, $replayed->id);
        $this->assertSame(1, FuelStationIntegrationEvent::query()->count());

        $this->expectException(RuntimeException::class);
        $service->accept($identity, new FuelStationNormalizedEvent('evt-002', FuelStationEventType::ATG_READING_RECORDED, CarbonImmutable::parse('2026-08-23 00:01:00Z'), ['reading' => ['volume_liters' => 1201]], 42));
    }

    private function grantFoundation(string $tenantId): void
    {
        app(TenantContext::class)->set($tenantId);
        $tenant = Tenant::findOrFail($tenantId);
        app(EntitlementGrantService::class)->grant(
            $tenant,
            'fuel_stations.core',
            EntitlementAccessMode::FULL,
            EntitlementSourceType::MANUAL,
            CarbonImmutable::now('UTC'),
            grantReasonCode: 'test_foundation_access',
            reason: 'اختبار Foundation.',
        );
    }
}
