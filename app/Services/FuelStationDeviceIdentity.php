<?php

namespace App\Services;

/**
 * هوية الجهاز قبل إنشاء سجل Device Registry في Cycle 8.
 *
 * `sourceId` هو مفتاح الثقة/التسلسل في طبقة الإدخال، وليس رقماً تسويقياً ولا
 * secret. ستُربط هذه الهوية بسجل جهاز مدقق لاحقاً من دون تغيير عقد الحدث.
 */
readonly class FuelStationDeviceIdentity
{
    public function __construct(
        public string $stationId,
        public string $sourceId,
        public string $adapterKey,
        public ?string $deviceKey = null,
    ) {
    }
}
