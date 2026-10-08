<?php

namespace App\Http\Resources;

use App\Models\StorefrontMediaDerivative;
use App\Services\Commerce\StorefrontMediaDerivativeService;

/**
 * CUST-HV V2b — حالة استخدام (تحويل) وسائط لمساحة العمل. قائمة سماح ضيقة:
 * **لا** `storage_key` ولا مسار/دلو ولا `transform` الخام ولا أدلة التباين الخام. (V6b-4a: حقل `contrast`
 * الوحيد حدّا قنوات مشفّرة موسَّعان بهامش الترميز — نفس ما تحكم به بوّابة النشر — لتطابق نتيجة المحرّر الحيّة
 * نتيجة النشر؛ وهو `null` ما لم يكتمل دليلٌ صالح.)
 * الرابط الموقَّع يُصدَر لكل ملفٍ جاهز فقط، قصير الأجل ويُعاد إصداره مع كل قراءة.
 */
final class StorefrontMediaDerivativeResource
{
    /**
     * @param  array<string,mixed>  $status ناتج `StorefrontMediaDerivativeService::status()`
     * @param  array{min:list<int>,max:list<int>}|null  $contrast
     * @return array<string,mixed>
     */
    public static function usage(array $status, StorefrontMediaDerivativeService $service, ?array $contrast = null): array
    {
        $rows = $status['state'] === StorefrontMediaDerivativeService::USAGE_ABSENT
            ? collect()
            : StorefrontMediaDerivative::query()
                ->where('media_id', $status['media_id'])
                ->where('usage_key', $status['usage_key'])
                ->where('state', StorefrontMediaDerivative::STATE_READY)
                ->get()
                ->keyBy(fn (StorefrontMediaDerivative $r): string => $r->width.'.'.$r->format);

        $files = array_map(static function (array $file) use ($rows, $service): array {
            $row = $rows->get($file['width'].'.'.$file['format']);

            return $file + ['url' => $row !== null ? $service->signedUrl($row) : null];
        }, $status['files']);

        return [
            'media_id' => $status['media_id'],
            'usage_key' => $status['usage_key'],
            'state' => $status['state'],
            'retryable' => $status['retryable'],
            'error_code' => $status['error_code'],
            'files' => $files,
            'contrast' => $contrast,
        ];
    }
}
