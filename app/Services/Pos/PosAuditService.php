<?php

namespace App\Services\Pos;

use App\Models\PosOverrideApproval;
use App\Models\PosReasonCode;
use App\Models\PosSession;
use App\Models\PosSessionEvent;
use App\Models\User;
use App\Support\PosSettings;
use App\Tenancy\BranchContext;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * طبقة دليل POS موحدة فوق PosSessionEvent القائم.
 *
 * لا تنشئ هذه الخدمة مستندات مالية أو قيوداً أو حركات مخزون. كل دليل حساس صف
 * جديد append-only؛ أما PosOverrideApproval فهو إسقاط حالة محدود يمنع استهلاك
 * موافقة واحدة مرتين، وتوثق انتقالاته في PosSessionEvent أيضاً.
 */
final class PosAuditService
{
    /** @var array<string, string> */
    private const CATEGORIES = [
        PosSessionEvent::TYPE_CART_CREATED => 'cart',
        PosSessionEvent::TYPE_ITEM_ADDED => 'cart',
        PosSessionEvent::TYPE_ITEM_REMOVED => 'cart',
        PosSessionEvent::TYPE_ITEM_QUANTITY_CHANGED => 'cart',
        PosSessionEvent::TYPE_PRICE_OVERRIDDEN => 'price',
        PosSessionEvent::TYPE_DISCOUNT_APPLIED => 'discount',
        PosSessionEvent::TYPE_DISCOUNT_CHANGED => 'discount',
        PosSessionEvent::TYPE_DISCOUNT_REMOVED => 'discount',
        PosSessionEvent::TYPE_CUSTOMER_CHANGED => 'cart',
        PosSessionEvent::TYPE_PAYMENT_STARTED => 'payment',
        PosSessionEvent::TYPE_PAYMENT_CANCELLED => 'payment',
        PosSessionEvent::TYPE_PAYMENT_FAILED => 'payment',
        PosSessionEvent::TYPE_CART_HELD => 'cart',
        PosSessionEvent::TYPE_CART_RESUMED => 'cart',
        PosSessionEvent::TYPE_CART_DISCARDED => 'cart',
        PosSessionEvent::TYPE_CART_CANCELLED => 'cart',
        PosSessionEvent::TYPE_CHECKOUT_STARTED => 'checkout',
        PosSessionEvent::TYPE_CHECKOUT_COMPLETED => 'checkout',
        PosSessionEvent::TYPE_CLOSING_COUNT_SUBMITTED => 'cash_count',
        PosSessionEvent::TYPE_CLOSING_COUNT_REVEALED => 'cash_count',
        PosSessionEvent::TYPE_CLOSING_COUNT_RECOUNTED => 'cash_count',
        PosSessionEvent::TYPE_OVERRIDE_REQUESTED => 'approval',
        PosSessionEvent::TYPE_OVERRIDE_APPROVED => 'approval',
        PosSessionEvent::TYPE_OVERRIDE_CONSUMED => 'approval',
        PosSessionEvent::TYPE_CASH_IN_RECORDED => 'cash_movement',
        PosSessionEvent::TYPE_CASH_OUT_RECORDED => 'cash_movement',
        PosSessionEvent::TYPE_RETURN_RECORDED => 'return',
        PosSessionEvent::TYPE_EXCHANGE_RECORDED => 'exchange',
        PosSessionEvent::TYPE_CLOSING_DIFFERENCE_REQUIRES_ACKNOWLEDGEMENT => 'cash_count',
        PosSessionEvent::TYPE_CLOSING_DIFFERENCE_ACKNOWLEDGED => 'cash_count',
        PosSessionEvent::TYPE_CLOSING_DIFFERENCE_SETTLED => 'cash_count',
        PosSessionEvent::TYPE_CASH_DRAWER_OPEN_ATTEMPT => 'drawer',
    ];

    /** @var list<string> */
    private const REASON_REQUIRED = [
        PosSessionEvent::TYPE_ITEM_REMOVED,
        PosSessionEvent::TYPE_PRICE_OVERRIDDEN,
        PosSessionEvent::TYPE_DISCOUNT_APPLIED,
        PosSessionEvent::TYPE_DISCOUNT_CHANGED,
        PosSessionEvent::TYPE_DISCOUNT_REMOVED,
        PosSessionEvent::TYPE_PAYMENT_CANCELLED,
        PosSessionEvent::TYPE_CART_CANCELLED,
    ];

    /** أحداث لا يعرفها الخادم حالياً إلا كملاحظة من واجهة السلة المحلية. */
    private const CLIENT_OBSERVED_CART_EVENT_TYPES = [
        PosSessionEvent::TYPE_ITEM_ADDED,
        PosSessionEvent::TYPE_ITEM_REMOVED,
        PosSessionEvent::TYPE_ITEM_QUANTITY_CHANGED,
        PosSessionEvent::TYPE_PRICE_OVERRIDDEN,
        PosSessionEvent::TYPE_DISCOUNT_APPLIED,
        PosSessionEvent::TYPE_DISCOUNT_CHANGED,
        PosSessionEvent::TYPE_DISCOUNT_REMOVED,
        PosSessionEvent::TYPE_CUSTOMER_CHANGED,
        PosSessionEvent::TYPE_PAYMENT_CANCELLED,
        PosSessionEvent::TYPE_CART_CANCELLED,
    ];

    /** أحداث سلة ينشئها مسار تشغيل خادمي فعلي فقط. */
    private const SERVER_CART_EVENT_TYPES = [
        PosSessionEvent::TYPE_CART_HELD,
        PosSessionEvent::TYPE_CART_RESUMED,
        PosSessionEvent::TYPE_CART_DISCARDED,
    ];

    /** @return array<int, PosReasonCode> */
    public function reasonCodes(bool $includeInactive = false): array
    {
        $this->ensureDefaultReasonCodes();

        return PosReasonCode::query()
            ->when(! $includeInactive, fn (Builder $query) => $query->where('is_active', true))
            ->orderBy('code')
            ->get()
            ->all();
    }

    /** يولّد هوية سلة من الخادم ويثبت بداية السلسلة قبل أن يبدأ التعديل المحلي. */
    /** @param array<string,mixed> $snapshot */
    public function createCart(PosSession $session, User $actor, array $snapshot = []): PosSessionEvent
    {
        $this->assertSessionContext($session, $actor, true);
        $cartId = (string) Str::uuid();

        return $this->append($session, PosSessionEvent::TYPE_CART_CREATED, $actor, [
            'cart_id' => $cartId,
            'correlation_id' => $cartId,
            'payload' => [
                'provenance' => [
                    'source' => 'hybrid',
                    'trust_level' => 'server_authoritative_identity',
                    'client_observed_snapshot' => true,
                ],
                'cart' => ['id' => $cartId],
                'client_observed_snapshot' => $this->payload($snapshot),
            ],
        ]);
    }

    /**
     * Telemetry ثانوي من واجهة السلة المحلية. لا يمثل before/after أو المبلغ
     * حقيقة خادمية، ولا يجوز استخدامه قراراً مالياً أو أمنياً دون تحقق لاحق.
     *
     * @param array<string,mixed> $data
     */
    public function recordClientObservedCartEvent(PosSession $session, User $actor, string $cartId, string $type, array $data): PosSessionEvent
    {
        if (! in_array($type, self::CLIENT_OBSERVED_CART_EVENT_TYPES, true)) {
            throw new RuntimeException('هذا الحدث غير مسموح من عميل نقطة البيع.');
        }
        $this->assertSessionContext($session, $actor, true);
        $this->assertKnownCart($session, $cartId);

        $reason = $this->resolveReason($data['reason_code'] ?? null, $data['reason_note'] ?? null, in_array($type, self::REASON_REQUIRED, true));
        $correlationId = $this->validUuidOr($data['correlation_id'] ?? null, $cartId);
        $operation = $this->operationFor($type);
        $approvedBy = $this->consumeApprovalIfNeeded(
            $session,
            $actor,
            $cartId,
            $correlationId,
            $operation,
            $data['approval_id'] ?? null,
        );

        return $this->append($session, $type, $actor, [
            'cart_id' => $cartId,
            'correlation_id' => $correlationId,
            'reason_code' => $reason['code'],
            'reason_note' => $reason['note'],
            'performed_by' => $actor->id,
            'approved_by' => $approvedBy?->id,
            'payload' => [
                'provenance' => ['source' => 'client_observed', 'trust_level' => 'secondary_telemetry'],
                'client_observed' => $this->payload($data),
            ],
        ]);
    }

    /**
     * يسجل حدث سلة من مسار تشغيل خادمي فقط؛ لا تستدعيه طبقة HTTP العميلية.
     *
     * @param array<string,mixed> $data
     */
    public function recordCartEvent(PosSession $session, User $actor, string $cartId, string $type, array $data, bool $allowPriorSessionCart = false): PosSessionEvent
    {
        if (! in_array($type, self::SERVER_CART_EVENT_TYPES, true)) {
            throw new RuntimeException('هذا الحدث محصور في خدمة تشغيل نقطة البيع.');
        }
        $this->assertSessionContext($session, $actor, true);
        $this->assertKnownCart($session, $cartId, $allowPriorSessionCart);

        return $this->append($session, $type, $actor, [
            'cart_id' => $cartId,
            'correlation_id' => $this->validUuidOr($data['correlation_id'] ?? null, $cartId),
            'performed_by' => $actor->id,
            'payload' => $this->payload($data),
        ]);
    }

    /**
     * يسجل بداية/اكتمال checkout داخل الخدمة المالية القائمة، فلا يتوقف الدليل
     * عند اعتماد العميل ولا ينسخ الفاتورة أو سندات القبض.
     *
     * @param array<string,mixed> $payload
     */
    public function recordCheckout(PosSession $session, ?User $actor, string $cartId, string $type, array $payload = []): PosSessionEvent
    {
        if (! in_array($type, [
            PosSessionEvent::TYPE_PAYMENT_STARTED,
            PosSessionEvent::TYPE_PAYMENT_FAILED,
            PosSessionEvent::TYPE_CHECKOUT_STARTED,
            PosSessionEvent::TYPE_CHECKOUT_COMPLETED,
        ], true)) {
            throw new RuntimeException('نوع حدث الإتمام غير صالح.');
        }
        $this->assertKnownCart($session, $cartId);

        return $this->append($session, $type, $actor, [
            'cart_id' => $cartId,
            'correlation_id' => $cartId,
            'performed_by' => $actor?->id,
            'amount' => $this->amount($payload['amount'] ?? null),
            'payload' => array_merge($this->payload($payload), [
                'provenance' => ['source' => 'server', 'trust_level' => 'server_authoritative'],
            ]),
        ]);
    }

    /**
     * يسجل الطلب المعلق في سجل الأدلة، ثم ينشئ إسقاط حالة قصير العمر للاستهلاك
     * الأحادي. يظل الربط correlation-based بدلاً من افتراض مسمى وظيفة.
     *
     * @param array<string,mixed> $context
     */
    public function requestApproval(
        PosSession $session,
        User $actor,
        string $operation,
        ?string $cartId,
        ?string $reasonCode,
        ?string $reasonNote,
        array $context = [],
    ): PosOverrideApproval {
        // إعادة العد استثناء ما بعد الإغلاق حصراً: لا يمكن طلبها إلا بعد تثبيت
        // العد وكشف نتيجته. تبقى كل عمليات السلة والاستثناءات الأخرى داخل جلسة مفتوحة.
        $isCashRecount = $operation === 'cash_recount';
        $this->assertSessionContext($session, $actor, ! $isCashRecount);
        if ($isCashRecount && ($session->status !== 'closed'
            || $session->counted_balance_locked_at === null
            || $session->closing_count_revealed_at === null)) {
            throw new RuntimeException('لا يمكن طلب اعتماد إعادة العد قبل تثبيت عد الإغلاق وكشف نتيجته.');
        }

        $policy = PosSettings::auditOperationPolicy($operation);
        if ($policy === PosOverrideApproval::POLICY_DENIED) {
            throw new RuntimeException('سياسة الرقابة تمنع هذه العملية.');
        }
        if ($policy !== PosOverrideApproval::POLICY_APPROVAL_REQUIRED) {
            throw new RuntimeException('هذه العملية لا تحتاج طلب اعتماد وفق السياسة الحالية.');
        }
        if ($cartId !== null) {
            $this->assertKnownCart($session, $cartId);
        }
        $reason = $this->resolveReason($reasonCode, $reasonNote, true);
        $correlationId = (string) Str::uuid();

        return DB::transaction(function () use ($session, $actor, $operation, $cartId, $reason, $context, $correlationId, $policy) {
            $approval = PosOverrideApproval::create([
                'branch_id' => $session->branch_id,
                'pos_session_id' => $session->id,
                'cart_id' => $cartId,
                'correlation_id' => $correlationId,
                'operation' => $operation,
                'policy' => $policy,
                'status' => PosOverrideApproval::STATUS_PENDING,
                'reason_code' => $reason['code'],
                'reason_note' => $reason['note'],
                'performed_by' => $actor->id,
                'context' => $this->payload($context),
                'expires_at' => now()->addMinutes(15),
            ]);

            $this->append($session, PosSessionEvent::TYPE_OVERRIDE_REQUESTED, $actor, [
                'cart_id' => $cartId,
                'correlation_id' => $correlationId,
                'reason_code' => $reason['code'],
                'reason_note' => $reason['note'],
                'performed_by' => $actor->id,
                'payload' => [
                    'approval_id' => $approval->id,
                    'operation' => $operation,
                    'context' => $this->payload($context),
                ],
            ]);

            return $approval;
        });
    }

    public function approve(PosOverrideApproval $approval, User $actor): PosOverrideApproval
    {
        if (! $actor->hasPermission('pos.override.approve')) {
            throw new RuntimeException('لا تملك صلاحية اعتماد استثناء نقطة البيع.');
        }

        return DB::transaction(function () use ($approval, $actor) {
            $approval = PosOverrideApproval::lockForUpdate()->findOrFail($approval->id);
            if ($approval->status !== PosOverrideApproval::STATUS_PENDING || $approval->expires_at?->isPast()) {
                throw new RuntimeException('طلب الاعتماد غير متاح أو انتهت صلاحيته.');
            }
            if ($approval->performed_by !== null && $approval->performed_by === $actor->id) {
                throw new RuntimeException('يجب أن يكون المعتمد مستخدماً مختلفاً عن منفذ العملية.');
            }

            $approval->update([
                'status' => PosOverrideApproval::STATUS_APPROVED,
                'approved_by' => $actor->id,
                'approved_at' => now(),
            ]);
            $session = PosSession::findOrFail($approval->pos_session_id);
            $this->append($session, PosSessionEvent::TYPE_OVERRIDE_APPROVED, $actor, [
                'cart_id' => $approval->cart_id,
                'correlation_id' => $approval->correlation_id,
                'reason_code' => $approval->reason_code,
                'reason_note' => $approval->reason_note,
                'performed_by' => $approval->performed_by,
                'approved_by' => $actor->id,
                'payload' => ['approval_id' => $approval->id, 'operation' => $approval->operation],
            ]);

            return $approval->fresh(['performedBy', 'approvedBy']);
        });
    }

    /** يستهلك اعتماداً موافقاً لعملية لا ترتبط بسلة، مثل إعادة العد بعد كشف الفرق. */
    public function consumeApprovedOperation(PosSession $session, User $actor, string $operation, string $approvalId): User
    {
        $approvedBy = $this->consumeApprovalIfNeeded($session, $actor, null, (string) Str::uuid(), $operation, $approvalId);
        if ($approvedBy === null) {
            throw new RuntimeException('هذه العملية لا تتطلب اعتماداً مسجلاً وفق السياسة الحالية.');
        }

        return $approvedBy;
    }

    /** @return array{events: \Illuminate\Support\Collection<int,PosSessionEvent>, total: int} */
    public function readEvents(Builder $query, array $filters): array
    {
        $query->with([
            'actor:id,name', 'performedBy:id,name', 'approvedBy:id,name',
            'session:id,number,pos_device_id,shift_id,opened_by,closed_by',
            'session.posDevice:id,name,code',
        ])->orderByDesc('created_at')->orderByDesc('id');

        if (! empty($filters['from'])) $query->where('created_at', '>=', $filters['from']);
        if (! empty($filters['to'])) $query->where('created_at', '<=', $filters['to']);
        if (! empty($filters['device_id'])) $query->whereHas('session', fn (Builder $q) => $q->where('pos_device_id', $filters['device_id']));
        if (! empty($filters['pos_session_id'])) $query->where('pos_session_id', $filters['pos_session_id']);
        if (! empty($filters['user_id'])) $query->where(function (Builder $q) use ($filters) {
            $q->where('actor_id', $filters['user_id'])->orWhere('performed_by', $filters['user_id'])->orWhere('approved_by', $filters['user_id']);
        });
        if (! empty($filters['cart_id'])) $query->where('cart_id', $filters['cart_id']);
        if (! empty($filters['type'])) $query->whereIn('type', (array) $filters['type']);
        if (! empty($filters['category'])) $query->whereIn('category', (array) $filters['category']);
        if (! empty($filters['reason_code'])) $query->where('reason_code', $filters['reason_code']);
        if (isset($filters['amount_min'])) $query->where('amount', '>=', (int) $filters['amount_min']);
        if (isset($filters['amount_max'])) $query->where('amount', '<=', (int) $filters['amount_max']);

        $total = (clone $query)->count();
        $perPage = min(max((int) ($filters['per_page'] ?? 50), 1), 200);

        return [
            'events' => $query->limit($perPage)->get(),
            'total' => $total,
        ];
    }

    public function auditEventForExistingOperation(PosSession $session, string $type, ?User $actor, array $payload): PosSessionEvent
    {
        return $this->append($session, $type, $actor, [
            'cart_id' => $payload['cart_id'] ?? null,
            'correlation_id' => $this->validUuidOr($payload['correlation_id'] ?? null, (string) Str::uuid()),
            'performed_by' => $payload['performed_by'] ?? $actor?->id,
            'approved_by' => $payload['approved_by'] ?? null,
            'amount' => $this->amount($payload['amount'] ?? $payload['difference'] ?? null),
            'reason_code' => $payload['reason_code'] ?? null,
            'reason_note' => $payload['reason_note'] ?? $payload['reason'] ?? $payload['note'] ?? null,
            'payload' => array_merge($this->payload($payload), [
                'provenance' => ['source' => 'server', 'trust_level' => 'server_authoritative'],
            ]),
        ]);
    }

    /** @return array{code:?string,note:?string} */
    private function resolveReason(mixed $code, mixed $note, bool $required): array
    {
        $this->ensureDefaultReasonCodes();
        $normalizedCode = is_string($code) ? trim($code) : '';
        $normalizedNote = is_string($note) ? trim($note) : '';
        if ($normalizedCode === '') {
            if ($required) throw new RuntimeException('اختيار سبب من القائمة مطلوب لهذه العملية.');
            return ['code' => null, 'note' => null];
        }

        $reason = PosReasonCode::query()->where('code', $normalizedCode)->where('is_active', true)->first();
        if (! $reason) throw new RuntimeException('سبب العملية غير موجود أو معطّل.');
        if (($reason->requires_note || $reason->code === PosReasonCode::OTHER) && $normalizedNote === '') {
            throw new RuntimeException('يجب إدخال توضيح إضافي عند اختيار «أخرى».');
        }

        return ['code' => $reason->code, 'note' => $normalizedNote !== '' ? Str::limit($normalizedNote, 2000, '') : null];
    }

    private function consumeApprovalIfNeeded(PosSession $session, User $actor, ?string $cartId, string $correlationId, string $operation, mixed $approvalId): ?User
    {
        $policy = PosSettings::auditOperationPolicy($operation);
        if ($policy === PosOverrideApproval::POLICY_DENIED) throw new RuntimeException('سياسة الرقابة تمنع هذه العملية.');
        if ($policy !== PosOverrideApproval::POLICY_APPROVAL_REQUIRED) return null;
        if (! is_string($approvalId) || $approvalId === '') throw new RuntimeException('هذه العملية تحتاج اعتماداً مسجلاً قبل تنفيذها.');

        $approval = PosOverrideApproval::lockForUpdate()->findOrFail($approvalId);
        if ($approval->status !== PosOverrideApproval::STATUS_APPROVED || $approval->expires_at?->isPast()
            || $approval->pos_session_id !== $session->id || $approval->cart_id !== $cartId
            || $approval->operation !== $operation || $approval->performed_by !== $actor->id) {
            throw new RuntimeException('الاعتماد المقدم لا يطابق العملية أو لم يعد صالحاً.');
        }

        $approval->update(['status' => PosOverrideApproval::STATUS_CONSUMED, 'consumed_at' => now()]);
        $this->append($session, PosSessionEvent::TYPE_OVERRIDE_CONSUMED, $actor, [
            'cart_id' => $cartId,
            'correlation_id' => $approval->correlation_id ?: $correlationId,
            'reason_code' => $approval->reason_code,
            'reason_note' => $approval->reason_note,
            'performed_by' => $actor->id,
            'approved_by' => $approval->approved_by,
            'payload' => ['approval_id' => $approval->id, 'operation' => $operation],
        ]);

        return $approval->approvedBy;
    }

    /** @param array<string,mixed> $attributes */
    private function append(PosSession $session, string $type, ?User $actor, array $attributes): PosSessionEvent
    {
        if (! isset(self::CATEGORIES[$type])) throw new RuntimeException('نوع سجل تدقيق POS غير معروف.');

        $payload = is_array($attributes['payload'] ?? null) ? $attributes['payload'] : [];
        // أي مسار خدمة لا يحدد مصدراً صراحة هو عملية خادمية؛ لا يسمح هذا
        // الافتراض أبداً بتجاوز ختم client_observed أو hybrid المنشأين أعلاه.
        if (! isset($payload['provenance'])) {
            $payload['provenance'] = ['source' => 'server', 'trust_level' => 'server_authoritative'];
        }

        return PosSessionEvent::create([
            'branch_id' => $session->branch_id,
            'pos_session_id' => $session->id,
            'cart_id' => $attributes['cart_id'] ?? null,
            'correlation_id' => $attributes['correlation_id'] ?? null,
            'type' => $type,
            'category' => self::CATEGORIES[$type],
            'actor_id' => $actor?->id,
            'amount' => $attributes['amount'] ?? null,
            'reason_code' => $attributes['reason_code'] ?? null,
            'reason_note' => $attributes['reason_note'] ?? null,
            'performed_by' => $attributes['performed_by'] ?? $actor?->id,
            'approved_by' => $attributes['approved_by'] ?? null,
            'payload' => $payload,
            'created_at' => now(),
        ]);
    }

    private function assertSessionContext(PosSession $session, User $actor, bool $mustBeOpen): void
    {
        $fresh = PosSession::findOrFail($session->id);
        if ($mustBeOpen && ! $fresh->isOpen()) throw new RuntimeException('جلسة نقطة البيع مغلقة ولا تقبل هذا الإجراء.');
        $branchId = app(BranchContext::class)->id();
        if ($fresh->branch_id !== $branchId || ! $actor->canAccessBranch($branchId)) {
            throw new RuntimeException('جلسة نقطة البيع لا تخص الفرع النشط أو صلاحياتك.');
        }
        if ($fresh->warehouse_id !== null && ! $actor->canAccessWarehouse($fresh->warehouse_id)) {
            throw new RuntimeException('مخزن جلسة نقطة البيع خارج نطاق صلاحياتك.');
        }
        if ($mustBeOpen && $fresh->opened_by !== null && $fresh->opened_by !== $actor->id) {
            throw new RuntimeException('جلسة نقطة البيع تخص كاشيراً آخر.');
        }
    }

    private function assertKnownCart(PosSession $session, string $cartId, bool $allowPriorSessionCart = false): void
    {
        $created = PosSessionEvent::query()
            ->where('cart_id', $cartId)
            ->where('type', PosSessionEvent::TYPE_CART_CREATED);
        if (! $allowPriorSessionCart) {
            $created->where('pos_session_id', $session->id);
        } else {
            // لا يسمح بهذا المسار إلا لخدمة held/resume بعد تحقق مالك السلة
            // والفرع/المخزن؛ فلا يستطيع API العام ربط جلسة جديدة بسلة قديمة.
            $created->where('branch_id', $session->branch_id);
        }
        if (! Str::isUuid($cartId) || ! $created->exists()) {
            throw new RuntimeException('السلة غير معروفة في جلسة نقطة البيع هذه.');
        }
    }

    /** @param array<string,mixed> $data @return array<string,mixed> */
    private function payload(array $data): array
    {
        $allowed = [
            'before', 'after', 'item', 'items', 'customer', 'invoice_id', 'invoice_number',
            'payment_ids', 'tenders', 'held_sale_id', 'return_id', 'exchange_id', 'status',
            'error_code', 'mode', 'operation', 'approval_id', 'context', 'counted_balance',
            'expected_balance', 'difference', 'pos_device_id', 'shift_id', 'cash_movement_id',
            'recount_after_approval', 'note',
            // تفصيل الاستبدال المالي: يبقى في الحمولة للتدقيق والشرح إلى جانب عمود
            // amount المشتقّ منه (قيمة الإرجاع). لا يغيّر أي قيد أو رصيد.
            'original_invoice_id', 'replacement_invoice_id', 'applied_credit_amount', 'cash_refund_amount',
        ];
        $result = [];
        foreach ($allowed as $key) {
            if (array_key_exists($key, $data)) $result[$key] = $data[$key];
        }

        return $result;
    }

    private function operationFor(string $eventType): string
    {
        return match ($eventType) {
            PosSessionEvent::TYPE_ITEM_REMOVED => 'item_remove',
            PosSessionEvent::TYPE_PRICE_OVERRIDDEN => 'price_override',
            PosSessionEvent::TYPE_DISCOUNT_APPLIED,
            PosSessionEvent::TYPE_DISCOUNT_CHANGED,
            PosSessionEvent::TYPE_DISCOUNT_REMOVED => 'discount_change',
            PosSessionEvent::TYPE_CART_DISCARDED,
            PosSessionEvent::TYPE_CART_CANCELLED => 'cart_cancel',
            default => $eventType,
        };
    }

    private function amount(mixed $amount): ?int
    {
        if ($amount === null || $amount === '') return null;
        if (filter_var($amount, FILTER_VALIDATE_INT) === false) throw new RuntimeException('قيمة الحدث الرقابي غير صالحة.');
        return (int) $amount;
    }

    private function validUuidOr(mixed $candidate, string $fallback): string
    {
        return is_string($candidate) && Str::isUuid($candidate) ? $candidate : $fallback;
    }

    private function ensureDefaultReasonCodes(): void
    {
        foreach ([
            ['code' => 'wrong_scan', 'name_ar' => 'مسح خاطئ', 'name_en' => 'Wrong scan', 'requires_note' => false],
            ['code' => 'customer_changed_mind', 'name_ar' => 'العميل تراجع', 'name_en' => 'Customer changed their mind', 'requires_note' => false],
            ['code' => 'wrong_quantity', 'name_ar' => 'كمية خاطئة', 'name_en' => 'Incorrect quantity', 'requires_note' => false],
            ['code' => 'wrong_price', 'name_ar' => 'سعر غير صحيح', 'name_en' => 'Incorrect price', 'requires_note' => false],
            ['code' => 'payment_failed', 'name_ar' => 'فشل الدفع', 'name_en' => 'Payment failed', 'requires_note' => false],
            ['code' => 'training', 'name_ar' => 'اختبار أو تدريب', 'name_en' => 'Test or training', 'requires_note' => false],
            ['code' => PosReasonCode::OTHER, 'name_ar' => 'أخرى', 'name_en' => 'Other', 'requires_note' => true],
        ] as $reason) {
            PosReasonCode::query()->firstOrCreate(['code' => $reason['code']], $reason + ['is_active' => true]);
        }
    }
}
