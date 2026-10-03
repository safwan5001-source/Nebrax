<?php

namespace App\Services\Commerce;

use App\Models\CommerceDeliveryBlockedDate;
use App\Models\CommerceDeliveryScheduleSetting;
use App\Models\CommerceDeliverySlot;
use App\Models\CommerceShippingZone;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use DomainException;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * FLOWERS-H7a / ADR-19 — سلطة جدولة التسليم الوحيدة (سياسة قناة + نوافذ + تواريخ محجوبة + توفّر مشتق).
 *
 * طبقة فوق سلطات الشحن/التنفيذ القائمة لا بديلٌ عنها: الوجهة تُحسم عبر `ShippingRateService::resolveZone`،
 * ولا شيء هنا يمسّ سعراً أو مخزوناً أو فاتورة أو قيداً. كل التواريخ تقويمية بمنطقة السياسة الزمنية
 * (`Y-m-d`) ولا ثقة بساعة العميل. غياب الإعداد أو تعطيله = `enabled:false` وبلا أي أثر على Checkout.
 */
final class CommerceDeliveryScheduleService
{
    public function __construct(private readonly ShippingRateService $shipping) {}

    // ── الإدارة ─────────────────────────────────────────────────────────

    /** @return array{enabled: bool, required: bool, timezone: string, lead_time_minutes: int, cutoff_time: ?string, max_days_ahead: int} */
    public function settings(string $salesChannelId): array
    {
        $setting = CommerceDeliveryScheduleSetting::query()->where('sales_channel_id', $salesChannelId)->first();

        return [
            'enabled' => (bool) ($setting?->is_enabled ?? false),
            'required' => (bool) ($setting?->is_required ?? true),
            'timezone' => $this->timezoneFor($setting),
            'lead_time_minutes' => (int) ($setting?->lead_time_minutes ?? 0),
            'cutoff_time' => $setting?->cutoff_time,
            'max_days_ahead' => (int) ($setting?->max_days_ahead ?? CommerceDeliveryScheduleSetting::DEFAULT_DAYS_AHEAD),
        ];
    }

    /**
     * @param  array{is_enabled?: bool, is_required?: bool, timezone?: ?string, lead_time_minutes?: int, cutoff_time?: ?string, max_days_ahead?: int}  $data
     */
    public function saveSettings(string $salesChannelId, array $data): array
    {
        $this->tenantId();

        // القفل والقراءة والحفظ في معاملة واحدة: خارجها يُحرَّر قفل القناة فور انتهاء SELECT (autocommit) فيرى
        // طلبان متزامنان «لا صفّ» ويتصادمان على الفهرس الفريد، فيُرفض أحدهما بدل أن يتسلسلا.
        DB::transaction(function () use ($salesChannelId, $data) {
            $this->lockChannel($salesChannelId);

            $setting = CommerceDeliveryScheduleSetting::query()->where('sales_channel_id', $salesChannelId)->first()
                ?? new CommerceDeliveryScheduleSetting(['sales_channel_id' => $salesChannelId]);
            $setting->fill(array_intersect_key($data, array_flip(['is_enabled', 'is_required', 'timezone', 'lead_time_minutes', 'cutoff_time', 'max_days_ahead'])));
            $setting->save();
        });

        return $this->settings($salesChannelId);
    }

    /** @return list<array<string, mixed>> */
    public function slots(string $salesChannelId): array
    {
        return CommerceDeliverySlot::query()
            ->where('sales_channel_id', $salesChannelId)
            ->orderBy('method')->orderBy('sort_order')->orderBy('start_time')
            ->get()
            ->map(fn (CommerceDeliverySlot $s) => [
                'id' => $s->id,
                'method' => $s->method,
                'label' => $s->label,
                'label_en' => $s->label_en,
                'start_time' => $s->start_time,
                'end_time' => $s->end_time,
                'weekdays' => $s->weekdays(),
                'capacity' => $s->capacity,
                'shipping_zone_id' => $s->shipping_zone_id,
                'sort_order' => $s->sort_order,
                'is_active' => $s->is_active,
            ])->values()->all();
    }

    /**
     * استبدال ذرّي لكل نوافذ القناة. الصفّ بلا `id` جديد؛ الأخير يُحذف إن غاب. (الطلبات القائمة تحمل لقطتها
     * ولا تشير إلى النافذة بمفتاح أجنبي حاجز.)
     *
     * @param  list<array<string, mixed>>  $slots
     * @return list<array<string, mixed>>
     */
    public function replaceSlots(string $salesChannelId, array $slots): array
    {
        $this->tenantId();
        if (count($slots) > CommerceDeliverySlot::MAX_PER_CHANNEL) {
            throw new DomainException('عدد النوافذ يتجاوز الحد المسموح للقناة.');
        }

        return DB::transaction(function () use ($salesChannelId, $slots) {
            $this->lockChannel($salesChannelId);

            $rows = [];
            foreach (array_values($slots) as $position => $slot) {
                $zoneId = $slot['shipping_zone_id'] ?? null;
                if ($zoneId !== null && ! CommerceShippingZone::query()->whereKey($zoneId)->exists()) {
                    throw new DomainException('منطقة الشحن غير موجودة لهذا المستأجر.');
                }

                $rows[] = [
                    'method' => $slot['method'],
                    'label' => trim((string) $slot['label']),
                    'label_en' => isset($slot['label_en']) && trim((string) $slot['label_en']) !== '' ? trim((string) $slot['label_en']) : null,
                    'start_time' => $slot['start_time'],
                    'end_time' => $slot['end_time'],
                    'weekday_mask' => $this->maskFrom($slot['weekdays'] ?? null),
                    'capacity' => $slot['capacity'] ?? null,
                    'shipping_zone_id' => $zoneId,
                    'sort_order' => $position,
                    'is_active' => (bool) ($slot['is_active'] ?? true),
                ];
            }

            try {
                CommerceDeliverySlot::query()->where('sales_channel_id', $salesChannelId)->delete();
                foreach ($rows as $row) {
                    CommerceDeliverySlot::create($row + ['sales_channel_id' => $salesChannelId]);
                }
            } catch (RuntimeException $e) {
                throw new DomainException($e->getMessage());
            }

            return $this->slots($salesChannelId);
        });
    }

    /** @return list<array{date: string, method: string, reason: ?string}> */
    public function blockedDates(string $salesChannelId): array
    {
        return CommerceDeliveryBlockedDate::query()
            ->where('sales_channel_id', $salesChannelId)
            ->orderBy('date')->orderBy('method')
            ->get()
            ->map(fn (CommerceDeliveryBlockedDate $b) => ['date' => $b->date, 'method' => $b->method, 'reason' => $b->reason])
            ->values()->all();
    }

    /**
     * @param  list<array{date: string, method?: string, reason?: ?string}>  $rows
     * @return list<array{date: string, method: string, reason: ?string}>
     */
    public function replaceBlockedDates(string $salesChannelId, array $rows): array
    {
        $this->tenantId();
        if (count($rows) > CommerceDeliveryBlockedDate::MAX_PER_CHANNEL) {
            throw new DomainException('عدد التواريخ المحجوبة يتجاوز الحد المسموح للقناة.');
        }

        $seen = [];
        foreach ($rows as $row) {
            $key = $row['date'].'|'.($row['method'] ?? CommerceDeliveryBlockedDate::METHOD_ALL);
            if (isset($seen[$key])) {
                throw new DomainException('لا يمكن تكرار التاريخ نفسه لنفس الطريقة.');
            }
            $seen[$key] = true;
        }

        return DB::transaction(function () use ($salesChannelId, $rows) {
            $this->lockChannel($salesChannelId);

            try {
                CommerceDeliveryBlockedDate::query()->where('sales_channel_id', $salesChannelId)->delete();
                foreach ($rows as $row) {
                    $reason = isset($row['reason']) ? trim((string) $row['reason']) : null;
                    CommerceDeliveryBlockedDate::create([
                        'sales_channel_id' => $salesChannelId,
                        'date' => $row['date'],
                        'method' => $row['method'] ?? CommerceDeliveryBlockedDate::METHOD_ALL,
                        'reason' => $reason === '' ? null : $reason,
                    ]);
                }
            } catch (RuntimeException $e) {
                throw new DomainException($e->getMessage());
            }

            return $this->blockedDates($salesChannelId);
        });
    }

    // ── التوفّر المشتق ───────────────────────────────────────────────────

    /**
     * الخيارات العامة المتاحة فعلاً الآن (نوافذ قابلة للاختيار فقط، بلا سعات ولا حقول داخلية). `$city`/`$region`
     * يرشّحان العرض فقط للتوصيل؛ إعادة التحقق عند الإتمام (H7b) تعتمد وجهة Checkout **المخزَّنة**.
     *
     * @return array{enabled: bool, required: bool, method: string, timezone: ?string, earliest: ?array{date: string, slot_id: string}, dates: list<array{date: string, slots: list<array<string, mixed>>}>}
     */
    public function options(string $salesChannelId, string $method, ?string $city = null, ?string $region = null, ?CarbonInterface $now = null): array
    {
        $setting = CommerceDeliveryScheduleSetting::query()->where('sales_channel_id', $salesChannelId)->first();
        if ($setting === null || ! $setting->is_enabled || ! in_array($method, CommerceDeliverySlot::METHODS, true)) {
            return ['enabled' => false, 'required' => false, 'method' => $method, 'timezone' => null, 'earliest' => null, 'dates' => []];
        }

        $timezone = $this->timezoneFor($setting);
        $local = CarbonImmutable::instance($now ?? CarbonImmutable::now())->setTimezone($timezone);
        $earliestInstant = $local->addMinutes($setting->lead_time_minutes);
        $cutoffPassed = $setting->cutoff_time !== null && $local->format('H:i') >= $setting->cutoff_time;

        $zoneId = $method === CommerceDeliverySlot::METHOD_DELIVERY ? $this->shipping->resolveZone($city, $region)?->id : null;
        $slots = CommerceDeliverySlot::query()
            ->where('sales_channel_id', $salesChannelId)
            ->where('method', $method)
            ->where('is_active', true)
            ->orderBy('sort_order')->orderBy('start_time')
            ->get()
            ->filter(fn (CommerceDeliverySlot $s) => $s->shipping_zone_id === null || $s->shipping_zone_id === $zoneId)
            ->values();

        $blocked = CommerceDeliveryBlockedDate::query()
            ->where('sales_channel_id', $salesChannelId)
            ->whereIn('method', [CommerceDeliveryBlockedDate::METHOD_ALL, $method])
            ->pluck('date')
            ->flip();

        $dates = [];
        $earliest = null;
        for ($offset = 0; $offset <= $setting->max_days_ahead; $offset++) {
            $day = $local->startOfDay()->addDays($offset);
            $date = $day->format('Y-m-d');
            if (isset($blocked[$date]) || ($offset === 0 && $cutoffPassed)) {
                continue;
            }

            $available = [];
            foreach ($slots as $slot) {
                if (! $slot->runsOn($day->dayOfWeek)) {
                    continue;
                }
                $start = $day->setTimeFromTimeString($slot->start_time);
                if ($start->lessThan($earliestInstant)) {
                    continue;
                }
                $available[] = [
                    'id' => $slot->id,
                    'label' => $slot->label,
                    'label_en' => $slot->label_en,
                    'start_time' => $slot->start_time,
                    'end_time' => $slot->end_time,
                ];
            }

            if ($available !== []) {
                $dates[] = ['date' => $date, 'slots' => $available];
                $earliest ??= ['date' => $date, 'slot_id' => $available[0]['id']];
            }
        }

        return [
            'enabled' => true,
            'required' => (bool) $setting->is_required,
            'method' => $method,
            'timezone' => $timezone,
            'earliest' => $earliest,
            'dates' => $dates,
        ];
    }

    // ── مساعدات ─────────────────────────────────────────────────────────

    private function timezoneFor(?CommerceDeliveryScheduleSetting $setting): string
    {
        if ($setting?->timezone !== null) {
            return $setting->timezone;
        }

        return Tenant::query()->whereKey($this->tenantId())->value('timezone') ?: 'Asia/Riyadh';
    }

    /** @param  list<int>|null  $weekdays 0 = الأحد … 6 = السبت؛ null/فارغ = كل الأيام */
    private function maskFrom(?array $weekdays): int
    {
        if ($weekdays === null || $weekdays === []) {
            return CommerceDeliverySlot::ALL_WEEKDAYS;
        }

        $mask = 0;
        foreach ($weekdays as $day) {
            if (! is_int($day) || $day < 0 || $day > 6) {
                throw new DomainException('أيام النافذة غير صالحة.');
            }
            $mask |= 1 << $day;
        }

        return $mask;
    }

    private function lockChannel(string $salesChannelId): void
    {
        if (SalesChannel::query()->whereKey($salesChannelId)->lockForUpdate()->first() === null) {
            throw new RuntimeException('قناة البيع غير موجودة.');
        }
    }

    private function tenantId(): string
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            throw new RuntimeException('لا سياق مستأجر نشط.');
        }

        return $tenantId;
    }
}
