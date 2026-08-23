<?php

namespace App\Services;

/**
 * محول بروتوكول/مورّد إلى عقد الحدث الداخلي فقط.
 *
 * لا يرسل هذا العقد طلبات شبكة ولا يفتح اتصالاً دائماً؛ تشغيل السواقات وتهيئة
 * الاعتمادات ورصد health متعمد التأجيل إلى Cycle 8 بعد اعتماد Device Registry.
 */
interface FuelStationDeviceAdapter
{
    /** @param array<string, mixed> $payload */
    public function normalize(FuelStationDeviceIdentity $source, array $payload): FuelStationNormalizedEvent;
}
