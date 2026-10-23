<?php

namespace App\Support;

use Ramsey\Uuid\Uuid;

/**
 * معرّف المصدر الثابت لوحدة استيراد (IMP-H1-S8a): UUID v5 مشتقّ من معرّف التشغيلة وترتيب الوحدة. حتميّ فلا حاجة إلى تخزين معرّفٍ لكل
 * صفٍّ ناجح، ولا يعتمد على أي قيمة قابلة للتصحيح (رمز صنف، كود شريك…) — فيبقى المعرّف نفسه بعد تصحيح المفتاح أو ملئه.
 */
final class ImportUnitRef
{
    public static function for(string $jobId, int $ordinal): string
    {
        return Uuid::uuid5($jobId, 'import-unit:'.$ordinal)->toString();
    }
}
