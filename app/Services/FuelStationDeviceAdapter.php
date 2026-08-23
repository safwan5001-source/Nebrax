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
    /** مفتاح ثابت غير سري يطابق adapter_key في سجل الجهاز. */
    public function adapterKey(): string;

    /** @return list<string> أنواع FuelStationDevice التي يقبلها المحول. */
    public function supportedDeviceTypes(): array;

    /** @param array<string, mixed> $payload */
    public function normalize(FuelStationDeviceIdentity $source, array $payload): FuelStationNormalizedEvent;
}
