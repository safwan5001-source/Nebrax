<?php

namespace App\Support;

use Carbon\CarbonImmutable;
use DateTimeInterface;
use Illuminate\Contracts\Database\Eloquent\CastsAttributes;
use Illuminate\Database\Eloquent\Model;

/**
 * REM-13a — لحظة مخزَّنة بتوقيت UTC بدقة ثانية، لا تتأثر بـ`APP_TIMEZONE`.
 *
 * التحويل الافتراضي `datetime` يفسّر قيمة القاعدة بمنطقة التطبيق؛ فلو تغيّرت `APP_TIMEZONE` لاحقاً (قيمتها في
 * الإنتاج غير متحقَّق منها) لتغيّر معنى لحظة الإصدار المخزَّنة بصمت. هذا التحويل يقرأ الأعمدة دائماً على أنها UTC
 * ويكتبها دائماً UTC، ويقتطع أجزاء الثانية.
 */
final class UtcSecondInstant implements CastsAttributes
{
    private const FORMAT = 'Y-m-d H:i:s';

    public function get(Model $model, string $key, mixed $value, array $attributes): ?CarbonImmutable
    {
        if ($value === null || $value === '') {
            return null;
        }

        // PostgreSQL قد يُعيد كسراً أو إزاحة في بعض الإعدادات؛ الأعمدة هنا timestamp(0) بلا منطقة فنقرأ أول 19 خانة.
        return CarbonImmutable::createFromFormat(self::FORMAT, substr((string) $value, 0, 19), 'UTC');
    }

    public function set(Model $model, string $key, mixed $value, array $attributes): ?string
    {
        if ($value === null) {
            return null;
        }

        $instant = $value instanceof DateTimeInterface
            ? CarbonImmutable::instance($value)
            : CarbonImmutable::parse((string) $value, 'UTC');

        return $instant->setTimezone('UTC')->format(self::FORMAT);
    }
}
