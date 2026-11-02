<?php

namespace App\Services\Commerce;

use App\Models\CommerceOrder;
use App\Models\CommerceOrderEvent;
use App\Models\CommerceOrderFulfillment;
use App\Models\CommercePaymentIntent;
use App\Models\InventoryReservation;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  COPS-H2-1 — تنفيذ طلب المتجر (ADR-29 §2.3 · خطة H2-0 §2) — **الكاتب الوحيد** لـ`commerce_order_fulfillments`
 * ═══════════════════════════════════════════════════════════════
 *
 * آلة الحالة (الأضلاع نفسها في حراس القاعدة):
 *   (لا صف) ─start→ preparing ─mark_ready→ ready ;  (لا صف) ─mark_ready→ ready
 *   ready ─dispatch→ out_for_delivery ─deliver→ delivered ;  out_for_delivery ─fail→ delivery_failed ─dispatch→ out_for_delivery
 *   delivery_failed ─return→ returned_to_store ─dispatch→ out_for_delivery ;  ready ─pickup→ picked_up (نوع pickup)
 * لا إعادة فتح لـ`delivered`/`picked_up`، ولا إجراء إغلاق/إلغاء/استرداد/شطب لحالة تعذّر الرجوع (AR-1 — قرار H6-2).
 *
 * **الأقفال (لا تُعكس):** النية ← الطلب ← صف التنفيذ ← (آخراً) رأس تغذية الأحداث. الحدث آخر كتابة في المعاملة. لا شبكة ولا خدمة محاسبية/مخزنية/حجز هنا
 * (يحرسه اختبار ساكن): التنفيذ عمل تشغيلي لا أثر له على قيد أو مخزون أو فاتورة أو حجز.
 *
 * **كل انتقال** يعيد فحص الطلب غير الملغى **ونية قائمة غير ملغاة بحالة جاهزة** تحت قفل النية والطلب (نية COD تُلغى وحدها بالمسار القديم فلا يمضي
 * التنفيذ بعدها). البدء يزيد: القبول الفعّال (R-5). المخزن: مخزن حجز الطلب إن وُجد وإلا سياسة القناة وإلا رفض صريح — بلا بديل.
 *
 * **idempotency/نسخة (D-H2-22):** الهدف المتحقق ⇒ يُعاد الصف بلا أثر ولا حدث؛ وإلا `expected_version` إلزامي (428) ويُرفض غير المطابق (409 + الحالة).
 */
final class CommerceOrderFulfillmentService
{
    /** الإجراء ⇒ الحالة الهدف. */
    public const TARGETS = [
        'start' => CommerceOrderFulfillment::PREPARING,
        'mark_ready' => CommerceOrderFulfillment::READY,
        'dispatch' => CommerceOrderFulfillment::OUT_FOR_DELIVERY,
        'deliver' => CommerceOrderFulfillment::DELIVERED,
        'fail' => CommerceOrderFulfillment::DELIVERY_FAILED,
        'return' => CommerceOrderFulfillment::RETURNED_TO_STORE,
        'pickup' => CommerceOrderFulfillment::PICKED_UP,
    ];

    /** الإجراء ⇒ الحالات المصدر (`null` = لا صف). */
    private const FROM = [
        'start' => [null],
        'mark_ready' => [null, CommerceOrderFulfillment::PREPARING],
        'dispatch' => [CommerceOrderFulfillment::READY, CommerceOrderFulfillment::DELIVERY_FAILED, CommerceOrderFulfillment::RETURNED_TO_STORE],
        'deliver' => [CommerceOrderFulfillment::OUT_FOR_DELIVERY],
        'fail' => [CommerceOrderFulfillment::OUT_FOR_DELIVERY],
        'return' => [CommerceOrderFulfillment::DELIVERY_FAILED],
        'pickup' => [CommerceOrderFulfillment::READY],
    ];

    private const EVENTS = [
        'start' => CommerceOrderEvent::FULFILLMENT_STARTED,
        'mark_ready' => CommerceOrderEvent::FULFILLMENT_READY,
        'dispatch' => CommerceOrderEvent::FULFILLMENT_DISPATCHED,
        'deliver' => CommerceOrderEvent::FULFILLMENT_DELIVERED,
        'fail' => CommerceOrderEvent::FULFILLMENT_DELIVERY_FAILED,
        'return' => CommerceOrderEvent::FULFILLMENT_RETURNED,
        'pickup' => CommerceOrderEvent::FULFILLMENT_PICKED_UP,
    ];

    /** مفاتيح التفاصيل المقبولة ⇒ العمود ⇒ رمز قصير للحدث (`fields` ≤ 64 حرفاً). */
    private const DETAIL_COLUMNS = [
        'type' => ['type', 'type'],
        'carrier_name' => ['carrier_name', 'carrier'],
        'tracking_number' => ['tracking_number', 'number'],
        'tracking_url' => ['tracking_url', 'url'],
        'courier_name' => ['courier_name', 'courier'],
        'courier_phone' => ['courier_phone', 'phone'],
        'note' => ['last_failure_note', 'note'],
    ];

    public function __construct(
        private readonly CommerceOrderEventRecorder $events,
        private readonly FulfillmentPolicyService $policy,
    ) {}

    /**
     * @param  array<string, mixed>  $input  `reason`/`note` (fail) وتفاصيل اختيارية (carrier_name, tracking_number, tracking_url, courier_name, courier_phone)
     *
     * @throws CommerceOrderFulfillmentException
     */
    public function act(CommerceOrder $order, User $actor, string $action, ?int $expectedVersion, array $input = []): CommerceOrderFulfillment
    {
        if (! isset(self::TARGETS[$action])) {
            throw new CommerceOrderFulfillmentException(CommerceOrderFulfillmentException::INVALID_INPUT, 'إجراء تنفيذ غير معروف.', 422);
        }
        if ($expectedVersion === null) {
            throw new CommerceOrderFulfillmentException(CommerceOrderFulfillmentException::VERSION_REQUIRED, 'نسخة التنفيذ المتوقعة مطلوبة.', 428);
        }
        $details = $this->normalizeDetails($input, allowType: false);
        $failureReason = null;
        if ($action === 'fail') {
            $failureReason = $input['reason'] ?? null;
            if (! is_string($failureReason) || ! in_array($failureReason, CommerceOrderFulfillment::FAILURE_REASONS, true)) {
                throw new CommerceOrderFulfillmentException(CommerceOrderFulfillmentException::INVALID_INPUT, 'سبب فشل التوصيل مطلوب من القائمة المعتمدة.', 422);
            }
        }

        return DB::transaction(function () use ($order, $actor, $action, $expectedVersion, $details, $failureReason, $input): CommerceOrderFulfillment {
            // 1) النية ← 2) الطلب ← 3) صف التنفيذ (لا عكس). نطاق المستأجر مطبَّق على الاستعلامات.
            $intent = CommercePaymentIntent::query()->where('commerce_order_id', $order->id)->lockForUpdate()->first();
            $locked = CommerceOrder::query()->whereKey($order->id)->lockForUpdate()->firstOrFail();
            $row = CommerceOrderFulfillment::query()->where('commerce_order_id', $locked->id)->lockForUpdate()->first();
            $target = self::TARGETS[$action];

            // COPS-H2-2 (Codex): نطاق المخازن يُعاد التحقق منه هنا تحت الأقفال. صف قائم ⇒ مخزنه ثابت (يُفحص بـSQL الرؤية)؛ لا صف ⇒ المخزن المحلول الذي سيُكتب هو نفسه
            // الذي يُفحص، فلا يُكتب تنفيذ خارج نطاق الفاعل حتى لو تغيّرت السياسة بعد البحث المقيَّد. غير المقيَّد لا يتأثر.
            $newWarehouseId = null;
            if ($actor->allowedWarehouseIds() !== null) {
                if ($row === null) {
                    try {
                        $newWarehouseId = $this->resolveWarehouseId($locked);
                    } catch (CommerceOrderFulfillmentException) {
                        $newWarehouseId = null; // بلا مخزن فعّال ⇒ الطلب غير مرئي للمقيَّد أصلاً
                    }
                    CommerceOrderWarehouseScope::assertWarehouseAllowed($newWarehouseId, $actor);
                } else {
                    CommerceOrderWarehouseScope::assertVisible($locked, $actor);
                }
            }

            // الهدف متحقق أصلاً ⇒ idempotent: لا أثر ولا حدث ولا تغيير للفاعل/الوقت.
            if ($row !== null && $row->status === $target) {
                return $row;
            }

            $this->assertVersion($row, $expectedVersion);
            if (($reason = $this->eligibilityBlocker($locked, $intent, $row)) !== null) {
                throw $this->blocked($reason);
            }
            $this->assertEdge($row, $action);

            if ($action === 'dispatch') {
                $effectiveCarrier = array_key_exists('carrier_name', $details) ? $details['carrier_name'] : $row?->carrier_name;
                if ($row?->type === CommerceOrderFulfillment::TYPE_CARRIER && ($effectiveCarrier === null || trim((string) $effectiveCarrier) === '')) {
                    throw new CommerceOrderFulfillmentException(CommerceOrderFulfillmentException::INVALID_INPUT, 'اسم الناقل مطلوب لإرسال شحنة ناقل.', 422);
                }
            }

            $now = now('UTC');
            $changes = $details + $this->stampsFor($action, $now, $row, $failureReason, $input['note'] ?? null);

            if ($row === null) {
                $row = new CommerceOrderFulfillment();
                $row->forceFill($changes + [
                    'tenant_id' => $locked->tenant_id,
                    'commerce_order_id' => $locked->id,
                    'warehouse_id' => $newWarehouseId ?? $this->resolveWarehouseId($locked),
                    'type' => $locked->delivery_method === 'pickup' ? CommerceOrderFulfillment::TYPE_PICKUP : CommerceOrderFulfillment::TYPE_LOCAL_DELIVERY,
                    'status' => $target,
                    'version' => 1,
                    'delivery_attempts' => 0,
                    'created_by_user_id' => $actor->id,
                    'updated_by_user_id' => $actor->id,
                ])->save();
            } else {
                if ($action === 'fail') {
                    $changes['delivery_attempts'] = (int) $row->delivery_attempts + 1;
                }
                $row->forceFill($changes + [
                    'status' => $target,
                    'version' => (int) $row->version + 1,
                    'updated_by_user_id' => $actor->id,
                ])->save();
            }

            // بيانات الحدث: قائمة بيضاء بلا ناقل/تتبع/ساعٍ/ملاحظة.
            $data = match ($action) {
                'dispatch' => ['type' => (string) $row->type, 'attempt' => (string) ((int) $row->delivery_attempts + 1)],
                'fail' => ['reason' => (string) $row->last_failure_reason, 'attempt' => (string) (int) $row->delivery_attempts],
                default => [],
            };

            // آخر كتابة في المعاملة: رأس التغذية آخر قفل (ADR-29 §2.4).
            $this->events->append($locked, self::EVENTS[$action], CommerceOrderEvent::ACTOR_USER, (string) $actor->id, $data);

            return $row->fresh();
        });
    }

    /**
     * تحديث تفاصيل الناقل/التتبع/الساعي/الملاحظة وتبديل `local_delivery↔carrier` قبل الإرسال — بلا تغيير حالة. غير النهائي فقط.
     *
     * @param  array<string, mixed>  $input
     *
     * @throws CommerceOrderFulfillmentException
     */
    public function updateDetails(CommerceOrder $order, User $actor, ?int $expectedVersion, array $input): CommerceOrderFulfillment
    {
        if ($expectedVersion === null) {
            throw new CommerceOrderFulfillmentException(CommerceOrderFulfillmentException::VERSION_REQUIRED, 'نسخة التنفيذ المتوقعة مطلوبة.', 428);
        }
        $details = $this->normalizeDetails($input, allowType: true);
        if ($details === []) {
            throw new CommerceOrderFulfillmentException(CommerceOrderFulfillmentException::INVALID_INPUT, 'لا حقل تفاصيل للتحديث.', 422);
        }

        return DB::transaction(function () use ($order, $actor, $expectedVersion, $details): CommerceOrderFulfillment {
            CommercePaymentIntent::query()->where('commerce_order_id', $order->id)->lockForUpdate()->first();
            $locked = CommerceOrder::query()->whereKey($order->id)->lockForUpdate()->firstOrFail();
            $row = CommerceOrderFulfillment::query()->where('commerce_order_id', $locked->id)->lockForUpdate()->first();
            CommerceOrderWarehouseScope::assertVisible($locked, $actor); // COPS-H2-2 (Codex): نطاق المخازن تحت الأقفال

            if ($row === null) {
                throw new CommerceOrderFulfillmentException(CommerceOrderFulfillmentException::NOT_STARTED, 'لم يبدأ تنفيذ هذا الطلب بعد.');
            }
            $this->assertVersion($row, $expectedVersion);
            if ($locked->isCancelled()) {
                throw $this->blocked(CommerceOrderFulfillmentException::ALREADY_CANCELLED);
            }
            if ($row->isTerminal()) {
                throw new CommerceOrderFulfillmentException(CommerceOrderFulfillmentException::TERMINAL, 'اكتمل تنفيذ هذا الطلب؛ لا تعديل بعده.');
            }
            if (array_key_exists('type', $details)) {
                if ($row->type === CommerceOrderFulfillment::TYPE_PICKUP
                    || ! in_array($row->status, [CommerceOrderFulfillment::PREPARING, CommerceOrderFulfillment::READY, CommerceOrderFulfillment::RETURNED_TO_STORE], true)) {
                    throw new CommerceOrderFulfillmentException(CommerceOrderFulfillmentException::INVALID_TRANSITION, 'يُبدَّل نوع التوصيل قبل الإرسال فقط (ولا يتبدّل الاستلام).', 409, ['current_status' => $row->status]);
                }
            }
            if (array_key_exists('last_failure_note', $details) && $row->last_failure_reason === null) {
                throw new CommerceOrderFulfillmentException(CommerceOrderFulfillmentException::INVALID_INPUT, 'الملاحظة الداخلية تخص فشل توصيل مسجَّلاً.', 422);
            }

            $changed = [];
            foreach ($details as $column => $value) {
                if ($row->{$column} !== $value) {
                    $changed[$column] = $value;
                }
            }
            if ($changed === []) {
                return $row; // لا تغيير فعلي: لا نسخة جديدة ولا حدث.
            }

            $row->forceFill($changed + ['version' => (int) $row->version + 1, 'updated_by_user_id' => $actor->id])->save();
            $codes = [];
            foreach (self::DETAIL_COLUMNS as [$column, $code]) {
                if (array_key_exists($column, $changed)) {
                    $codes[] = $code;
                }
            }
            $this->events->append($locked, CommerceOrderEvent::FULFILLMENT_DETAILS_UPDATED, CommerceOrderEvent::ACTOR_USER, (string) $actor->id, ['fields' => implode(',', $codes)]);

            return $row->fresh();
        });
    }

    /**
     * الإجراءات التالية الصالحة بالأضلاع، مع `available`/`blocked_reason` (قراءة بلا أقفال — استرشادي؛ القرار النهائي للإجراء تحت الأقفال).
     * طلب ملغى أو تنفيذ مكتمل ⇒ قائمة فارغة.
     *
     * @return list<array{action: string, available: bool, blocked_reason: ?string}>
     */
    public function actions(CommerceOrder $order): array
    {
        if ($order->isCancelled()) {
            return [];
        }
        $row = $order->relationLoaded('fulfillment') ? $order->fulfillment : $order->fulfillment()->first();
        if ($row !== null && $row->isTerminal()) {
            return [];
        }
        $intent = $order->relationLoaded('paymentIntent') ? $order->paymentIntent : $order->paymentIntent()->first();
        $blocked = $this->eligibilityBlocker($order, $intent, $row);

        $out = [];
        foreach (self::FROM as $action => $sources) {
            if (! in_array($row?->status, $sources, true)) {
                continue;
            }
            if ($action === 'dispatch' && $row?->type === CommerceOrderFulfillment::TYPE_PICKUP) {
                continue;
            }
            if ($action === 'pickup' && $row?->type !== CommerceOrderFulfillment::TYPE_PICKUP) {
                continue;
            }
            $out[] = ['action' => $action, 'available' => $blocked === null, 'blocked_reason' => $blocked];
        }

        return $out;
    }

    /** سبب المنع على مستوى الطلب/الدفع/القبول (null = مؤهَّل). يُستعمل تحت الأقفال وللمعاينة. */
    private function eligibilityBlocker(CommerceOrder $order, ?CommercePaymentIntent $intent, ?CommerceOrderFulfillment $row): ?string
    {
        if ($order->isCancelled()) {
            return CommerceOrderFulfillmentException::ALREADY_CANCELLED;
        }
        if (! $order->isConfirmed()) {
            return CommerceOrderFulfillmentException::NOT_CONFIRMED;
        }
        if ($intent === null) {
            return CommerceOrderFulfillmentException::PAYMENT_NOT_READY;
        }
        if ($intent->isCancelled()) {
            return CommerceOrderFulfillmentException::PAYMENT_CANCELLED;
        }
        if (! in_array($intent->status, CommerceOrderAttentionQuery::PAYMENT_READY, true)) {
            return CommerceOrderFulfillmentException::PAYMENT_PENDING;
        }
        // القبول يُشترط عند البدء فقط (لا يرتدّ بعده).
        if ($row === null && $order->effectiveAcceptanceMode() === CommerceOrder::ACCEPTANCE_MANUAL && ! $order->isAccepted()) {
            return CommerceOrderFulfillmentException::AWAITING_ACCEPTANCE;
        }

        return null;
    }

    private function blocked(string $reason): CommerceOrderFulfillmentException
    {
        $messages = [
            CommerceOrderFulfillmentException::ALREADY_CANCELLED => 'أُلغي هذا الطلب؛ لا يمكن متابعة تنفيذه.',
            CommerceOrderFulfillmentException::NOT_CONFIRMED => 'لا يمكن تنفيذ طلب غير مؤكَّد.',
            CommerceOrderFulfillmentException::PAYMENT_NOT_READY => 'لا توجد طريقة دفع قائمة لهذا الطلب؛ لا يمكن تنفيذه.',
            CommerceOrderFulfillmentException::PAYMENT_CANCELLED => 'أُلغي التزام دفع هذا الطلب؛ لا يمكن متابعة تنفيذه. ألغِ الطلب إن لزم.',
            CommerceOrderFulfillmentException::PAYMENT_PENDING => 'لم يكتمل الدفع الإلكتروني لهذا الطلب بعد؛ يبدأ التنفيذ بعد تأكيد الدفع.',
            CommerceOrderFulfillmentException::AWAITING_ACCEPTANCE => 'هذا الطلب بانتظار قبول التاجر؛ يبدأ التنفيذ بعد القبول.',
        ];

        return new CommerceOrderFulfillmentException(
            $reason,
            $messages[$reason] ?? 'لا يمكن متابعة تنفيذ هذا الطلب الآن.',
            $reason === CommerceOrderFulfillmentException::NOT_CONFIRMED ? 422 : 409,
        );
    }

    private function assertVersion(?CommerceOrderFulfillment $row, int $expected): void
    {
        $current = $row === null ? 0 : (int) $row->version;
        if ($expected !== $current) {
            throw new CommerceOrderFulfillmentException(
                CommerceOrderFulfillmentException::VERSION_CONFLICT,
                'تغيّر تنفيذ هذا الطلب منذ آخر قراءة؛ حدّث الصفحة.',
                409,
                ['current_version' => $current, 'current_status' => $row?->status],
            );
        }
    }

    private function assertEdge(?CommerceOrderFulfillment $row, string $action): void
    {
        $status = $row?->status;
        if ($row !== null && $row->isTerminal()) {
            throw new CommerceOrderFulfillmentException(CommerceOrderFulfillmentException::TERMINAL, 'اكتمل تنفيذ هذا الطلب؛ لا إجراء بعده.', 409, ['current_status' => $status]);
        }
        $valid = in_array($status, self::FROM[$action], true)
            && ! ($action === 'dispatch' && $row?->type === CommerceOrderFulfillment::TYPE_PICKUP)
            && ! ($action === 'pickup' && $row?->type !== CommerceOrderFulfillment::TYPE_PICKUP);
        if (! $valid) {
            throw new CommerceOrderFulfillmentException(CommerceOrderFulfillmentException::INVALID_TRANSITION, 'هذا الإجراء غير متاح في حالة التنفيذ الحالية.', 409, ['current_status' => $status]);
        }
    }

    /**
     * @param  ?string  $note
     * @return array<string, mixed>
     */
    private function stampsFor(string $action, \Illuminate\Support\Carbon $now, ?CommerceOrderFulfillment $row, ?string $failureReason, mixed $note): array
    {
        return match ($action) {
            'start' => ['preparing_at' => $now],
            'mark_ready' => ['ready_at' => $now],
            'dispatch' => ['last_dispatched_at' => $now] + ($row?->first_dispatched_at === null ? ['first_dispatched_at' => $now] : []),
            'deliver' => ['delivered_at' => $now],
            'fail' => ['last_failed_at' => $now, 'last_failure_reason' => $failureReason, 'last_failure_note' => $this->noteOrNull($note)],
            'return' => ['last_returned_at' => $now],
            'pickup' => ['picked_up_at' => $now],
        };
    }

    private function noteOrNull(mixed $note): ?string
    {
        if (! is_string($note) || trim($note) === '') {
            return null;
        }
        $note = trim($note);
        if (mb_strlen($note) > 500 || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', $note) === 1) {
            throw new CommerceOrderFulfillmentException(CommerceOrderFulfillmentException::INVALID_INPUT, 'الملاحظة أطول من المسموح أو تحوي رموزاً غير مقبولة.', 422);
        }

        return $note;
    }

    /**
     * مخزن الحجز إن وُجد (الإلكتروني)، وإلا مخزن سياسة القناة؛ تعذّر الحسم ⇒ رفض صريح بلا بديل (D-H2-10).
     */
    private function resolveWarehouseId(CommerceOrder $order): string
    {
        $reserved = InventoryReservation::query()
            ->where('source_type', CommerceOrder::class)->where('source_id', $order->id)
            ->orderBy('created_at')->orderBy('id')->value('warehouse_id');
        if (is_string($reserved) && $reserved !== '') {
            return $reserved;
        }
        try {
            return (string) $this->policy->resolveWarehouseFor((string) $order->sales_channel_id)->id;
        } catch (RuntimeException) {
            throw new CommerceOrderFulfillmentException(CommerceOrderFulfillmentException::POLICY_MISSING, 'لا يوجد مخزن تنفيذ صالح لهذه القناة؛ اضبط مخزن التنفيذ أولاً.');
        }
    }

    /**
     * يتحقق من تفاصيل الناقل/التتبع/الساعي/الملاحظة ويُطبّعها. يعيد `عمود ⇒ قيمة` للمفاتيح الحاضرة فقط (قيمة فارغة ⇒ null = مسح).
     *
     * @param  array<string, mixed>  $input
     * @return array<string, ?string>
     */
    private function normalizeDetails(array $input, bool $allowType): array
    {
        $out = [];
        foreach (self::DETAIL_COLUMNS as $key => [$column]) {
            if (! array_key_exists($key, $input)) {
                continue;
            }
            if ($key === 'type' && ! $allowType) {
                throw new CommerceOrderFulfillmentException(CommerceOrderFulfillmentException::INVALID_INPUT, 'يُبدَّل نوع التوصيل بتحديث التفاصيل قبل الإرسال، لا مع الإجراء.', 422);
            }
            if ($key === 'note' && $allowType === false) {
                continue; // ملاحظة الفشل تُمرَّر عبر `fail` فقط.
            }
            $value = $input[$key];
            if ($value !== null && ! is_string($value)) {
                throw new CommerceOrderFulfillmentException(CommerceOrderFulfillmentException::INVALID_INPUT, "قيمة {$key} غير صالحة.", 422);
            }
            $value = $value === null ? null : trim($value);
            if ($value === '') {
                $value = null;
            }
            if ($value !== null) {
                if (preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', $value) === 1) {
                    throw new CommerceOrderFulfillmentException(CommerceOrderFulfillmentException::INVALID_INPUT, "قيمة {$key} تحوي رموزاً غير مقبولة.", 422);
                }
                $value = $this->validated($key, $value);
            }
            $out[$column] = $value;
        }
        if (array_key_exists('type', $out) && $out['type'] === null) {
            throw new CommerceOrderFulfillmentException(CommerceOrderFulfillmentException::INVALID_INPUT, 'نوع التوصيل مطلوب.', 422);
        }

        return $out;
    }

    private function validated(string $key, string $value): string
    {
        $fail = fn (string $m) => new CommerceOrderFulfillmentException(CommerceOrderFulfillmentException::INVALID_INPUT, $m, 422);
        switch ($key) {
            case 'type':
                if (! in_array($value, [CommerceOrderFulfillment::TYPE_LOCAL_DELIVERY, CommerceOrderFulfillment::TYPE_CARRIER], true)) {
                    throw $fail('نوع التوصيل غير معتمد.');
                }

                return $value;
            case 'carrier_name':
            case 'tracking_number':
            case 'courier_name':
                if (mb_strlen($value) > 100) {
                    throw $fail("{$key} أطول من 100 حرف.");
                }

                return $value;
            case 'tracking_url':
                if (strlen($value) > 500 || preg_match('/\s/', $value) === 1 || filter_var($value, FILTER_VALIDATE_URL) === false
                    || ! str_starts_with(strtolower($value), 'https://') || parse_url($value, PHP_URL_HOST) === null) {
                    throw $fail('رابط التتبع يجب أن يكون https صالحاً (≤ 500 حرف).');
                }

                // يُخزَّن المخطط بحروف صغيرة دائماً: حارس القاعدة (PostgreSQL) حساس لحالة الأحرف `^https://`، فلا يقبل التطبيق ما يرفضه المحرّك (`HTTPS://…`).
                return 'https://'.substr($value, 8);
            case 'courier_phone':
                $digits = strtr($value, ['٠' => '0', '١' => '1', '٢' => '2', '٣' => '3', '٤' => '4', '٥' => '5', '٦' => '6', '٧' => '7', '٨' => '8', '٩' => '9',
                    '۰' => '0', '۱' => '1', '۲' => '2', '۳' => '3', '۴' => '4', '۵' => '5', '۶' => '6', '۷' => '7', '۸' => '8', '۹' => '9']);
                if (preg_match('/\A\+?[0-9]{7,15}\z/', $digits) !== 1) {
                    throw $fail('رقم هاتف الساعي غير صالح (7–15 رقماً، 0–9 لاتينية).');
                }

                return $digits;
            case 'note':
                if (mb_strlen($value) > 500) {
                    throw $fail('الملاحظة أطول من 500 حرف.');
                }

                return $value;
        }

        throw $fail('حقل غير معروف.');
    }
}
