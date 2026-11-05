<?php

namespace App\Services;

use App\Models\FuelProduct;
use App\Models\FuelStation;
use App\Models\FuelStationConfigurationEvent;
use App\Models\FuelStationProductPrice;
use App\Models\User;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use App\Support\FuelPriceException;
use RuntimeException;

/** مصدر السعر الوحيد لبيع الوقود: override المحطة ثم default المستأجر ثم رفض صريح. */
class FuelStationProductPriceService
{
    public const SOURCE_STATION_OVERRIDE = 'station_override';
    public const SOURCE_TENANT_DEFAULT = 'tenant_default';

    /**
     * ينشئ فترة سعر جديدة (لا تعديل لسعر قائم). كل المسارات تمرّ من هنا.
     *
     * - `idempotency_key`: إعادة المحاولة بالمفتاح نفسه ونفس (محطة، منتج، سعر) تعيد السجل القائم (`replayed`)؛ مفتاح بمحتوى مختلف ⇒ 409.
     * - `start_now`: الخادم يختم وقت البدء (ثواني صحيحة) بدل ساعة العميل.
     * - `supersede` (صريح فقط): يُغلق سعراً ساريًا مفتوحًا بـ`effective_until = effective_from` الجديد. لا يلمس قيمة السعر ولا تاريخ بدئه،
     *   ويُرفض إن كان السعر الجديد مؤقتاً (له نهاية) أو بأثر رجعي أو يتعارض مع سعر يبدأ لاحقاً. بدونه يبقى التعارض رفضاً كما كان.
     * - `$beforeWrite`: تحقق إضافي (كاقتراح بطاقة المنتج) يجري داخل المعاملة بعد الأقفال وقبل أي كتابة.
     *
     * @param array<string,mixed> $attributes
     */
    public function create(array $attributes, User $actor, ?callable $beforeWrite = null): FuelStationProductPrice
    {
        $fuelProductId = $this->requiredString($attributes, 'fuel_product_id');
        $stationId = $this->nullableId($attributes['fuel_station_id'] ?? null);
        $price = $this->positiveInteger($attributes['price_per_liter_minor'] ?? null, 'price_per_liter_minor');
        $startNow = ($attributes['start_now'] ?? false) === true;
        $effectiveFrom = $startNow ? now()->startOfSecond() : $this->date($attributes['effective_from'] ?? null, 'effective_from');
        $effectiveUntil = array_key_exists('effective_until', $attributes) && $attributes['effective_until'] !== null
            ? $this->date($attributes['effective_until'], 'effective_until')
            : null;
        if ($effectiveUntil !== null && $effectiveUntil <= $effectiveFrom) {
            throw new RuntimeException('effective_until يجب أن يكون بعد effective_from.');
        }
        $supersede = ($attributes['supersede'] ?? false) === true;
        $key = $this->nullableKey($attributes['idempotency_key'] ?? null);
        $entrySource = in_array($attributes['entry_source'] ?? FuelStationProductPrice::SOURCE_MANUAL, FuelStationProductPrice::ENTRY_SOURCES, true)
            ? ($attributes['entry_source'] ?? FuelStationProductPrice::SOURCE_MANUAL)
            : FuelStationProductPrice::SOURCE_MANUAL;

        return DB::transaction(function () use ($fuelProductId, $stationId, $price, $effectiveFrom, $effectiveUntil, $supersede, $key, $entrySource, $attributes, $actor, $beforeWrite) {
            $fuelProduct = FuelProduct::lockForUpdate()->findOrFail($fuelProductId);

            // قفل المنتج يسلسل كل إنشاءات أسعاره؛ فالبحث بالمفتاح بعده لا يسابق إدراجاً آخر.
            if ($key !== null) {
                $existing = FuelStationProductPrice::where('idempotency_key', $key)->first();
                if ($existing !== null) {
                    if ($existing->fuel_product_id !== $fuelProduct->id || $existing->fuel_station_id !== $stationId || (int) $existing->price_per_liter_minor !== $price) {
                        throw new FuelPriceException('idempotency_key_conflict', 'مفتاح التكرار مستعمل لسعر مختلف.', 409);
                    }
                    $existing->replayed = true;

                    return $existing;
                }
            }

            if (! $fuelProduct->is_active) {
                throw new RuntimeException('لا يمكن تسعير منتج وقود غير نشط.');
            }
            $station = $stationId === null ? null : FuelStation::lockForUpdate()->findOrFail($stationId);
            if ($station !== null && $station->status !== FuelStation::STATUS_ACTIVE) {
                throw new RuntimeException('لا يمكن ضبط سعر لمحطة غير نشطة.');
            }
            if ($beforeWrite !== null) {
                $beforeWrite($fuelProduct, $station);
            }

            $overlaps = FuelStationProductPrice::where('fuel_product_id', $fuelProduct->id)
                ->when($station === null, fn ($query) => $query->whereNull('fuel_station_id'), fn ($query) => $query->where('fuel_station_id', $station->id))
                ->where('status', FuelStationProductPrice::STATUS_ACTIVE)
                ->where('effective_from', '<', $effectiveUntil ?? '9999-12-31 23:59:59')
                ->where(function ($query) use ($effectiveFrom) {
                    $query->whereNull('effective_until')->orWhere('effective_until', '>', $effectiveFrom);
                })
                ->lockForUpdate()
                ->get();

            $closed = [];
            if ($overlaps->isNotEmpty()) {
                $blocker = $this->supersedeBlocker($overlaps, $effectiveFrom, $effectiveUntil);
                if (! $supersede || $blocker !== null) {
                    throw new FuelPriceException(
                        $supersede ? $blocker : 'price_overlap',
                        'تتداخل فترة السعر مع سعر وقود فعال موجود لنفس النطاق والمنتج.',
                        422,
                        ['can_supersede' => $blocker === null, 'conflicts' => $overlaps->map(fn (FuelStationProductPrice $row) => $this->conflictView($row))->all()],
                    );
                }
                foreach ($overlaps as $old) {
                    $before = $this->snapshot($old);
                    // الإغلاق الوحيد المسموح: ضبط نهاية فترة سعر مفتوحة. عبر الاستعلام الأساسي لأن النموذج يمنع التعديل عمداً،
                    // ولا تُمسّ قيمة السعر ولا بدايته ولا حالته.
                    FuelStationProductPrice::query()->whereKey($old->id)->toBase()->update(['effective_until' => $effectiveFrom, 'updated_at' => now()]);
                    FuelStationConfigurationEvent::create([
                        'fuel_station_id' => $old->fuel_station_id,
                        'device_key' => '',
                        'setting_key' => 'fuel_sales.price_per_liter_minor',
                        'before' => $before,
                        'after' => $this->snapshot($old->refresh()),
                        'changed_by' => $actor->id,
                        'reason' => 'إغلاق سعر ساري باستبدال صريح بسعر جديد.',
                        'changed_at' => now(),
                    ]);
                    $closed[] = $old->id;
                }
            }

            $priceRow = FuelStationProductPrice::create([
                'fuel_station_id' => $station?->id,
                'fuel_product_id' => $fuelProduct->id,
                'price_per_liter_minor' => $price,
                'effective_from' => $effectiveFrom,
                'effective_until' => $effectiveUntil,
                'status' => FuelStationProductPrice::STATUS_ACTIVE,
                'created_by' => $actor->id,
                // الموافق هو الفاعل دائماً من مسار HTTP؛ المعرّف المُمرَّر لا يصل من الطلبات (يُسقطه الـFormRequest).
                'approved_by' => $attributes['approved_by'] ?? $actor->id,
                'reason' => $this->nullableText($attributes['reason'] ?? null),
                'idempotency_key' => $key,
                'entry_source' => $entrySource,
            ]);

            FuelStationConfigurationEvent::create([
                'fuel_station_id' => $station?->id,
                'device_key' => '',
                'setting_key' => 'fuel_sales.price_per_liter_minor',
                'before' => null,
                'after' => $this->snapshot($priceRow) + ['entry_source' => $entrySource, 'superseded_price_ids' => $closed],
                'changed_by' => $actor->id,
                'reason' => $priceRow->reason,
                'changed_at' => now(),
            ]);

            $fresh = $priceRow->fresh();
            $fresh->supersededIds = $closed;

            return $fresh;
        });
    }

    /**
     * هل يمكن حلّ التداخل باستبدال صريح؟ null = نعم، وإلا رمز السبب.
     * الاستبدال يُغلق سعراً قائماً عند بداية الجديد، فلا يصحّ مع سعر جديد مؤقت (يترك فجوة بعد نهايته)،
     * ولا بأثر رجعي (يغيّر نافذة سعر ربما استُعمل)، ولا مع سعر قائم يبدأ في/بعد بداية الجديد (لا يُلغى سعر مجدول).
     *
     * @param \Illuminate\Support\Collection<int, FuelStationProductPrice> $overlaps
     */
    private function supersedeBlocker($overlaps, CarbonInterface $from, ?CarbonInterface $until): ?string
    {
        if ($until !== null) {
            return 'supersede_requires_open_ended';
        }
        if ($from->lt(now()->startOfSecond()->subSeconds(5))) {
            return 'supersede_backdated';
        }
        foreach ($overlaps as $old) {
            if ($old->effective_from >= $from) {
                return 'supersede_conflicts_with_later_price';
            }
        }

        return null;
    }

    /** @return array<string,mixed> */
    private function conflictView(FuelStationProductPrice $row): array
    {
        return [
            'id' => $row->id,
            'fuel_station_id' => $row->fuel_station_id,
            'price_per_liter_minor' => (int) $row->price_per_liter_minor,
            'effective_from' => $row->effective_from?->toIso8601String(),
            'effective_until' => $row->effective_until?->toIso8601String(),
        ];
    }

    private function nullableKey(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }
        if (! is_string($value) || ! preg_match('/^[A-Za-z0-9_-]{8,64}$/', $value)) {
            throw new RuntimeException('idempotency_key غير صالح.');
        }

        return $value;
    }

    /**
     * السعر الفعّال وقت `$at` — **القرار الوحيد** لسعر لتر الوقود: سعر المحطة ثم افتراضي المستأجر.
     * يستعمله البيع (`effective()` الرافضة) وقراءة التطبيق (`GET /fuel-stations/prices/effective`)
     * معاً، فلا يمكن أن يختلف المعروض عن المستعمل وقت الإنهاء. يعيد null عند الغياب (لا يخمّن ولا يرمي).
     *
     * @return array{price: FuelStationProductPrice, source: string}|null  source: station_override|tenant_default
     */
    public function resolve(FuelStation $station, FuelProduct $fuelProduct, CarbonInterface $at): ?array
    {
        $stationPrice = $this->effectiveForScope($fuelProduct->id, $station->id, $at);
        if ($stationPrice !== null) {
            return ['price' => $stationPrice, 'source' => self::SOURCE_STATION_OVERRIDE];
        }

        $tenantDefault = $this->effectiveForScope($fuelProduct->id, null, $at);
        if ($tenantDefault !== null) {
            return ['price' => $tenantDefault, 'source' => self::SOURCE_TENANT_DEFAULT];
        }

        return null;
    }

    public function effective(FuelStation $station, FuelProduct $fuelProduct, CarbonInterface $at): FuelStationProductPrice
    {
        $resolved = $this->resolve($station, $fuelProduct, $at);
        if ($resolved === null) {
            throw new RuntimeException('FUEL_PRICE_NOT_CONFIGURED: لا يوجد سعر وقود فعال للمحطة أو للمستأجر في وقت البيع.');
        }

        return $resolved['price'];
    }

    /** السعر الفعّال ضمن نطاق واحد بعينه (محطة أو المؤسسة) دون تسلسل الأولوية — لمقارنة اقتراح بسعر النطاق نفسه. */
    public function effectiveInScope(string $fuelProductId, ?string $stationId, CarbonInterface $at): ?FuelStationProductPrice
    {
        return $this->effectiveForScope($fuelProductId, $stationId, $at);
    }

    private function effectiveForScope(string $fuelProductId, ?string $stationId, CarbonInterface $at): ?FuelStationProductPrice
    {
        return FuelStationProductPrice::where('fuel_product_id', $fuelProductId)
            ->when($stationId === null, fn ($query) => $query->whereNull('fuel_station_id'), fn ($query) => $query->where('fuel_station_id', $stationId))
            ->where('status', FuelStationProductPrice::STATUS_ACTIVE)
            ->where('effective_from', '<=', $at)
            ->where(function ($query) use ($at) {
                $query->whereNull('effective_until')->orWhere('effective_until', '>', $at);
            })
            ->orderByDesc('effective_from')
            ->first();
    }

    /** @return array<string,mixed> */
    private function snapshot(FuelStationProductPrice $price): array
    {
        return [
            'price_id' => $price->id,
            'fuel_station_id' => $price->fuel_station_id,
            'fuel_product_id' => $price->fuel_product_id,
            'price_per_liter_minor' => (int) $price->price_per_liter_minor,
            'effective_from' => $price->effective_from?->toIso8601String(),
            'effective_until' => $price->effective_until?->toIso8601String(),
            'status' => $price->status,
        ];
    }

    private function date(mixed $value, string $key): CarbonInterface
    {
        if (! is_string($value) || trim($value) === '') {
            throw new RuntimeException("{$key} مطلوب.");
        }
        try {
            return now()->parse($value);
        } catch (\Throwable) {
            throw new RuntimeException("{$key} يجب أن يكون تاريخاً صالحاً.");
        }
    }

    private function requiredString(array $attributes, string $key): string
    {
        $value = $attributes[$key] ?? null;
        if (! is_string($value) || trim($value) === '') {
            throw new RuntimeException("{$key} مطلوب.");
        }
        return trim($value);
    }

    private function nullableId(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }
        if (! is_string($value) || trim($value) === '') {
            throw new RuntimeException('fuel_station_id يجب أن يكون معرفاً صالحاً أو null للسعر الافتراضي.');
        }
        return trim($value);
    }

    private function positiveInteger(mixed $value, string $key): int
    {
        if (! is_int($value) && !(is_string($value) && preg_match('/^[1-9][0-9]*$/', $value))) {
            throw new RuntimeException("{$key} يجب أن يكون عدداً صحيحاً موجباً.");
        }
        $integer = (int) $value;
        if ($integer <= 0) {
            throw new RuntimeException("{$key} يجب أن يكون عدداً صحيحاً موجباً.");
        }
        return $integer;
    }

    private function nullableText(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }
        if (! is_string($value)) {
            throw new RuntimeException('reason يجب أن يكون نصاً.');
        }
        $value = trim($value);
        return $value === '' ? null : $value;
    }
}
