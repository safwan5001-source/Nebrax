<?php

namespace App\Services;

use App\Models\FuelStationDevice;
use RuntimeException;

/**
 * سجل محولات صريح لهذه الدورة. لا يكتشف classes أو يشغّل SDK خارجياً؛ يتيح
 * اختبار العقود التجريبية فقط إلى أن يوافق المنتج على محول مورّد حقيقي.
 */
class FuelStationDeviceAdapterRegistry
{
    /** @var array<string, FuelStationDeviceAdapter> */
    private array $adapters;

    public function __construct()
    {
        $this->adapters = [];
        foreach ([new FakeForecourtDriver(), new FakeAtgDriver(), new FakeRfidDriver()] as $adapter) {
            $this->adapters[$adapter->adapterKey()] = $adapter;
        }
    }

    public function forDevice(FuelStationDevice $device): FuelStationDeviceAdapter
    {
        $adapter = $this->adapters[$device->adapter_key] ?? null;
        if ($adapter === null) {
            throw new RuntimeException('لا يوجد محول محاكى مسجل لهذا الجهاز؛ لا يمكن إدخال حدث قبل اعتماد عقد المحول.');
        }
        if (! in_array($device->device_type, $adapter->supportedDeviceTypes(), true)) {
            throw new RuntimeException('المحول المسجل لا يدعم نوع جهاز محطة الوقود المحدد.');
        }

        return $adapter;
    }

    /** @return list<array{key: string, device_types: list<string>}> */
    public function available(): array
    {
        return array_values(array_map(static fn (FuelStationDeviceAdapter $adapter) => [
            'key' => $adapter->adapterKey(),
            'device_types' => $adapter->supportedDeviceTypes(),
        ], $this->adapters));
    }
}
