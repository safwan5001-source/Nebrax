<?php

namespace Tests\Feature;

use App\Models\FuelOperationalLedger;
use App\Models\FuelStation;
use App\Models\FuelStationDevice;
use App\Models\FuelStationIntegrationEvent;
use App\Models\FuelStationIntegrationEventAttempt;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\User;
use App\Services\FuelStationDeviceIngressService;
use App\Services\FuelStationDeviceService;
use App\Services\FuelStationEventType;
use App\Services\FuelStationIntegrationEventService;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

class FuelStationDeviceIntegrationTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function a_registered_fake_atg_event_is_normalized_processed_once_and_never_creates_financial_or_inventory_effects(): void
    {
        [$station, $owner] = $this->stationAndOwner();
        $device = app(FuelStationDeviceService::class)->create([
            'fuel_station_id' => $station->id,
            'device_key' => 'atg-test-01',
            'name' => 'ATG تجريبي',
            'device_type' => FuelStationDevice::TYPE_ATG,
            'adapter_key' => 'fake.atg',
            'protocol' => 'simulation',
            'endpoint_metadata' => ['host' => 'test-gateway', 'port' => 0],
            'credential_reference' => 'vault:station/atg-test-01',
        ], $owner);

        $payload = [
            'type' => 'reading',
            'event_id' => 'atg-reading-001',
            'occurred_at' => CarbonImmutable::now('UTC')->subSeconds(2)->toIso8601String(),
            'sequence' => 17,
            'correlation_id' => 'atg-correlation-001',
            'payload' => ['tank_reference' => 'T-01', 'volume_milliliters' => 1250000, 'temperature_celsius' => 27],
        ];

        $accepted = app(FuelStationDeviceIngressService::class)->simulate($device, $payload, $owner);
        $replayed = app(FuelStationDeviceIngressService::class)->simulate($device, $payload, $owner);

        $this->assertSame($accepted->id, $replayed->id);
        $this->assertSame(FuelStationIntegrationEvent::STATUS_PROCESSED, $accepted->status);
        $this->assertSame(1, FuelStationIntegrationEvent::query()->count());
        $this->assertSame(2, FuelStationIntegrationEventAttempt::query()->count());
        $this->assertSame(FuelStationDevice::HEALTH_ONLINE, $device->fresh()->health);
        $this->assertSame(0, FuelOperationalLedger::query()->count());
        $this->assertSame(0, Invoice::query()->count());
        $this->assertSame(0, JournalEntry::query()->count());

        $this->expectException(RuntimeException::class);
        app(FuelStationDeviceIngressService::class)->simulate($device, array_replace_recursive($payload, [
            'payload' => ['tank_reference' => 'T-01', 'volume_milliliters' => 1250001],
        ]), $owner);
    }

    /** @test */
    public function device_metadata_rejects_raw_secrets_and_a_device_with_history_cannot_be_deleted_or_rekeyed(): void
    {
        [$station, $owner] = $this->stationAndOwner();
        $service = app(FuelStationDeviceService::class);

        try {
            $service->create([
                'fuel_station_id' => $station->id,
                'device_key' => 'unsafe-device',
                'name' => 'جهاز غير آمن',
                'device_type' => FuelStationDevice::TYPE_ATG,
                'adapter_key' => 'fake.atg',
                'endpoint_metadata' => ['password' => 'must-not-be-stored'],
            ], $owner);
            $this->fail('يجب رفض secret خام في metadata.');
        } catch (RuntimeException $exception) {
            $this->assertStringContainsString('credential_reference', $exception->getMessage());
        }

        $device = $service->create([
            'fuel_station_id' => $station->id,
            'device_key' => 'atg-history-01',
            'name' => 'ATG بسجل',
            'device_type' => FuelStationDevice::TYPE_ATG,
            'adapter_key' => 'fake.atg',
        ], $owner);
        app(FuelStationDeviceIngressService::class)->simulate($device, [
            'type' => 'alarm_raised',
            'event_id' => 'atg-alarm-001',
            'occurred_at' => CarbonImmutable::now('UTC')->subSecond()->toIso8601String(),
            'payload' => ['tank_reference' => 'T-02', 'alarm_code' => 'high_water'],
        ], $owner);

        $this->expectException(RuntimeException::class);
        $service->update($device, ['device_key' => 'atg-history-renamed'], $owner);
    }

    /** @test */
    public function a_mismatched_normalized_event_becomes_a_failed_evidence_record_and_respects_retry_limit(): void
    {
        [$station, $owner] = $this->stationAndOwner();
        $device = app(FuelStationDeviceService::class)->create([
            'fuel_station_id' => $station->id,
            'device_key' => 'atg-mismatch-01',
            'name' => 'ATG عدم تطابق',
            'device_type' => FuelStationDevice::TYPE_ATG,
            'adapter_key' => 'fake.atg',
        ], $owner);
        $event = FuelStationIntegrationEvent::create([
            'fuel_station_id' => $station->id,
            'fuel_station_device_id' => $device->id,
            'source_id' => $device->device_key,
            'event_id' => 'bad-type-001',
            'event_type' => FuelStationEventType::PUMP_STATUS_CHANGED->value,
            'occurred_at' => now(),
            'checksum' => hash('sha256', 'bad-type-001'),
            'payload' => ['pump_reference' => 'P-01', 'status' => 'online'],
            'status' => FuelStationIntegrationEvent::STATUS_ACCEPTED,
            'received_at' => now(),
        ]);

        $failed = app(FuelStationIntegrationEventService::class)->process($event, $owner);
        $this->assertSame(FuelStationIntegrationEvent::STATUS_FAILED, $failed->status);
        $this->assertSame(FuelStationDevice::HEALTH_DEGRADED, $device->fresh()->health);
        $this->assertNotNull($failed->failure_reason);

        $retried = app(FuelStationIntegrationEventService::class)->retry($failed, $owner);
        $this->assertSame(FuelStationIntegrationEvent::STATUS_ACCEPTED, $retried->status);
        $this->assertSame(1, $retried->retry_count);
        $this->assertSame(2, FuelStationIntegrationEventAttempt::query()->where('fuel_station_integration_event_id', $event->id)->count());
    }

    /** @test */
    public function registered_device_sources_are_isolated_by_the_active_tenant(): void
    {
        [$station, $owner] = $this->stationAndOwner();
        $device = app(FuelStationDeviceService::class)->create([
            'fuel_station_id' => $station->id,
            'device_key' => 'rfid-isolation-01',
            'name' => 'قارئ معزول',
            'device_type' => FuelStationDevice::TYPE_RFID_READER,
            'adapter_key' => 'fake.rfid',
        ], $owner);

        $other = $this->registerTenant('device-other', 'device-other@example.test');
        app(TenantContext::class)->set($other['tenant_id']);
        $otherOwner = User::where('tenant_id', $other['tenant_id'])->firstOrFail();

        $this->expectException(RuntimeException::class);
        app(FuelStationDeviceIngressService::class)->simulate($device, [
            'type' => 'vehicle_identified',
            'event_id' => 'rfid-cross-tenant',
            'occurred_at' => CarbonImmutable::now('UTC')->subSecond()->toIso8601String(),
            'payload' => ['identity_reference' => 'opaque-reference'],
        ], $otherOwner);
    }

    /** @return array{FuelStation, User} */
    private function stationAndOwner(): array
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $owner = User::where('tenant_id', $auth['tenant_id'])->firstOrFail();
        $station = FuelStation::create(['code' => 'DEV-'.substr($auth['tenant_id'], 0, 6), 'name' => 'محطة تكامل الأجهزة']);

        return [$station, $owner];
    }
}
