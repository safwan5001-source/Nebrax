<?php

namespace App\Services;

use App\Models\PaymentGateway;
use App\Models\PaymentGatewayAdjustment;
use App\Models\PaymentGatewayAdjustmentEvent;
use App\Models\PaymentGatewaySettlement;
use App\Models\PaymentGatewaySettlementLine;
use App\Models\Tenant;
use App\Models\User;
use App\Support\GatewayAdjustmentException;
use App\Support\Rbac;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * مستندات تعديل المزوّد غير العمولة (PAY-H3-02c، ADR-0008 D-22): احتجاز/إفراج احتياطي وتعديل مدين/دائن.
 * **لا قيد هنا**: المستند يطلب ويُعتمد بموافقة مستقلة ويُسجَّل تدقيقه، ثم تستهلكه تسوية مرحَّلة فيولّد القيد عبر `LedgerService` هناك.
 * المعتمِد ≠ الطالب دائماً (حتى لمستأجر بمستخدم واحد) — يُفرض هنا وفي القاعدة. الفاعل يُعاد تحميله من القاعدة وتُفحص صلاحيته وقت الفعل.
 */
final class PaymentGatewayAdjustmentService
{
    public const PERM_REQUEST = 'payment_settlements.adjust';

    public const PERM_APPROVE = 'payment_settlements.approve_adjustment';

    public function __construct(private readonly TenantContext $tenant, private readonly PaymentsRolloutControlService $rollout) {}

    public function request(
        PaymentGateway $gateway,
        string $kind,
        int $amountMinor,
        string $reason,
        string $evidenceRef,
        ?string $providerEventRef,
        User $actor,
    ): PaymentGatewayAdjustment {
        $actor = $this->actor($actor, self::PERM_REQUEST);
        $this->assertEnabled();
        if (! in_array($kind, PaymentGatewayAdjustment::KINDS, true)) {
            throw new GatewayAdjustmentException('invalid_kind', 'نوع التعديل غير مدعوم.');
        }
        if ($amountMinor <= 0 || $amountMinor > 999_999_999_999) {
            throw new GatewayAdjustmentException('invalid_amount', 'مبلغ التعديل غير صالح.');
        }
        $reason = $this->reason($reason);
        $evidenceRef = trim($evidenceRef);
        if (mb_strlen($evidenceRef) < 3 || mb_strlen($evidenceRef) > 191) {
            throw new GatewayAdjustmentException('evidence_required', 'مرجع دليل من كشف المزوّد مطلوب (٣ أحرف على الأقل).');
        }
        $providerEventRef = $providerEventRef === null || trim($providerEventRef) === '' ? null : mb_substr(trim($providerEventRef), 0, 191);

        return DB::transaction(function () use ($gateway, $kind, $amountMinor, $reason, $evidenceRef, $providerEventRef, $actor): PaymentGatewayAdjustment {
            $locked = PaymentGateway::query()->whereKey($gateway->getKey())->lockForUpdate()->first();
            if ($locked === null) {
                throw new GatewayAdjustmentException('gateway_not_found', 'البوابة غير موجودة.');
            }
            if ($kind === PaymentGatewayAdjustment::KIND_RESERVE_RELEASE && $amountMinor > $this->releasable((string) $locked->getKey())) {
                throw new GatewayAdjustmentException('reserve_insufficient', 'الإفراج يتجاوز الاحتياطي المحتجز المتاح لهذه البوابة.');
            }
            if ($providerEventRef !== null && PaymentGatewayAdjustment::query()
                ->where('payment_gateway_id', $locked->getKey())->where('provider_event_ref', $providerEventRef)->exists()) {
                throw new GatewayAdjustmentException('duplicate_event', 'مرجع حدث المزوّد مستعمل في تعديل آخر لهذه البوابة.');
            }

            $adjustment = PaymentGatewayAdjustment::create([
                'payment_gateway_id' => $locked->getKey(),
                'kind' => $kind,
                'amount_minor' => $amountMinor,
                'currency' => $this->currency(),
                'reason' => $reason,
                'evidence_ref' => $evidenceRef,
                'provider_event_ref' => $providerEventRef,
                'status' => PaymentGatewayAdjustment::REQUESTED,
                'requested_by' => $actor->getKey(),
                'requested_at' => now('UTC'),
            ]);
            $this->event($adjustment, 'requested', null, PaymentGatewayAdjustment::REQUESTED, $actor, $reason, ['evidence_ref' => $evidenceRef]);

            return $adjustment;
        });
    }

    public function approve(PaymentGatewayAdjustment $adjustment, User $actor): PaymentGatewayAdjustment
    {
        $actor = $this->actor($actor, self::PERM_APPROVE);
        $this->assertEnabled();

        return DB::transaction(function () use ($adjustment, $actor): PaymentGatewayAdjustment {
            $locked = $this->lock($adjustment);
            $this->assertStatus($locked, [PaymentGatewayAdjustment::REQUESTED]);
            if ((string) $locked->requested_by === (string) $actor->getKey()) {
                throw new GatewayAdjustmentException('self_approval', 'لا يجوز اعتماد تعديلٍ طلبته بنفسك؛ يلزم معتمِد مستقل.');
            }
            // إفراج الاحتياطي يُعاد فحصه عند الاعتماد (الاحتياطي قد يكون استُنفد بإفراج معتمد آخر).
            if ($locked->kind === PaymentGatewayAdjustment::KIND_RESERVE_RELEASE
                && (int) $locked->amount_minor > $this->releasable((string) $locked->payment_gateway_id, (string) $locked->getKey())) {
                throw new GatewayAdjustmentException('reserve_insufficient', 'الإفراج يتجاوز الاحتياطي المحتجز المتاح لهذه البوابة.');
            }

            $locked->forceFill(['status' => PaymentGatewayAdjustment::APPROVED, 'approved_by' => $actor->getKey(), 'approved_at' => now('UTC')])->save();
            $this->event($locked, 'approved', PaymentGatewayAdjustment::REQUESTED, PaymentGatewayAdjustment::APPROVED, $actor);

            return $locked;
        });
    }

    public function reject(PaymentGatewayAdjustment $adjustment, User $actor, string $reason): PaymentGatewayAdjustment
    {
        $actor = $this->actor($actor, self::PERM_APPROVE);
        $reason = $this->reason($reason);

        return DB::transaction(function () use ($adjustment, $actor, $reason): PaymentGatewayAdjustment {
            $locked = $this->lock($adjustment);
            $this->assertStatus($locked, [PaymentGatewayAdjustment::REQUESTED]);
            if ((string) $locked->requested_by === (string) $actor->getKey()) {
                throw new GatewayAdjustmentException('self_approval', 'طلبك أنت: استعمل الإلغاء بدل الرفض.');
            }
            $locked->forceFill([
                'status' => PaymentGatewayAdjustment::REJECTED, 'rejected_by' => $actor->getKey(), 'rejected_at' => now('UTC'), 'reject_reason' => $reason,
            ])->save();
            $this->event($locked, 'rejected', PaymentGatewayAdjustment::REQUESTED, PaymentGatewayAdjustment::REJECTED, $actor, $reason);

            return $locked;
        });
    }

    /** إلغاء قبل الاستهلاك: الطالب نفسه أو صاحب صلاحية الاعتماد. */
    public function cancel(PaymentGatewayAdjustment $adjustment, User $actor, string $reason): PaymentGatewayAdjustment
    {
        $actor = $this->freshUser($actor);
        $reason = $this->reason($reason);

        return DB::transaction(function () use ($adjustment, $actor, $reason): PaymentGatewayAdjustment {
            $locked = $this->lock($adjustment);
            $this->assertStatus($locked, [PaymentGatewayAdjustment::REQUESTED, PaymentGatewayAdjustment::APPROVED]);
            $isRequester = (string) $locked->requested_by === (string) $actor->getKey();
            if (! $isRequester && ! Rbac::allows($actor->role, self::PERM_APPROVE)) {
                throw new GatewayAdjustmentException('forbidden', 'الإلغاء للطالب أو لصاحب صلاحية اعتماد التعديلات.');
            }
            $from = $locked->status;
            $locked->forceFill([
                'status' => PaymentGatewayAdjustment::CANCELLED, 'cancelled_by' => $actor->getKey(), 'cancelled_at' => now('UTC'), 'cancel_reason' => $reason,
            ])->save();
            $this->event($locked, 'cancelled', $from, PaymentGatewayAdjustment::CANCELLED, $actor, $reason);

            return $locked;
        });
    }

    /**
     * يُستدعى من التسوية المرحَّلة داخل معاملتها: يحوّل التعديل المعتمد إلى مستهلَك بتلك التسوية (مرة واحدة) مع حدث تدقيق.
     * القفل على صف التعديل أخذته التسوية قبل هذا الاستدعاء؛ هنا يُعاد فحص الحالة دفاعاً.
     */
    public function consume(PaymentGatewayAdjustment $adjustment, PaymentGatewaySettlement $settlement, ?User $actor): void
    {
        $locked = $this->lock($adjustment);
        $this->assertStatus($locked, [PaymentGatewayAdjustment::APPROVED]);
        $locked->forceFill(['status' => PaymentGatewayAdjustment::CONSUMED, 'settlement_id' => $settlement->getKey()])->save();
        $this->event($locked, 'consumed', PaymentGatewayAdjustment::APPROVED, PaymentGatewayAdjustment::CONSUMED, $actor, null, ['settlement_id' => $settlement->getKey()]);
    }

    /** الاحتياطي المحتجز فعلياً لدى البوابة: Σ الاحتجاز المرحَّل − Σ الإفراج المرحَّل (بنود تسويات مرحَّلة فقط). */
    public function reserveBalance(string $gatewayId): int
    {
        $sum = fn (string $type) => (int) PaymentGatewaySettlementLine::query()
            ->where('line_type', $type)
            ->whereHas('settlement', fn ($q) => $q->where('payment_gateway_id', $gatewayId)->where('status', PaymentGatewaySettlement::STATUS_POSTED))
            ->sum('amount_minor');

        return $sum(PaymentGatewayAdjustment::KIND_RESERVE_HOLD) - $sum(PaymentGatewayAdjustment::KIND_RESERVE_RELEASE);
    }

    /** المتاح للإفراج = المحتجز − إفراجات مطلوبة/معتمدة لم تُستهلك بعد (باستثناء المستند المعطى عند إعادة فحصه). */
    public function releasable(string $gatewayId, ?string $exceptAdjustmentId = null): int
    {
        $open = (int) PaymentGatewayAdjustment::query()
            ->where('payment_gateway_id', $gatewayId)->where('kind', PaymentGatewayAdjustment::KIND_RESERVE_RELEASE)
            ->whereIn('status', [PaymentGatewayAdjustment::REQUESTED, PaymentGatewayAdjustment::APPROVED])
            ->when($exceptAdjustmentId !== null, fn ($q) => $q->where('id', '<>', $exceptAdjustmentId))
            ->sum('amount_minor');

        return $this->reserveBalance($gatewayId) - $open;
    }

    // ───────────────────────── الداخل ─────────────────────────

    private function lock(PaymentGatewayAdjustment $adjustment): PaymentGatewayAdjustment
    {
        // ترتيب الأقفال الثابت: البوابة (تسلسل كل ما يخصها) ← التعديل.
        $gatewayId = PaymentGatewayAdjustment::query()->whereKey($adjustment->getKey())->value('payment_gateway_id');
        if ($gatewayId === null) {
            throw new GatewayAdjustmentException('adjustment_not_found', 'التعديل غير موجود.');
        }
        PaymentGateway::query()->whereKey($gatewayId)->lockForUpdate()->first();
        $locked = PaymentGatewayAdjustment::query()->whereKey($adjustment->getKey())->lockForUpdate()->first();
        if ($locked === null) {
            throw new GatewayAdjustmentException('adjustment_not_found', 'التعديل غير موجود.');
        }

        return $locked;
    }

    /** @param  list<string>  $allowed */
    private function assertStatus(PaymentGatewayAdjustment $adjustment, array $allowed): void
    {
        if (! in_array($adjustment->status, $allowed, true)) {
            throw new GatewayAdjustmentException('invalid_state', "حالة التعديل ({$adjustment->status}) لا تسمح بهذا الإجراء.");
        }
    }

    private function actor(User $actor, string $permission): User
    {
        $fresh = $this->freshUser($actor);
        if (! Rbac::allows($fresh->role, $permission)) {
            throw new GatewayAdjustmentException('forbidden', 'المستخدم غير مخوّل لهذا الإجراء.');
        }

        return $fresh;
    }

    private function freshUser(User $actor): User
    {
        $fresh = $this->tenant->has() && $actor->getKey() !== null
            ? User::query()->whereKey($actor->getKey())->where('tenant_id', (string) $this->tenant->id())->where('is_active', true)->first()
            : null;
        if ($fresh === null) {
            throw new GatewayAdjustmentException('forbidden', 'المستخدم غير مخوّل.');
        }

        return $fresh;
    }

    private function assertEnabled(): void
    {
        if (! $this->rollout->effectiveForCurrentTenant()->tenantEnabled) {
            throw new GatewayAdjustmentException('rollout_disabled', 'المدفوعات الإلكترونية غير مفعّلة لهذه المؤسسة.');
        }
    }

    private function reason(string $reason): string
    {
        $reason = trim($reason);
        if (mb_strlen($reason) < 5) {
            throw new GatewayAdjustmentException('reason_required', 'السبب مطلوب (٥ أحرف على الأقل).');
        }

        return mb_substr($reason, 0, 500);
    }

    private function currency(): string
    {
        return (string) (Tenant::query()->whereKey((string) $this->tenant->id())->value('currency') ?: 'SAR');
    }

    /** @param  array<string, mixed>|null  $meta */
    private function event(PaymentGatewayAdjustment $adjustment, string $action, ?string $from, ?string $to, ?User $actor, ?string $reason = null, ?array $meta = null): void
    {
        PaymentGatewayAdjustmentEvent::create([
            'adjustment_id' => $adjustment->getKey(), 'action' => $action, 'from_status' => $from, 'to_status' => $to,
            'actor_id' => $actor?->getKey(), 'reason' => $reason, 'meta' => $meta,
        ]);
    }
}
