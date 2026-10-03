<?php

namespace App\Services\Commerce;

use App\Models\CommerceCheckout;
use App\Models\CommerceCheckoutSchedule;
use App\Models\CommerceDeliveryBlockedDate;
use App\Models\CommerceDeliveryScheduleSetting;
use App\Models\CommerceDeliverySlot;
use App\Models\CommerceOrder;
use App\Models\CommerceOrderSchedule;
use App\Models\CommerceShippingZone;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use DateTimeZone;
use DomainException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use PDOException;
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
     * استبدال ذرّي لمجموعة نوافذ القناة **بالمعرّف**: صفٌّ بـ`id` موجود يُحدَّث في مكانه (فيبقى معرّفه، وتبقى
     * اختيارات Checkout المفتوحة وعدّ السعة التاريخي مربوطة به)، وبلا `id` يُنشأ، وما غاب من الطلب يُحذف.
     * معرّف لا يخصّ هذه القناة ⇒ رفض لا إنشاء بصمت.
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

        $ids = array_filter(array_column($slots, 'id'));
        if (count($ids) !== count(array_unique($ids))) {
            throw new DomainException('لا يمكن تكرار معرّف النافذة نفسه.');
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
                    'id' => $slot['id'] ?? null,
                    'attributes' => [
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
                    ],
                ];
            }

            try {
                $existing = CommerceDeliverySlot::query()->where('sales_channel_id', $salesChannelId)->lockForUpdate()->get()->keyBy('id');
                $keep = [];
                foreach ($rows as $row) {
                    if ($row['id'] !== null) {
                        $model = $existing[$row['id']] ?? throw new DomainException('نافذة غير موجودة لهذه القناة.');
                        $model->fill($row['attributes'])->save();
                        $keep[$model->id] = true;
                    } else {
                        $keep[CommerceDeliverySlot::create($row['attributes'] + ['sales_channel_id' => $salesChannelId])->id] = true;
                    }
                }
                foreach ($existing as $id => $model) {
                    if (! isset($keep[$id])) {
                        $model->delete();
                    }
                }
            } catch (PDOException $e) {
                // فشل قاعدة بيانات غير متوقع يبقى خطأ خادم — لا يُحوَّل إلى 422 يكشف نص SQL للعميل.
                throw $e;
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
            } catch (PDOException $e) {
                // فشل قاعدة بيانات غير متوقع يبقى خطأ خادم — لا يُحوَّل إلى 422 يكشف نص SQL للعميل.
                throw $e;
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
        $local = CarbonImmutable::instance($now ?? now())->setTimezone($timezone);
        // مهلة التجهيز زمنٌ منقضٍ حقيقي: بالثواني على الطابع الزمني لا `addMinutes()` — فحسابها الجداري/المنقضي عند
        // عبور انتقال التوقيت الصيفي يختلف بين إصدارات Carbon/PHP، والنتيجة هنا لا تتأثر بذلك.
        $earliestInstant = $local->setTimestamp($local->getTimestamp() + $setting->lead_time_minutes * 60);
        // الإغلاق اليومي لحظةٌ لا مقارنة نصية `H:i`: عند رجوع الساعة يتكرّر الوقت الجداري فيعود النص أصغر من الإغلاق
        // ويُعاد فتح اليوم بعد إغلاقه. اللحظة تُحسم على أول وقوع (EDT) فما إن تُجتاز تبقى مجتازة؛ وفي فجوة الانتقال
        // يُطبَّع الوقت الجداري المعدوم بإضافة طول الفجوة (02:30 ⇒ 03:30 EDT).
        $cutoffInstant = $setting->cutoff_time !== null ? $local->startOfDay()->setTimeFromTimeString($setting->cutoff_time) : null;
        $cutoffPassed = $cutoffInstant !== null && $local->greaterThanOrEqualTo($cutoffInstant);

        $ambiguous = $this->ambiguousWallClockIntervals($timezone, $local->startOfDay()->subDay(), $local->startOfDay()->addDays($setting->max_days_ahead + 2));

        $zoneId = $method === CommerceDeliverySlot::METHOD_DELIVERY ? $this->shipping->resolveZone($city, $region)?->id : null;
        $slots = CommerceDeliverySlot::query()
            ->where('sales_channel_id', $salesChannelId)
            ->where('method', $method)
            ->where('is_active', true)
            ->orderBy('sort_order')->orderBy('start_time')
            ->get()
            ->filter(fn (CommerceDeliverySlot $s) => $s->shipping_zone_id === null || $s->shipping_zone_id === $zoneId)
            ->values();

        // السعة: عدّ الحجوزات (لقطات الطلبات) لكل (نافذة، تاريخ) في المدى باستعلام مجمَّع واحد — بلا N+1 — لإخفاء النافذة
        // الممتلئة. السلطة النهائية للعدّ عند إنشاء الطلب تحت قفل صف النافذة (`snapshotToOrder`)؛ هذا للعرض والاختيار.
        $booked = [];
        $capacitySlotIds = $slots->filter(fn (CommerceDeliverySlot $s) => $s->capacity !== null)->pluck('id')->all();
        if ($capacitySlotIds !== []) {
            foreach (CommerceOrderSchedule::query()
                ->whereIn('commerce_delivery_slot_id', $capacitySlotIds)
                ->whereBetween('delivery_date', [$local->startOfDay()->format('Y-m-d'), $local->startOfDay()->addDays($setting->max_days_ahead)->format('Y-m-d')])
                ->selectRaw('commerce_delivery_slot_id as slot_id, delivery_date as booked_date, count(*) as booked_count')
                ->groupBy('commerce_delivery_slot_id', 'delivery_date')
                ->get() as $row) {
                $booked[$row->slot_id.'|'.$row->booked_date] = (int) $row->booked_count;
            }
        }

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
                if ($slot->capacity !== null && ($booked[$slot->id.'|'.$date] ?? 0) >= $slot->capacity) {
                    continue;
                }
                $start = $day->setTimeFromTimeString($slot->start_time);
                // وقت جداري غير موجود (فجوة الانتقال إلى التوقيت الصيفي: 02:30 تُطبَّع إلى 03:30) ⇒ لا نافذة في
                // هذا اليوم بدل عرض بدايةٍ لا تطابق اللحظة المحسوبة.
                // النهاية كذلك: `01:30–02:30` بدايتها موجودة ونهايتها لا، فتكون نقطةً نهائية مستحيلة للعميل واللقطة.
                if ($start->format('H:i') !== $slot->start_time
                    || $day->setTimeFromTimeString($slot->end_time)->format('H:i') !== $slot->end_time) {
                    continue;
                }
                // وقت جداري مكرَّر (ساعة الرجوع من التوقيت الصيفي) لا يحدّد لحظةً واحدة: يُهمَل في ذلك اليوم
                // كالفجوة، بدل أن يختار PHP إحدى اللحظتين بصمت فيُسقط الثانية أو يعرض لحظةً غامضة.
                if ($this->isAmbiguous($ambiguous, $date, $slot->start_time) || $this->isAmbiguous($ambiguous, $date, $slot->end_time)) {
                    continue;
                }
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
                if ($earliest === null) {
                    // الأبكر بوقت البداية لا بترتيب العرض (`sort_order` تقديمي قد لا يكون زمنياً)؛ التعادل للأسبق ترتيباً.
                    $first = $available[0];
                    foreach ($available as $candidate) {
                        if ($candidate['start_time'] < $first['start_time']) {
                            $first = $candidate;
                        }
                    }
                    $earliest = ['date' => $date, 'slot_id' => $first['id']];
                }
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

    // ── Checkout / Order (H7b) ──────────────────────────────────────────

    /** طريقة نافذة الجدولة المقابلة لطريقة Checkout (`standard` ⇒ `delivery`)؛ null لطريقة غير مختارة/غير معروفة. */
    public function slotMethodFor(?string $checkoutDeliveryMethod): ?string
    {
        return match ($checkoutDeliveryMethod) {
            'standard' => CommerceDeliverySlot::METHOD_DELIVERY,
            'pickup' => CommerceDeliverySlot::METHOD_PICKUP,
            default => null,
        };
    }

    /**
     * يضبط/يمسح اختيار موعد Checkout (داخل المعاملة وعلى الصف المقفول). `null/null` يمسح دوماً. غير ذلك: الجدولة
     * مفعَّلة، طريقة التوصيل مختارة، والموعد (تاريخ + نافذة) قابل للاختيار الآن لوجهة Checkout **المخزَّنة**.
     *
     * @return array{date: string, slot: ?array<string, mixed>, valid: bool}|null
     */
    public function applyToCheckout(CommerceCheckout $checkout, ?string $date, ?string $slotId): ?array
    {
        $existing = CommerceCheckoutSchedule::query()->where('commerce_checkout_id', $checkout->id)->first();

        if ($date === null && $slotId === null) {
            $existing?->delete();

            return null;
        }
        if ($date === null || $slotId === null) {
            throw ValidationException::withMessages(['schedule' => 'حدّد التاريخ والنافذة معاً.']);
        }
        if (! $this->settings($checkout->sales_channel_id)['enabled']) {
            throw ValidationException::withMessages(['schedule' => 'جدولة التسليم غير مفعّلة لهذا المتجر.']);
        }
        $method = $this->slotMethodFor($checkout->delivery_method);
        if ($method === null) {
            throw ValidationException::withMessages(['schedule' => 'اختر طريقة التوصيل أولاً.']);
        }
        $selected = $this->selectable($checkout, $method, $date, $slotId);
        if ($selected === null) {
            throw ValidationException::withMessages(['schedule' => 'الموعد المختار غير متاح.']);
        }

        $row = $existing ?? new CommerceCheckoutSchedule(['commerce_checkout_id' => $checkout->id]);
        $row->fill(['delivery_date' => $date, 'commerce_delivery_slot_id' => $selected['slot']['id']])->save();

        return ['date' => $date, 'slot' => $selected['slot'], 'valid' => true];
    }

    /**
     * الاختيار الحالي لـCheckout للعرض: `valid` يقول إن كان ما زال قابلاً للاختيار الآن (قد تتغيّر الطريقة أو الوجهة أو
     * السياسة بعده). null حين لا اختيار — فلا كلفة استعلام إضافية لـCheckout بلا جدولة.
     *
     * @return array{date: string, slot: ?array<string, mixed>, valid: bool}|null
     */
    public function forCheckout(CommerceCheckout $checkout): ?array
    {
        $row = CommerceCheckoutSchedule::query()->where('commerce_checkout_id', $checkout->id)->first();
        if ($row === null) {
            return null;
        }

        $method = $this->slotMethodFor($checkout->delivery_method);
        $selected = $method === null || $row->commerce_delivery_slot_id === null
            ? null
            : $this->selectable($checkout, $method, $row->delivery_date, $row->commerce_delivery_slot_id);

        return [
            'date' => $row->delivery_date,
            'slot' => $selected['slot'] ?? null,
            'valid' => $selected !== null,
        ];
    }

    /**
     * إعادة تحقق نهائية وقت الإتمام (قبل أي كتابة) بطريقة Checkout ووجهته **المخزَّنتين**. null = لا جدولة.
     * إلزامية الجدولة تسري على الطرق التي لها نوافذ نشطة فقط (طريقة بلا أي نافذة مهيّأة لا تُلزَم بموعد).
     *
     * @return array{method: string, delivery_date: string, slot_id: string, slot_label: string, slot_label_en: ?string, start_time: string, end_time: string, timezone: string}|null
     *
     * @throws CheckoutReviewRequiredException
     */
    public function resolveForCompletion(CommerceCheckout $checkout): ?array
    {
        $settings = $this->settings($checkout->sales_channel_id);
        $row = CommerceCheckoutSchedule::query()->where('commerce_checkout_id', $checkout->id)->first();

        if (! $settings['enabled']) {
            if ($row !== null) {
                throw new CheckoutReviewRequiredException('جدولة التسليم لم تعد متاحة — راجع الموعد.', [['item_id' => 'schedule', 'reason' => 'schedule_unavailable']]);
            }

            return null;
        }

        $method = $this->slotMethodFor($checkout->delivery_method);
        if ($row === null) {
            $needed = $settings['required'] && $method !== null && CommerceDeliverySlot::query()
                ->where('sales_channel_id', $checkout->sales_channel_id)->where('method', $method)->where('is_active', true)->exists();
            if ($needed) {
                throw new CheckoutReviewRequiredException('اختر موعد التسليم.', [['item_id' => 'schedule', 'reason' => 'schedule_required']]);
            }

            return null;
        }

        $selected = $method === null || $row->commerce_delivery_slot_id === null
            ? null
            : $this->selectable($checkout, $method, $row->delivery_date, $row->commerce_delivery_slot_id);
        if ($selected === null) {
            throw new CheckoutReviewRequiredException('الموعد المختار لم يعد متاحاً — اختر موعداً آخر.', [['item_id' => 'schedule', 'reason' => 'schedule_unavailable']]);
        }

        return [
            'method' => $method,
            'delivery_date' => $row->delivery_date,
            'slot_id' => $selected['slot']['id'],
            'slot_label' => $selected['slot']['label'],
            'slot_label_en' => $selected['slot']['label_en'],
            'start_time' => $selected['slot']['start_time'],
            'end_time' => $selected['slot']['end_time'],
            'timezone' => $selected['timezone'],
        ];
    }

    /**
     * يكتب لقطة الموعد الثابتة داخل معاملة إنشاء الطلب (قبل التأكيد) **تحت قفل صف النافذة**: العدّ بعد القفل، فلا
     * يأخذ طلبان متزامنان آخر مكانٍ معاً (الثاني ينتظر القفل ثم يرى حجز الأول). السعة الممتلئة ⇒ review-required.
     *
     * @param  array{method: string, delivery_date: string, slot_id: string, slot_label: string, slot_label_en: ?string, start_time: string, end_time: string, timezone: string}  $schedule
     *
     * @throws CheckoutReviewRequiredException
     */
    public function snapshotToOrder(CommerceOrder $order, array $schedule): CommerceOrderSchedule
    {
        $slot = CommerceDeliverySlot::query()->whereKey($schedule['slot_id'])->lockForUpdate()->first();
        if ($slot === null || ! $slot->is_active) {
            throw new CheckoutReviewRequiredException('الموعد المختار لم يعد متاحاً — اختر موعداً آخر.', [['item_id' => 'schedule', 'reason' => 'schedule_unavailable']]);
        }

        if ($slot->capacity !== null) {
            $booked = CommerceOrderSchedule::query()
                ->where('commerce_delivery_slot_id', $slot->id)
                ->where('delivery_date', $schedule['delivery_date'])
                ->count();
            if ($booked >= $slot->capacity) {
                throw new CheckoutReviewRequiredException('اكتملت سعة هذا الموعد — اختر موعداً آخر.', [['item_id' => 'schedule', 'reason' => 'schedule_unavailable']]);
            }
        }

        return $order->schedule()->create([
            'method' => $schedule['method'],
            'delivery_date' => $schedule['delivery_date'],
            'commerce_delivery_slot_id' => $slot->id,
            'slot_label' => $schedule['slot_label'],
            'slot_label_en' => $schedule['slot_label_en'],
            'start_time' => $schedule['start_time'],
            'end_time' => $schedule['end_time'],
            'timezone' => $schedule['timezone'],
        ]);
    }

    /** @return array{method: string, date: string, slot: array{label: string, label_en: ?string, start_time: string, end_time: string}, timezone: string} */
    public static function presentOrder(CommerceOrderSchedule $schedule): array
    {
        return [
            'method' => $schedule->method,
            'date' => $schedule->delivery_date,
            'slot' => [
                'label' => $schedule->slot_label,
                'label_en' => $schedule->slot_label_en,
                'start_time' => $schedule->start_time,
                'end_time' => $schedule->end_time,
            ],
            'timezone' => $schedule->timezone,
        ];
    }

    /**
     * النافذة المطلوبة إن كانت قابلة للاختيار الآن لطريقة Checkout ووجهته المخزَّنة (المصدر الوحيد: `options()`).
     *
     * @return array{slot: array<string, mixed>, timezone: string}|null
     */
    private function selectable(CommerceCheckout $checkout, string $method, string $date, string $slotId): ?array
    {
        $options = $this->options($checkout->sales_channel_id, $method, $checkout->delivery_city, $checkout->delivery_region);
        if (! $options['enabled']) {
            return null;
        }

        foreach ($options['dates'] as $day) {
            if ($day['date'] !== $date) {
                continue;
            }
            foreach ($day['slots'] as $slot) {
                if ($slot['id'] === $slotId) {
                    return ['slot' => $slot, 'timezone' => (string) $options['timezone']];
                }
            }
        }

        return null;
    }

    /**
     * فترات الأوقات الجدارية المتكرّرة (عند رجوع الساعة) ضمن النطاق، بثواني «الحائط المحلي» منذ epoch
     * (لحظة الانتقال + الإزاحة الجديدة ≤ w < لحظة الانتقال + الإزاحة السابقة). مصدرها بيانات المنطقة نفسها
     * لا سلوك PHP الضمني. بلا انتقالات (مثل UTC) ⇒ مصفوفة فارغة.
     *
     * @return list<array{0: int, 1: int}>
     */
    private function ambiguousWallClockIntervals(string $timezone, CarbonInterface $from, CarbonInterface $to): array
    {
        $transitions = (new DateTimeZone($timezone))->getTransitions($from->getTimestamp(), $to->getTimestamp());
        $intervals = [];
        for ($i = 1, $n = count($transitions); $i < $n; $i++) {
            $before = $transitions[$i - 1]['offset'];
            $after = $transitions[$i]['offset'];
            if ($after < $before) {
                $intervals[] = [$transitions[$i]['ts'] + $after, $transitions[$i]['ts'] + $before];
            }
        }

        return $intervals;
    }

    /** @param  list<array{0: int, 1: int}>  $intervals */
    private function isAmbiguous(array $intervals, string $date, string $time): bool
    {
        if ($intervals === []) {
            return false;
        }

        $wall = CarbonImmutable::parse("{$date} {$time}:00", 'UTC')->getTimestamp();
        foreach ($intervals as [$start, $end]) {
            if ($wall >= $start && $wall < $end) {
                return true;
            }
        }

        return false;
    }

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
