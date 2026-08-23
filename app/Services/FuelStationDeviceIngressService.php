<?php

namespace App\Services;

use App\Models\FuelStationDevice;
use App\Models\FuelStationIntegrationEvent;
use App\Models\User;
use RuntimeException;

/**
 * إدخال تشغيلي محاكى فقط لدورة 8. يتعمد عدم قبول webhook أو network callback
 * عام؛ فمصادقة جهاز حقيقي وsecret vault تعتمدان على عقد المورّد اللاحق.
 */
class FuelStationDeviceIngressService
{
    public function __construct(
        private readonly FuelStationDeviceService $devices,
        private readonly FuelStationDeviceAdapterRegistry $adapters,
        private readonly FuelStationIntegrationEventService $events,
        private readonly FuelStationSettingsService $settings,
    ) {
    }

    /** @param array<string, mixed> $payload */
    public function simulate(FuelStationDevice $device, array $payload, User $actor): FuelStationIntegrationEvent
    {
        // لا نثق بكائن route/model قادم من سياق آخر؛ تعيد الخدمة حله ضمن
        // TenantContext والمحطة ومطابقة adapter قبل لمس العلاقة أو الإعداد.
        $device = $this->devices->activeSource($device->fuel_station_id, $device->device_key, $device->adapter_key);
        if (! $this->settings->get($device->loadMissing('station')->station, 'device_simulated_ingress_enabled', $device->device_key)) {
            throw new RuntimeException('أدخلت سياسة المحطة إدخال أحداث الأجهزة المحاكى.');
        }

        $adapter = $this->adapters->forDevice($device);
        $source = new FuelStationDeviceIdentity(
            stationId: $device->fuel_station_id,
            sourceId: $device->device_key,
            adapterKey: $adapter->adapterKey(),
            deviceKey: $device->id,
        );

        return $this->events->accept($source, $adapter->normalize($source, $payload), $actor);
    }
}
