<?php

namespace App\Services\Payments;

use App\Contracts\Payments\Payable;
use App\Models\PaymentAttempt;
use App\Models\PaymentGateway;
use App\Models\User;
use App\Services\PaymentsRolloutControlService;
use App\Support\Payments\AttemptContext;
use App\Support\Payments\AttemptTransitionResult;
use App\Support\Payments\PaymentOrchestrationException;
use App\Support\Payments\ProviderPaymentSnapshot;
use App\Support\Rbac;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * ═══════════════════════════════════════════════════════════════
 *  منسّق المدفوعات — PAY-H1-03 (نواة فقط: لا ترحيل ولا سند ولا قيد)
 * ═══════════════════════════════════════════════════════════════
 *  يملك: المحاولات وحالاتها ومراجع المزوّد ومفتاح الـidempotency. **لا يملك** الأثر المالي: لا يستدعي
 *  `PaymentService`/`LedgerService` ولا يكتب في سندات أو قيود (الترحيل شريحة لاحقة وتمرّ عبر الخدمات القائمة).
 *
 *  • `start()` يشترط ضابط التفعيل (مستأجر مفعَّل ولا إيقاف منصة)، وصلاحية الفاعل `payments.manage` إن وُجد، واتصالاً صالحاً
 *    للاستعمال بمحوّل متاح. المبلغ يُعاد حسابه من الـPayable عند كل محاولة جديدة. idempotent بمفتاح؛ محاولة نشطة واحدة لكل Payable.
 *    لا شبكة داخل معاملة: إنشاء الصفّ معاملة، ثم استدعاء المزوّد، ثم معاملة تثبيت النتيجة. فشل المزوّد يترك المحاولة `created`
 *    وإعادة الطلب بالمفتاح نفسه تكمل من حيث توقفت (معرّف المحاولة مفتاح idempotency عند المزوّد).
 *  • `sync()`/`applySnapshot()`: حقيقة المزوّد وحدها تحرّك الحالة (لا يُصدَّق جسم حدث). تحت قفل صف المحاولة؛ التطبيق رتيب —
 *    اللقطة المتأخرة/المكررة/الأدنى رتبة تُتجاهل بلا أثر، فيستوي ترتيب وصول الأحداث. التقاط بعد إلغاء/انتهاء محلي يُقبل ويُرفع للمراجعة (D-15).
 *  • `sync()` و`cancel()` غير مبوَّبتين بضابط التفعيل: الضابط يوقف **البدء** فقط، وما التقطه المزوّد فعلاً يجب أن يبقى قابلاً للمطابقة.
 *
 *  ترتيب الأقفال: صف المحاولة وحده (لا Payable ولا فاتورة ولا مِرساة مستأجر هنا لأنه لا ترحيل).
 *  لا يُستدعى `start()` داخل معاملة قاعدة بيانات خارجية (يفتح معاملاته ويستدعي المزوّد بينها).
 */
final class PaymentOrchestrator
{
    private const PAYABLE_KEY = '/^[a-z][a-z0-9_.-]*:[A-Za-z0-9_-]{1,100}$/';

    private const IDEMPOTENCY_KEY = '/^[A-Za-z0-9][A-Za-z0-9._:\-]{7,127}$/';

    public function __construct(
        private readonly PaymentsRolloutControlService $rollout,
        private readonly GatewayAdapterRegistry $adapters,
        private readonly TenantContext $tenant,
    ) {}

    public function start(Payable $payable, PaymentGateway $gateway, string $idempotencyKey, ?User $actor = null): PaymentAttempt
    {
        $this->assertActor($actor);
        $this->assertEnabled();
        if (preg_match(self::IDEMPOTENCY_KEY, $idempotencyKey) !== 1) {
            throw new PaymentOrchestrationException('invalid_idempotency_key', 'مفتاح منع التكرار غير صالح.');
        }
        $gateway = $this->freshGateway($gateway);

        $existing = PaymentAttempt::query()->where('idempotency_key', $idempotencyKey)->first();
        $attempt = $existing !== null
            ? $this->replay($existing, $payable, $gateway)
            : $this->create($payable, $gateway, $idempotencyKey, $actor);

        return $this->ensureCheckout($attempt, $gateway);
    }

    /** يستعلم المزوّد (الحقيقة) ويطبّق اللقطة رتيباً. */
    public function sync(PaymentAttempt $attempt, ?User $actor = null): AttemptTransitionResult
    {
        $this->assertActor($actor);
        $attempt = $this->reload($attempt);
        if ($attempt->provider_payment_id === null) {
            throw new PaymentOrchestrationException('not_started', 'لم تبدأ هذه المحاولة لدى المزوّد بعد.');
        }

        $gateway = PaymentGateway::query()->find($attempt->payment_gateway_id);
        if ($gateway === null || in_array($gateway->status, [PaymentGateway::STATUS_DRAFT, PaymentGateway::STATUS_REVOKED], true)) {
            throw new PaymentOrchestrationException('gateway_unavailable', 'اتصال البوابة غير متاح للمطابقة.');
        }
        $adapter = $this->adapters->for($attempt->provider);

        try {
            $snapshot = $adapter->fetchPayment($gateway, $attempt->provider_payment_id);
        } catch (Throwable $e) {
            throw new PaymentOrchestrationException('provider_unavailable', 'تعذر الوصول إلى مزوّد الدفع.', $e);
        }

        return $this->applySnapshot($attempt, $snapshot);
    }

    public function applySnapshot(PaymentAttempt $attempt, ProviderPaymentSnapshot $snapshot): AttemptTransitionResult
    {
        return DB::transaction(function () use ($attempt, $snapshot): AttemptTransitionResult {
            $locked = PaymentAttempt::query()->lockForUpdate()->find($attempt->getKey());
            if ($locked === null) {
                throw new PaymentOrchestrationException('attempt_not_found', 'محاولة الدفع غير موجودة.');
            }
            if ($locked->provider_payment_id === null || ! hash_equals($locked->provider_payment_id, $snapshot->providerPaymentId)) {
                throw new PaymentOrchestrationException('provider_reference_mismatch', 'مرجع المزوّد لا يطابق المحاولة.');
            }
            $target = $snapshot->status;
            if ($target === PaymentAttempt::STATUS_CREATED || ! in_array($target, PaymentAttempt::STATUSES, true)) {
                throw new PaymentOrchestrationException('invalid_snapshot', 'حالة المزوّد غير معروفة.');
            }

            $from = $locked->capture_status;
            $now = now('UTC');

            if ($target === $from) {
                $locked->forceFill(['last_synced_at' => $now])->save();

                return new AttemptTransitionResult($locked, false, 'duplicate');
            }

            if (! PaymentAttempt::canTransition($from, $target)) {
                // لقطة أدنى رتبة/متأخرة: لا أثر. إلا إن أفادت أن المزوّد يحتجز مالاً لمحاولة أُغلقت محلياً ⇒ مراجعة.
                $heldMoney = in_array($target, [PaymentAttempt::STATUS_AUTHORIZED, PaymentAttempt::STATUS_CAPTURED], true)
                    && in_array($from, [PaymentAttempt::STATUS_FAILED, PaymentAttempt::STATUS_VOIDED, PaymentAttempt::STATUS_EXPIRED, PaymentAttempt::STATUS_CANCELLED], true);
                $updates = ['last_synced_at' => $now];
                if ($heldMoney) {
                    $updates['review_reasons'] = $this->withReasons($locked, [PaymentAttempt::REVIEW_STATE_CONFLICT]);
                }
                $locked->forceFill($updates)->save();

                return new AttemptTransitionResult($locked, false, $heldMoney ? 'state_conflict' : 'stale');
            }

            $updates = ['capture_status' => $target, 'last_synced_at' => $now];
            if ($snapshot->failureCode !== null) {
                $updates['failure_code'] = substr($snapshot->failureCode, 0, 64);
            }
            if ($target === PaymentAttempt::STATUS_CAPTURED) {
                $reasons = [];
                if (in_array($from, [PaymentAttempt::STATUS_EXPIRED, PaymentAttempt::STATUS_CANCELLED], true)) {
                    $reasons[] = PaymentAttempt::REVIEW_LATE_CAPTURE;
                }
                if (strtoupper($snapshot->currency) !== $locked->currency) {
                    $reasons[] = PaymentAttempt::REVIEW_CURRENCY_MISMATCH;
                }
                if ($snapshot->capturedMinor !== (int) $locked->amount_minor) {
                    $reasons[] = PaymentAttempt::REVIEW_AMOUNT_MISMATCH;
                }
                $updates['captured_minor'] = $snapshot->capturedMinor;
                $updates['captured_at'] = $snapshot->capturedAt ?? $now;
                if ($reasons !== []) {
                    $updates['review_reasons'] = $this->withReasons($locked, $reasons);
                }
            }
            $locked->forceFill($updates)->save();

            return new AttemptTransitionResult($locked, true);
        });
    }

    /** إلغاء محلي لمحاولة لم تُلتقط (لا أثر لدى المزوّد؛ التقاط متأخر لاحق يُعالج بـD-15). idempotent. */
    public function cancel(PaymentAttempt $attempt, ?User $actor = null): PaymentAttempt
    {
        $this->assertActor($actor);

        return DB::transaction(function () use ($attempt): PaymentAttempt {
            $locked = PaymentAttempt::query()->lockForUpdate()->find($attempt->getKey());
            if ($locked === null) {
                throw new PaymentOrchestrationException('attempt_not_found', 'محاولة الدفع غير موجودة.');
            }
            if ($locked->capture_status === PaymentAttempt::STATUS_CANCELLED) {
                return $locked;
            }
            if (! in_array($locked->capture_status, [PaymentAttempt::STATUS_CREATED, PaymentAttempt::STATUS_PENDING_CUSTOMER], true)) {
                throw new PaymentOrchestrationException('cannot_cancel', 'لا يمكن إلغاء محاولة بهذه الحالة.');
            }
            $locked->forceFill(['capture_status' => PaymentAttempt::STATUS_CANCELLED])->save();

            return $locked;
        });
    }

    // ───────────────────────── الداخل ─────────────────────────

    private function create(Payable $payable, PaymentGateway $gateway, string $idempotencyKey, ?User $actor): PaymentAttempt
    {
        $this->assertUsable($gateway);
        $adapter = $this->adapters->for($gateway->provider);

        $payableKey = $payable->payableKey();
        if (preg_match(self::PAYABLE_KEY, $payableKey) !== 1) {
            throw new PaymentOrchestrationException('invalid_payable', 'مفتاح الدفع غير صالح.');
        }
        $payable->assertStillPayable();
        $amount = $payable->amountDueMinor();
        if ($amount <= 0) {
            throw new PaymentOrchestrationException('nothing_due', 'لا مبلغ مستحق للدفع.');
        }
        $currency = strtoupper($payable->currency());
        if (! $adapter->capabilities()->supportsCurrency($currency)) {
            throw new PaymentOrchestrationException('currency_unsupported', 'العملة غير مدعومة لدى هذا المزوّد.');
        }
        if (PaymentAttempt::query()->where('payable_key', $payableKey)->whereIn('capture_status', PaymentAttempt::ACTIVE_STATUSES)->exists()) {
            throw new PaymentOrchestrationException('active_attempt_exists', 'توجد محاولة دفع نشطة لهذا المستند.');
        }

        try {
            return DB::transaction(fn (): PaymentAttempt => PaymentAttempt::query()->create([
                'payment_gateway_id' => $gateway->getKey(),
                'provider' => $gateway->provider,
                'environment' => $gateway->environment,
                'payable_key' => $payableKey,
                'idempotency_key' => $idempotencyKey,
                'amount_minor' => $amount,
                'currency' => $currency,
                'created_by' => $actor?->getKey(),
            ]));
        } catch (QueryException $e) {
            // سباق: طلبان متطابقان أو محاولتان نشطتان لنفس الـPayable. المعاملة تراجعت بالكامل (آمن على PostgreSQL).
            if (! $this->isUniqueViolation($e)) {
                throw $e;
            }
            $winner = PaymentAttempt::query()->where('idempotency_key', $idempotencyKey)->first();
            if ($winner !== null) {
                return $this->replay($winner, $payable, $gateway);
            }
            throw new PaymentOrchestrationException('active_attempt_exists', 'توجد محاولة دفع نشطة لهذا المستند.', $e);
        }
    }

    private function replay(PaymentAttempt $existing, Payable $payable, PaymentGateway $gateway): PaymentAttempt
    {
        if ($existing->payment_gateway_id !== $gateway->getKey() || $existing->payable_key !== $payable->payableKey()) {
            throw new PaymentOrchestrationException('idempotency_conflict', 'مفتاح منع التكرار مستعمل لطلب مختلف.');
        }

        return $existing;
    }

    /** ينشئ صفحة الدفع لدى المزوّد خارج أي معاملة ثم يثبّت النتيجة تحت قفل الصف. */
    private function ensureCheckout(PaymentAttempt $attempt, PaymentGateway $gateway): PaymentAttempt
    {
        if ($attempt->capture_status !== PaymentAttempt::STATUS_CREATED) {
            return $attempt;
        }
        $this->assertUsable($gateway);
        $adapter = $this->adapters->for($gateway->provider);

        try {
            $checkout = $adapter->createCheckout(new AttemptContext(
                $gateway, (string) $attempt->getKey(), (int) $attempt->amount_minor, $attempt->currency, $attempt->payable_key,
            ));
        } catch (Throwable $e) {
            throw new PaymentOrchestrationException('provider_unavailable', 'تعذر الوصول إلى مزوّد الدفع.', $e);
        }

        return DB::transaction(function () use ($attempt, $checkout): PaymentAttempt {
            $locked = PaymentAttempt::query()->lockForUpdate()->findOrFail($attempt->getKey());
            if ($locked->capture_status !== PaymentAttempt::STATUS_CREATED) {
                return $locked; // تقدّم طلب آخر أو أُلغيت أثناء الاستدعاء
            }
            $locked->forceFill([
                'provider_payment_id' => $checkout->providerPaymentId,
                'checkout_url' => $checkout->checkoutUrl,
                'expires_at' => $checkout->expiresAt,
                'capture_status' => PaymentAttempt::STATUS_PENDING_CUSTOMER,
            ])->save();

            return $locked;
        });
    }

    private function assertEnabled(): void
    {
        $state = $this->rollout->effectiveForCurrentTenant();
        if (! $state->enabled) {
            throw new PaymentOrchestrationException(
                $state->platformStopped ? 'platform_stop' : 'rollout_disabled',
                $state->platformStopped ? 'المدفوعات الإلكترونية موقوفة مؤقتاً من المنصة.' : 'المدفوعات الإلكترونية غير مفعّلة لهذه المؤسسة.',
            );
        }
    }

    private function assertActor(?User $actor): void
    {
        if ($actor === null) {
            return; // مسار نظامي (مطابقة/webhook) — لا مستخدم
        }
        if (! $this->tenant->has() || (string) $actor->tenant_id !== (string) $this->tenant->id() || ! Rbac::allows((string) $actor->role, 'payments.manage')) {
            throw new PaymentOrchestrationException('forbidden', 'ليست لديك صلاحية إدارة المدفوعات.');
        }
    }

    /** يعيد تحميل الاتصال بنطاق المستأجر (حالة طازجة؛ اتصال مستأجر آخر لا يُحلّ). */
    private function freshGateway(PaymentGateway $gateway): PaymentGateway
    {
        $fresh = PaymentGateway::query()->find($gateway->getKey());
        if ($fresh === null) {
            throw new PaymentOrchestrationException('gateway_unavailable', 'اتصال البوابة غير موجود.');
        }

        return $fresh;
    }

    private function assertUsable(PaymentGateway $gateway): void
    {
        if (! $gateway->isUsable()) {
            throw new PaymentOrchestrationException('gateway_unavailable', 'اتصال البوابة غير مفعّل.');
        }
    }

    private function reload(PaymentAttempt $attempt): PaymentAttempt
    {
        $fresh = PaymentAttempt::query()->find($attempt->getKey());
        if ($fresh === null) {
            throw new PaymentOrchestrationException('attempt_not_found', 'محاولة الدفع غير موجودة.');
        }

        return $fresh;
    }

    /** @param list<string> $add @return list<string> */
    private function withReasons(PaymentAttempt $attempt, array $add): array
    {
        return array_values(array_unique([...($attempt->review_reasons ?? []), ...$add]));
    }

    private function isUniqueViolation(QueryException $e): bool
    {
        $state = (string) $e->getCode();

        return $state === '23505' || ($state === '23000' && str_contains($e->getMessage(), 'UNIQUE'));
    }
}
