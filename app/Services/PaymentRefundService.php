<?php

namespace App\Services;

use App\Models\InvoicePaymentRequest;
use App\Models\PaymentAttempt;
use App\Models\PaymentGateway;
use App\Models\PaymentRefund;
use App\Models\PaymentRefundAllocation;
use App\Models\PaymentRefundAttempt;
use App\Models\PaymentRefundAttemptResult;
use App\Models\PaymentRefundEvent;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Accounting\CustomerRefundService;
use App\Services\Accounting\RefundSourceBalance;
use App\Support\PaymentProviderRefund;
use App\Support\PaymentProviderSnapshot;
use App\Support\PaymentRefundException;
use App\Support\PaymentRefundRejectedException;
use App\Support\PaymentRefundUnknownException;
use App\Support\Rbac;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Throwable;

/**
 * ═══════════════════════════════════════════════════════════════
 *  PaymentRefundService — دورة استرداد البوابة (PAY-H3-01b، ADR-0007 accepted). **بلا قيود: لا LedgerService ولا سند.**
 * ═══════════════════════════════════════════════════════════════
 *  طلب ← اعتماد مستقل (الطالب ≠ المعتمِد دائماً، حتى للمستأجر ذي المستخدم الواحد) ← إرسال خماسي المراحل ← تأكيد/فشل/غير معروف. التأكيد يترك
 *  `posting_status = pending`؛ الترحيل (A5) شريحة 01c.
 *
 *  القواعد (ADR §4–§5):
 *   • سقفان: رصيد المصدر التجاري (دالة `RefundSourceBalance` المشتركة مع الاسترداد النقدي) ومتبقي الدفعة (`captured − refunded − Σ محجوز`)، يُعاد فحصهما
 *     داخل القفل عند الطلب والاعتماد والإرسال مع استثناء المستند نفسه. Σ التخصيصات = المبلغ. العميل يُشتق من الالتقاط، والفرع/البوابة/العملة تطابقه.
 *   • التقاط مرحَّل فقط، بلا نزاع مفتوح ولا علم استرداد خارجي مفتوح.
 *   • إرسال واحد في الطيران لكل دفعة (فهرس جزئي فريد). لا شبكة تحت قفل أبداً: (1) حجز الخانة (2) `fetchPayment` للأساس خارج المعاملة (3) تحقق الأساس +
 *     سجل الاستدعاء (4) استدعاء المزوّد خارج المعاملة (5) النتيجة. لا إعادة إرسال أعمى؛ المطابقة بالتراكمي ولا تؤكّد وحدها تساوي الفرق.
 *   • أساس مجلوب أكبر من المحلي ⇒ استرداد خارجي: لا استدعاء، يعود المستند `approved` وتُوسم الدفعة. ردّ مباشر بفائض ⇒ يُؤكَّد المطلوب فقط ويُوسم الفائض.
 *
 *  ترتيب الأقفال: صف المحاولة (الدفعة) ← المصادر التجارية (مرتجعات ثم إشعارات بمعرّف تصاعدي) ← صف الاسترداد. لا قفل مِرساة هنا لأنه لا ترحيل.
 */
final class PaymentRefundService
{
    private const IDEMPOTENCY_KEY = '/^[A-Za-z0-9][A-Za-z0-9._:\-]{7,127}$/';

    /** أنواع مصادر التخصيص كما في `CustomerRefundService` (إشعار دائن آجل / مرتجع مبيعات آجل). */
    private const SOURCE_MODELS = [
        CustomerRefundService::SOURCE_SALES_RETURN => \App\Models\ReturnDocument::class,
        CustomerRefundService::SOURCE_CREDIT_NOTE => \App\Models\CreditNote::class,
    ];

    public const UNKNOWN_GRACE_MINUTES = 15;

    public const ORPHAN_GRACE_MINUTES = 10;

    public function __construct(
        private readonly PaymentsRolloutControlService $rollout,
        private readonly PaymentGatewayAdapterRegistry $adapters,
        private readonly CustomerRefundService $sources,
        private readonly RefundSourceBalance $balance,
        private readonly TenantContext $tenant,
    ) {}

    // ───────────────────────── الأرصدة (قراءة) ─────────────────────────

    /** متبقي الدفعة القابل للاسترداد: الملتقط − المسترد − Σ المحجوز (غير المؤكَّد). المؤكَّد داخل `refunded_minor` فلا يُخصم مرتين. */
    public function refundablePayment(PaymentAttempt $attempt, ?string $excludingRefundId = null): int
    {
        $reserved = (int) PaymentRefund::query()
            ->where('payment_attempt_id', $attempt->getKey())
            ->whereIn('status', PaymentRefund::PAYMENT_RESERVING)
            ->when($excludingRefundId !== null, fn ($q) => $q->where('id', '<>', $excludingRefundId))
            ->sum('amount_minor');

        return (int) $attempt->captured_minor - (int) $attempt->refunded_minor - $reserved;
    }

    // ───────────────────────── الطلب ─────────────────────────

    /**
     * @param  list<array{source_type: string, source_id: string, amount: int}>  $allocations  source_type: sales_return|credit_note
     */
    public function request(PaymentAttempt $attempt, int $amountMinor, array $allocations, string $idempotencyKey, User $actor): PaymentRefund
    {
        $actor = $this->actor($actor, 'payment_refunds.request');
        $this->assertEnabled();
        if (preg_match(self::IDEMPOTENCY_KEY, $idempotencyKey) !== 1) {
            throw new PaymentRefundException('invalid_idempotency_key', 'مفتاح منع التكرار غير صالح.');
        }
        if ($amountMinor <= 0) {
            throw new PaymentRefundException('invalid_amount', 'مبلغ الاسترداد يجب أن يكون موجباً.');
        }
        $normalized = $this->normalizeAllocations($allocations, $amountMinor);

        $existing = PaymentRefund::query()->where('idempotency_key', $idempotencyKey)->first();
        if ($existing !== null) {
            return $this->replay($existing, $attempt, $amountMinor, $normalized);
        }

        try {
            return DB::transaction(function () use ($attempt, $amountMinor, $normalized, $idempotencyKey, $actor): PaymentRefund {
                $locked = $this->lockAttempt($attempt);
                $this->lockSourceRows($normalized);
                [$partnerId, $branchId] = $this->assertEligible($locked, $amountMinor, $normalized, null);

                $number = PaymentRefund::nextDocumentNumber('PRF', now()->toDateString(), $branchId);
                $refund = PaymentRefund::query()->create([
                    'branch_id' => $branchId,
                    'number' => $number,
                    'partner_id' => $partnerId,
                    'payment_attempt_id' => $locked->getKey(),
                    'payment_gateway_id' => $locked->payment_gateway_id,
                    'amount_minor' => $amountMinor,
                    'currency' => $locked->currency,
                    'idempotency_key' => $idempotencyKey,
                    'requested_by' => $actor->getKey(),
                    'requested_at' => now('UTC'),
                ]);
                // BelongsToBranch يسم الفرع النشط حين يكون فارغاً — التقاط بلا فرع لا يُوسَم بفرعٍ نشط غير ذي صلة.
                if ($refund->branch_id !== $branchId) {
                    $refund->forceFill(['branch_id' => $branchId])->save();
                }
                foreach ($normalized as $allocation) {
                    PaymentRefundAllocation::query()->create([
                        'payment_refund_id' => $refund->getKey(),
                        'source_type' => $allocation['model'],
                        'source_id' => $allocation['source_id'],
                        'amount_minor' => $allocation['amount'],
                    ]);
                }
                $this->event($refund, 'requested', null, PaymentRefund::REQUESTED, $actor, null, ['amount_minor' => $amountMinor]);

                return $refund->fresh('allocations');
            });
        } catch (QueryException $e) {
            // سباق على مفتاح منع التكرار: المعاملة تراجعت بالكامل؛ الفائز يُعاد كما هو.
            $winner = PaymentRefund::query()->where('idempotency_key', $idempotencyKey)->first();
            if ($winner !== null) {
                return $this->replay($winner, $attempt, $amountMinor, $normalized);
            }
            throw $e;
        }
    }

    // ───────────────────────── الاعتماد / الرفض / الإلغاء ─────────────────────────

    public function approve(PaymentRefund $refund, User $actor): PaymentRefund
    {
        $actor = $this->actor($actor, 'payment_refunds.approve');
        $this->assertEnabled();

        return DB::transaction(function () use ($refund, $actor): PaymentRefund {
            [$locked, $attempt] = $this->lockRefund($refund);
            $this->assertStatus($locked, [PaymentRefund::REQUESTED]);
            if ((string) $locked->requested_by === (string) $actor->getKey()) {
                throw new PaymentRefundException('self_approval', 'لا يجوز اعتماد استردادٍ طلبته بنفسك؛ يلزم معتمِد مستقل.');
            }
            $this->assertEligible($attempt, (int) $locked->amount_minor, $this->allocationsOf($locked), (string) $locked->getKey());

            $locked->forceFill(['status' => PaymentRefund::APPROVED, 'approved_by' => $actor->getKey(), 'approved_at' => now('UTC')])->save();
            $this->event($locked, 'approved', PaymentRefund::REQUESTED, PaymentRefund::APPROVED, $actor);

            return $locked;
        });
    }

    public function reject(PaymentRefund $refund, User $actor, string $reason): PaymentRefund
    {
        $actor = $this->actor($actor, 'payment_refunds.approve');
        $reason = $this->reason($reason);

        return DB::transaction(function () use ($refund, $actor, $reason): PaymentRefund {
            [$locked] = $this->lockRefund($refund);
            $this->assertStatus($locked, [PaymentRefund::REQUESTED]);
            if ((string) $locked->requested_by === (string) $actor->getKey()) {
                throw new PaymentRefundException('self_approval', 'طلبك أنت: استعمل الإلغاء بدل الرفض.');
            }
            $locked->forceFill([
                'status' => PaymentRefund::REJECTED, 'rejected_by' => $actor->getKey(), 'rejected_at' => now('UTC'), 'reject_reason' => $reason,
            ])->save();
            $this->event($locked, 'rejected', PaymentRefund::REQUESTED, PaymentRefund::REJECTED, $actor, $reason);

            return $locked;
        });
    }

    /** إلغاء قبل الإرسال: الطالب نفسه أو صاحب صلاحية الاعتماد. */
    public function cancel(PaymentRefund $refund, User $actor, string $reason): PaymentRefund
    {
        $fresh = $this->freshUser($actor);
        $reason = $this->reason($reason);

        return DB::transaction(function () use ($refund, $fresh, $reason): PaymentRefund {
            [$locked] = $this->lockRefund($refund);
            $this->assertStatus($locked, [PaymentRefund::REQUESTED, PaymentRefund::APPROVED]);
            $isRequester = (string) $locked->requested_by === (string) $fresh->getKey();
            if (! $isRequester && ! Rbac::allows((string) $fresh->role, 'payment_refunds.approve')) {
                throw new PaymentRefundException('forbidden', 'لا تملك صلاحية إلغاء هذا الاسترداد.');
            }
            $from = $locked->status;
            $locked->forceFill([
                'status' => PaymentRefund::CANCELLED, 'cancelled_by' => $fresh->getKey(), 'cancelled_at' => now('UTC'), 'cancel_reason' => $reason,
            ])->save();
            $this->event($locked, 'cancelled', $from, PaymentRefund::CANCELLED, $fresh, $reason);

            return $locked;
        });
    }

    // ───────────────────────── الإرسال (خمس مراحل) ─────────────────────────

    /**
     * يرسل استرداداً معتمَداً إلى المزوّد. يعيد المستند بحالته النهائية (`confirmed`/`failed`/`unknown`) أو يرمي `PaymentRefundException`
     * (`busy` ⇒ لم يُحجز شيء، `unrecognized_refund_open`/`provider_unavailable` ⇒ عاد المستند `approved` ولم يُرسَل شيء).
     */
    public function submit(PaymentRefund $refund, ?User $actor = null): PaymentRefund
    {
        if ($actor !== null) {
            $this->actor($actor, 'payment_refunds.approve');
        }
        $this->assertEnabled();

        // المرحلة 1: حجز خانة الدفعة فقط (بلا أي شبكة).
        $claim = DB::transaction(function () use ($refund, $actor): PaymentRefund {
            [$locked, $attempt] = $this->lockRefund($refund);
            $this->assertStatus($locked, [PaymentRefund::APPROVED]);
            $this->assertEligible($attempt, (int) $locked->amount_minor, $this->allocationsOf($locked), (string) $locked->getKey());
            $busy = PaymentRefund::query()
                ->where('payment_attempt_id', $attempt->getKey())
                ->whereIn('status', [PaymentRefund::SUBMITTING, PaymentRefund::UNKNOWN])
                ->exists();
            if ($busy) {
                throw new PaymentRefundException('busy', 'يوجد استرداد آخر قيد الإرسال على هذه الدفعة؛ أعد المحاولة لاحقاً.');
            }
            $locked->forceFill(['status' => PaymentRefund::SUBMITTING])->save();
            $this->event($locked, 'submitting', PaymentRefund::APPROVED, PaymentRefund::SUBMITTING, $actor);

            return $locked;
        });

        $attempt = PaymentAttempt::query()->findOrFail($claim->payment_attempt_id);
        $gateway = PaymentGateway::query()->findOrFail($claim->payment_gateway_id);

        // المرحلة 2: خط الأساس من المزوّد — خارج أي معاملة/قفل.
        try {
            $snapshot = $this->adapters->for($attempt->provider)->fetchPayment($gateway, (string) $attempt->provider_payment_id);
        } catch (Throwable $e) {
            $this->abortSubmission($claim, 'provider_unavailable');
            throw new PaymentRefundException('provider_unavailable', 'تعذّر قراءة حالة الدفعة من المزوّد؛ لم يُرسَل شيء.', $e);
        }

        // المرحلة 3: التحقق من الأساس + سجل الاستدعاء.
        $invocation = DB::transaction(function () use ($claim, $snapshot): ?PaymentRefundAttempt {
            [$locked, $attempt] = $this->lockRefund($claim);
            $this->assertStatus($locked, [PaymentRefund::SUBMITTING]);
            $local = (int) $attempt->refunded_minor;
            if ($snapshot->refundedMinor > $local) {
                // استرداد خارجي غير معترَف به: لا استدعاء، يعود المستند approved وتُوسم الدفعة.
                $this->flagAttempt($attempt, $snapshot->refundedMinor, 'external_refund_flagged', 'submit_baseline');
                $locked->forceFill(['status' => PaymentRefund::APPROVED])->save();
                $this->event($locked, 'submit_aborted', PaymentRefund::SUBMITTING, PaymentRefund::APPROVED, null, 'unrecognized_refund', ['observed_minor' => $snapshot->refundedMinor, 'local_minor' => $local]);

                return null;
            }
            if ($snapshot->refundedMinor < $local) {
                $locked->forceFill(['status' => PaymentRefund::FAILED, 'failure_code' => 'baseline_regressed'])->save();
                $this->event($locked, 'failed', PaymentRefund::SUBMITTING, PaymentRefund::FAILED, null, 'baseline_regressed', ['observed_minor' => $snapshot->refundedMinor, 'local_minor' => $local]);

                return null;
            }

            return PaymentRefundAttempt::query()->create([
                'payment_refund_id' => $locked->getKey(),
                'seq' => (int) PaymentRefundAttempt::query()->where('payment_refund_id', $locked->getKey())->max('seq') + 1,
                'baseline_refunded_minor' => $snapshot->refundedMinor,
                'amount_minor' => (int) $locked->amount_minor,
            ]);
        });

        if ($invocation === null) {
            $current = PaymentRefund::query()->findOrFail($claim->getKey());
            if ($current->status === PaymentRefund::APPROVED) {
                throw new PaymentRefundException('unrecognized_refund_open', 'رُصد استرداد خارجي على هذه الدفعة؛ لم يُرسَل شيء ويلزم حسم بشري.');
            }

            return $current;
        }

        // المرحلة 4: استدعاء المزوّد — خارج أي معاملة. لا إعادة محاولة.
        $refunder = $this->adapters->refunder($attempt->provider);
        $outcome = null;
        $error = null;
        try {
            if ($refunder === null) {
                throw new PaymentRefundRejectedException('refunds_unsupported', 'المزوّد لا يدعم الاسترداد.');
            }
            $outcome = $refunder->refundPayment($gateway, (string) $attempt->provider_payment_id, (int) $claim->amount_minor);
        } catch (PaymentRefundRejectedException $e) {
            $error = ['kind' => 'rejected', 'code' => $e->reason];
        } catch (PaymentRefundUnknownException $e) {
            $error = ['kind' => 'unknown', 'code' => $e->reason];
        } catch (Throwable) {
            // خارج العقد بعد الإرسال: قد يكون نُفِّذ ⇒ غير معروف (لا يُعدّ رفضاً أبداً).
            $error = ['kind' => 'unknown', 'code' => 'unexpected_exception'];
        }

        // المرحلة 5: النتيجة.
        return DB::transaction(function () use ($claim, $invocation, $outcome, $error): PaymentRefund {
            [$locked, $attempt] = $this->lockRefund($claim);
            $this->assertStatus($locked, [PaymentRefund::SUBMITTING]);

            if ($outcome instanceof PaymentProviderRefund) {
                return $this->confirm($locked, $attempt, $invocation, $outcome, null, 'direct');
            }

            $kind = $error['kind'] ?? 'unknown';
            PaymentRefundAttemptResult::query()->create([
                'payment_refund_attempt_id' => $invocation->getKey(),
                'outcome' => $kind === 'rejected' ? PaymentRefundAttemptResult::OUTCOME_REJECTED : PaymentRefundAttemptResult::OUTCOME_UNKNOWN,
                'error_code' => substr((string) ($error['code'] ?? ''), 0, 64),
            ]);
            if ($kind === 'rejected') {
                $locked->forceFill(['status' => PaymentRefund::FAILED, 'failure_code' => substr((string) $error['code'], 0, 64)])->save();
                $this->event($locked, 'failed', PaymentRefund::SUBMITTING, PaymentRefund::FAILED, null, (string) $error['code']);
            } else {
                $locked->forceFill(['status' => PaymentRefund::UNKNOWN, 'failure_code' => substr((string) ($error['code'] ?? ''), 0, 64)])->save();
                $this->event($locked, 'unknown', PaymentRefund::SUBMITTING, PaymentRefund::UNKNOWN, null, (string) ($error['code'] ?? ''));
            }

            return $locked;
        });
    }

    // ───────────────────────── المطابقة والحسم ─────────────────────────

    /**
     * مطابقة نظامية لاسترداد `unknown` (مجدولة): تصنّف الدليل ولا تؤكّد وحدها تساوي الفرق.
     *  • observed = baseline بعد المهلة ⇒ لم يُطبَّق شيء ⇒ إعادة واحدة (`unknown → approved`) إن بقي `retry_count < 1`، وإلا يبقى للحسم البشري.
     *  • observed = baseline + amount ⇒ `probable_applied`: يبقى unknown (قرار بشري).
     *  • غير ذلك ⇒ يبقى unknown للمراجعة.
     *
     * @return 'retry_scheduled'|'probable_applied'|'needs_human'|'too_early'|'skipped'|'provider_unavailable'
     */
    public function reconcileUnknown(PaymentRefund $refund, int $graceMinutes = self::UNKNOWN_GRACE_MINUTES): string
    {
        $refund = PaymentRefund::query()->find($refund->getKey());
        if ($refund === null || $refund->status !== PaymentRefund::UNKNOWN) {
            return 'skipped';
        }
        $invocation = $this->latestInvocation($refund);
        if ($invocation === null) {
            return 'skipped';
        }
        if ($invocation->created_at !== null && $invocation->created_at->gt(now('UTC')->subMinutes($graceMinutes))) {
            return 'too_early';
        }

        $attempt = PaymentAttempt::query()->findOrFail($refund->payment_attempt_id);
        $gateway = PaymentGateway::query()->findOrFail($refund->payment_gateway_id);
        try {
            $snapshot = $this->adapters->for($attempt->provider)->fetchPayment($gateway, (string) $attempt->provider_payment_id);
        } catch (Throwable) {
            return 'provider_unavailable';
        }
        $observed = $snapshot->refundedMinor;
        $baseline = (int) $invocation->baseline_refunded_minor;
        $amount = (int) $invocation->amount_minor;

        return DB::transaction(function () use ($refund, $invocation, $observed, $baseline, $amount): string {
            [$locked] = $this->lockRefund($refund);
            if ($locked->status !== PaymentRefund::UNKNOWN) {
                return 'skipped';
            }
            if ($observed === $baseline && (int) $locked->retry_count < 1) {
                PaymentRefundAttemptResult::query()->create([
                    'payment_refund_attempt_id' => $invocation->getKey(),
                    'outcome' => PaymentRefundAttemptResult::OUTCOME_REJECTED,
                    'observed_refunded_minor' => $observed,
                    'error_code' => 'reconciled_not_applied',
                ]);
                $locked->forceFill(['status' => PaymentRefund::APPROVED, 'retry_count' => (int) $locked->retry_count + 1])->save();
                $this->event($locked, 'retry_scheduled', PaymentRefund::UNKNOWN, PaymentRefund::APPROVED, null, 'reconciled_not_applied', ['observed_minor' => $observed, 'baseline_minor' => $baseline]);

                return 'retry_scheduled';
            }
            $verdict = $observed === $baseline + $amount ? 'probable_applied' : 'needs_human';
            $last = PaymentRefundEvent::query()->where('payment_refund_id', $locked->getKey())->where('action', 'reconcile_'.$verdict)->latest('created_at')->first();
            if ($last === null || (int) ($last->meta['observed_minor'] ?? -1) !== $observed) {
                $this->event($locked, 'reconcile_'.$verdict, PaymentRefund::UNKNOWN, PaymentRefund::UNKNOWN, null, null, ['observed_minor' => $observed, 'baseline_minor' => $baseline, 'amount_minor' => $amount]);
            }

            return $verdict;
        });
    }

    /** `submitting` بلا سجل استدعاء لمدة تتجاوز المهلة ⇒ لم يُرسَل شيء قطعاً ⇒ يعود `approved` (تُحرَّر الخانة). */
    public function recoverOrphanedSubmission(PaymentRefund $refund, int $graceMinutes = self::ORPHAN_GRACE_MINUTES): bool
    {
        return DB::transaction(function () use ($refund, $graceMinutes): bool {
            [$locked] = $this->lockRefund($refund);
            if ($locked->status !== PaymentRefund::SUBMITTING || $this->latestInvocation($locked) !== null) {
                return false;
            }
            if ($locked->updated_at !== null && $locked->updated_at->gt(now('UTC')->subMinutes($graceMinutes))) {
                return false;
            }
            $locked->forceFill(['status' => PaymentRefund::APPROVED])->save();
            $this->event($locked, 'orphan_recovered', PaymentRefund::SUBMITTING, PaymentRefund::APPROVED, null, 'no_invocation_record');

            return true;
        });
    }

    /**
     * حسم بشري لاسترداد `unknown`: `confirm` («هذا استردادنا») يشترط دليلاً من المزوّد (تراكمي ≥ الأساس + المبلغ)، و`not_applied` («خارجي/لم يُطبَّق») يُفشل المستند
     * ويُوسم الدفعة إن رُصد استرداد غير معترَف به. صلاحية `payment_refunds.resolve_unknown`، وسبب ≥ 5 أحرف، وتدقيق ثابت.
     */
    public function resolveUnknown(PaymentRefund $refund, User $actor, string $decision, string $reason): PaymentRefund
    {
        $actor = $this->actor($actor, 'payment_refunds.resolve_unknown');
        $reason = $this->reason($reason);
        if (! in_array($decision, ['confirm', 'not_applied'], true)) {
            throw new PaymentRefundException('invalid_state', 'قرار غير معروف.');
        }
        $current = PaymentRefund::query()->findOrFail($refund->getKey());
        $this->assertStatus($current, [PaymentRefund::UNKNOWN]);
        $invocation = $this->latestInvocation($current);
        if ($invocation === null) {
            throw new PaymentRefundException('evidence_missing', 'لا سجل استدعاء لهذا الاسترداد.');
        }
        $attempt = PaymentAttempt::query()->findOrFail($current->payment_attempt_id);
        $gateway = PaymentGateway::query()->findOrFail($current->payment_gateway_id);
        try {
            $snapshot = $this->adapters->for($attempt->provider)->fetchPayment($gateway, (string) $attempt->provider_payment_id);
        } catch (Throwable $e) {
            throw new PaymentRefundException('provider_unavailable', 'تعذّر قراءة حالة الدفعة من المزوّد.', $e);
        }

        return DB::transaction(function () use ($current, $actor, $decision, $reason, $invocation, $snapshot): PaymentRefund {
            [$locked, $attempt] = $this->lockRefund($current);
            $this->assertStatus($locked, [PaymentRefund::UNKNOWN]);
            $baseline = (int) $invocation->baseline_refunded_minor;
            $amount = (int) $invocation->amount_minor;

            if ($decision === 'confirm') {
                if ($snapshot->refundedMinor < $baseline + $amount) {
                    throw new PaymentRefundException('evidence_missing', 'لا دليل لدى المزوّد على تطبيق هذا الاسترداد.');
                }
                $refund = new PaymentProviderRefund((string) $attempt->provider_payment_id, $snapshot->refundedMinor, $snapshot->currency, null);

                return $this->confirm($locked, $attempt, $invocation, $refund, $actor, 'human', $reason);
            }

            PaymentRefundAttemptResult::query()->create([
                'payment_refund_attempt_id' => $invocation->getKey(),
                'outcome' => PaymentRefundAttemptResult::OUTCOME_REJECTED,
                'observed_refunded_minor' => $snapshot->refundedMinor,
                'error_code' => 'resolved_not_applied',
            ]);
            $locked->forceFill(['status' => PaymentRefund::FAILED, 'failure_code' => 'resolved_not_applied'])->save();
            $this->event($locked, 'resolved_not_applied', PaymentRefund::UNKNOWN, PaymentRefund::FAILED, $actor, $reason, ['observed_minor' => $snapshot->refundedMinor]);
            if ($snapshot->refundedMinor > (int) $attempt->refunded_minor) {
                $this->flagAttempt($attempt, $snapshot->refundedMinor, 'external_refund_flagged', 'resolve_unknown', $actor);
            }

            return $locked;
        });
    }

    /**
     * حسم علم الاسترداد الخارجي: يزامن التراكمي المحلي مع المزوّد **ويُلغي ذرّياً** كل مستند غير نهائي سابق للإرسال على الدفعة (`requested`/`approved`، سبب
     * `external_refund_resolved`) لأن الاسترداد الخارجي لا يستهلك مصدراً تجارياً (قراره المحاسبي مؤجَّل) فيُعاد الطلب والاعتماد المستقل على السعة الجديدة.
     * يشترط أن لا يكون على الدفعة استرداد قيد الطيران. صلاحية `payment_refunds.resolve_unknown` وسبب مسجَّل.
     */
    public function resolveExternalRefund(PaymentAttempt $attempt, User $actor, string $reason): PaymentAttempt
    {
        $actor = $this->actor($actor, 'payment_refunds.resolve_unknown');
        $reason = $this->reason($reason);
        $current = PaymentAttempt::query()->findOrFail($attempt->getKey());
        if ($current->unrecognized_refund_at === null) {
            throw new PaymentRefundException('no_unrecognized_refund', 'لا علم استرداد خارجي على هذه الدفعة.');
        }
        $gateway = PaymentGateway::query()->findOrFail($current->payment_gateway_id);
        try {
            $snapshot = $this->adapters->for($current->provider)->fetchPayment($gateway, (string) $current->provider_payment_id);
        } catch (Throwable $e) {
            throw new PaymentRefundException('provider_unavailable', 'تعذّر قراءة حالة الدفعة من المزوّد.', $e);
        }

        return DB::transaction(function () use ($current, $actor, $reason, $snapshot): PaymentAttempt {
            $locked = $this->lockAttempt($current);
            if ($locked->unrecognized_refund_at === null) {
                throw new PaymentRefundException('no_unrecognized_refund', 'لا علم استرداد خارجي على هذه الدفعة.');
            }
            if (PaymentRefund::query()->where('payment_attempt_id', $locked->getKey())->whereIn('status', [PaymentRefund::SUBMITTING, PaymentRefund::UNKNOWN])->exists()) {
                throw new PaymentRefundException('busy', 'يوجد استرداد قيد الإرسال/غير معروف على هذه الدفعة؛ احسمه أولاً.');
            }
            if ($snapshot->refundedMinor > (int) $locked->captured_minor) {
                throw new PaymentRefundException('baseline_regressed', 'التراكمي لدى المزوّد يتجاوز الملتقط؛ بيانات معيبة.');
            }
            $before = (int) $locked->refunded_minor;
            $after = max($before, $snapshot->refundedMinor);

            $cancelled = [];
            $pending = PaymentRefund::query()->where('payment_attempt_id', $locked->getKey())
                ->whereIn('status', [PaymentRefund::REQUESTED, PaymentRefund::APPROVED])->orderBy('id')->lockForUpdate()->get();
            foreach ($pending as $refund) {
                $from = $refund->status;
                $refund->forceFill([
                    'status' => PaymentRefund::CANCELLED, 'cancelled_by' => $actor->getKey(), 'cancelled_at' => now('UTC'), 'cancel_reason' => 'external_refund_resolved',
                ])->save();
                $this->event($refund, 'cancelled', $from, PaymentRefund::CANCELLED, $actor, 'external_refund_resolved', ['before_minor' => $before, 'after_minor' => $after]);
                $cancelled[] = (string) $refund->getKey();
            }

            $locked->forceFill(['refunded_minor' => $after, 'unrecognized_refund_at' => null, 'unrecognized_refund_minor' => null])->save();
            PaymentRefundEvent::query()->create([
                'payment_refund_id' => null,
                'payment_attempt_id' => $locked->getKey(),
                'action' => 'external_refund_resolved',
                'actor_id' => $actor->getKey(),
                'reason' => $reason,
                'meta' => ['before_minor' => $before, 'after_minor' => $after, 'cancelled_refunds' => $cancelled],
            ]);

            return $locked;
        });
    }

    // ───────────────────────── الداخل ─────────────────────────

    /** تأكيد استرداد: نتيجة نهائية + تحديث التراكمي المعترَف به (الأساس + المبلغ) + وسم الفائض الخارجي إن وُجد. يُستدعى داخل معاملة وتحت القفل. */
    private function confirm(PaymentRefund $locked, PaymentAttempt $attempt, PaymentRefundAttempt $invocation, PaymentProviderRefund $provider, ?User $actor, string $via, ?string $reason = null): PaymentRefund
    {
        $baseline = (int) $invocation->baseline_refunded_minor;
        $amount = (int) $invocation->amount_minor;
        $explained = $baseline + $amount;
        $excess = max(0, $provider->refundedMinor - $explained);

        PaymentRefundAttemptResult::query()->create([
            'payment_refund_attempt_id' => $invocation->getKey(),
            'outcome' => PaymentRefundAttemptResult::OUTCOME_CONFIRMED,
            'observed_refunded_minor' => $provider->refundedMinor,
            'provider_ref' => substr($provider->providerPaymentId, 0, 191),
            'excess_minor' => $excess,
        ]);

        $from = $locked->status;
        $locked->forceFill([
            'status' => PaymentRefund::CONFIRMED,
            'confirmed_at' => now('UTC'),
            'provider_refund_ref' => substr($provider->providerPaymentId, 0, 191),
            'provider_refunded_minor' => $provider->refundedMinor,
            'provider_refunded_at' => $provider->refundedAt,
            'excess_minor' => $excess,
            'failure_code' => null,
            'posting_status' => PaymentRefund::POSTING_PENDING,
        ])->save();

        // المعترَف به محلياً = الأساس + المبلغ فقط (جزء مفسَّر)؛ الفائض يبقى غير مفسَّر حتى الحسم البشري. `refunded_minor` لا ينقص ولا يتجاوز الملتقط.
        $recognized = min((int) $attempt->captured_minor, max((int) $attempt->refunded_minor, $explained));
        if ($recognized !== (int) $attempt->refunded_minor) {
            $attempt->forceFill(['refunded_minor' => $recognized])->save();
        }
        $this->event($locked, 'confirmed', $from, PaymentRefund::CONFIRMED, $actor, $reason, ['via' => $via, 'observed_minor' => $provider->refundedMinor, 'excess_minor' => $excess]);
        if ($excess > 0) {
            $this->flagAttempt($attempt, $provider->refundedMinor, 'external_refund_flagged', 'confirm_excess', $actor);
        }

        return $locked;
    }

    private function abortSubmission(PaymentRefund $claim, string $code): void
    {
        DB::transaction(function () use ($claim, $code): void {
            [$locked] = $this->lockRefund($claim);
            if ($locked->status === PaymentRefund::SUBMITTING && $this->latestInvocation($locked) === null) {
                $locked->forceFill(['status' => PaymentRefund::APPROVED])->save();
                $this->event($locked, 'submit_aborted', PaymentRefund::SUBMITTING, PaymentRefund::APPROVED, null, $code);
            }
        });
    }

    private function flagAttempt(PaymentAttempt $attempt, int $observed, string $action, string $source, ?User $actor = null): void
    {
        $first = $attempt->unrecognized_refund_at === null;
        $attempt->forceFill([
            'unrecognized_refund_at' => $attempt->unrecognized_refund_at ?? now('UTC'),
            'unrecognized_refund_minor' => max($observed, (int) $attempt->unrecognized_refund_minor),
        ])->save();
        PaymentRefundEvent::query()->create([
            'payment_refund_id' => null,
            'payment_attempt_id' => $attempt->getKey(),
            'action' => $first ? $action : 'external_refund_updated',
            'actor_id' => $actor?->getKey(),
            'meta' => ['observed_minor' => $observed, 'local_minor' => (int) $attempt->refunded_minor, 'source' => $source],
        ]);
    }

    /**
     * أهلية الاسترداد وسقوفه (تُعاد داخل القفل عند الطلب والاعتماد والإرسال).
     *
     * @param  list<array{kind: string, model: class-string, source_id: string, amount: int}>  $normalized
     * @return array{0: string, 1: ?string} [العميل المشتق من الالتقاط، فرع الالتقاط]
     */
    private function assertEligible(PaymentAttempt $attempt, int $amountMinor, array $normalized, ?string $excludingRefundId): array
    {
        if ($attempt->capture_status !== PaymentAttempt::STATUS_CAPTURED) {
            throw new PaymentRefundException('not_captured', 'المحاولة غير ملتقطة.');
        }
        if ($attempt->posting_status !== PaymentAttempt::POSTING_POSTED) {
            throw new PaymentRefundException('capture_not_posted', 'التقاط هذه الدفعة لم يُرحَّل بعد؛ لا يُسترد قبل ترحيله.');
        }
        $payableKey = (string) $attempt->payable_key;
        $prefix = InvoicePaymentRequest::PAYABLE_TYPE.':';
        $request = str_starts_with($payableKey, $prefix) ? InvoicePaymentRequest::query()->find(substr($payableKey, strlen($prefix))) : null;
        if ($request === null || $request->partner_id === null) {
            throw new PaymentRefundException('not_refundable', 'هذه الدفعة ليست دفعة فاتورة بعميل معروف؛ لا استرداد عبر البوابة.');
        }
        $partnerId = (string) $request->partner_id;

        if ($attempt->dispute_status === PaymentAttempt::DISPUTE_OPEN) {
            throw new PaymentRefundException('dispute_active', 'على الدفعة نزاع مفتوح؛ لا استرداد حتى يُحسم.');
        }
        if ($attempt->unrecognized_refund_at !== null) {
            throw new PaymentRefundException('unrecognized_refund_open', 'رُصد استرداد خارجي على هذه الدفعة؛ يلزم حسمه أولاً.');
        }

        $gateway = PaymentGateway::query()->find($attempt->payment_gateway_id);
        if ($gateway === null || in_array($gateway->status, [PaymentGateway::STATUS_DRAFT, PaymentGateway::STATUS_REVOKED], true)) {
            throw new PaymentRefundException('gateway_unavailable', 'اتصال البوابة غير متاح.');
        }
        if ($this->adapters->refunder($attempt->provider) === null || ! $this->adapters->for($attempt->provider)->capabilities()->refunds) {
            throw new PaymentRefundException('refunds_unsupported', 'هذه البوابة لا تدعم الاسترداد.');
        }

        $tenantCurrency = (string) (Tenant::query()->whereKey($this->tenant->id())->value('currency') ?: 'SAR');
        if (strcasecmp((string) $attempt->currency, $tenantCurrency) !== 0) {
            throw new PaymentRefundException('currency_mismatch', 'عملة الدفعة تخالف عملة المؤسسة.');
        }

        $sources = [];
        foreach ($normalized as $allocation) {
            try {
                $source = $this->sources->loadSource($allocation['model'], $allocation['source_id']);
            } catch (RuntimeException $e) {
                throw new PaymentRefundException('source_ineligible', $e->getMessage(), $e);
            }
            if ((string) $source->partner_id !== $partnerId) {
                throw new PaymentRefundException('partner_mismatch', 'التصحيح التجاري المخصَّص لا يخص عميل الدفعة.');
            }
            try {
                $this->sources->assertSourceEligible($source, $partnerId);
            } catch (RuntimeException $e) {
                throw new PaymentRefundException('source_ineligible', $e->getMessage(), $e);
            }
            $refundable = $this->balance->refundable($source, $excludingRefundId);
            if ($allocation['amount'] > $refundable) {
                throw new PaymentRefundException('exceeds_source_balance', "مبلغ التخصيص ({$allocation['amount']}) يتجاوز الرصيد القابل للاسترداد على التصحيح ({$refundable}).");
            }
            $sources[] = $source;
        }
        try {
            $sourceBranch = $this->sources->sharedSourceBranch($sources);
        } catch (RuntimeException $e) {
            throw new PaymentRefundException('source_branch_mismatch', $e->getMessage(), $e);
        }
        if ($sourceBranch !== $attempt->branch_id) {
            throw new PaymentRefundException('capture_branch_mismatch', 'فرع التصحيح التجاري يخالف فرع التقاط الدفعة.');
        }
        $context = app(BranchContext::class);
        if ($context->has() && $context->id() !== $attempt->branch_id) {
            throw new PaymentRefundException('branch_context_mismatch', 'الفرع النشط يخالف فرع الدفعة.');
        }

        $capacity = $this->refundablePayment($attempt, $excludingRefundId);
        if ($amountMinor > $capacity) {
            throw new PaymentRefundException('exceeds_payment_capacity', "مبلغ الاسترداد يتجاوز المتبقي القابل للاسترداد من الدفعة ({$capacity}).");
        }

        return [$partnerId, $attempt->branch_id];
    }

    /**
     * @param  list<array{source_type?: string, source_id?: string, amount?: int}>  $allocations
     * @return list<array{kind: string, model: class-string, source_id: string, amount: int}>
     */
    private function normalizeAllocations(array $allocations, int $amount): array
    {
        if ($allocations === []) {
            throw new PaymentRefundException('invalid_allocations', 'الاسترداد يحتاج تخصيصاً واحداً على الأقل على تصحيح تجاري مرحّل.');
        }
        $normalized = [];
        $seen = [];
        $sum = 0;
        foreach ($allocations as $allocation) {
            $kind = $allocation['source_type'] ?? null;
            $sourceId = $allocation['source_id'] ?? null;
            $allocated = (int) ($allocation['amount'] ?? 0);
            if (! is_string($kind) || ! isset(self::SOURCE_MODELS[$kind])) {
                throw new PaymentRefundException('invalid_allocations', 'نوع مصدر التخصيص يجب أن يكون مرتجع مبيعات أو إشعاراً دائناً.');
            }
            if (! is_string($sourceId) || $sourceId === '' || $allocated <= 0) {
                throw new PaymentRefundException('invalid_allocations', 'كل تخصيص يحتاج تصحيحاً تجارياً ومبلغاً موجباً.');
            }
            if (isset($seen[$kind.':'.$sourceId])) {
                throw new PaymentRefundException('invalid_allocations', 'لا يمكن تخصيص التصحيح نفسه مرتين في استرداد واحد.');
            }
            $seen[$kind.':'.$sourceId] = true;
            $normalized[] = ['kind' => $kind, 'model' => self::SOURCE_MODELS[$kind], 'source_id' => $sourceId, 'amount' => $allocated];
            $sum += $allocated;
        }
        if ($sum !== $amount) {
            throw new PaymentRefundException('invalid_allocations', "مجموع التخصيصات ({$sum}) يجب أن يساوي مبلغ الاسترداد ({$amount}).");
        }

        return $normalized;
    }

    /** @return list<array{kind: string, model: class-string, source_id: string, amount: int}> */
    private function allocationsOf(PaymentRefund $refund): array
    {
        $kinds = array_flip(self::SOURCE_MODELS);

        return $refund->allocations()->orderBy('source_type')->orderBy('source_id')->get()->map(fn (PaymentRefundAllocation $a) => [
            'kind' => $kinds[$a->source_type], 'model' => $a->source_type, 'source_id' => (string) $a->source_id, 'amount' => (int) $a->amount_minor,
        ])->all();
    }

    /** @param  list<array{kind: string, model: class-string, source_id: string, amount: int}>  $normalized */
    private function replay(PaymentRefund $existing, PaymentAttempt $attempt, int $amountMinor, array $normalized): PaymentRefund
    {
        $sig = fn (array $rows): string => json_encode(collect($rows)->map(fn ($r) => [$r['model'], $r['source_id'], $r['amount']])->sortBy(fn ($r) => $r[0].$r[1])->values()->all());
        if ((string) $existing->payment_attempt_id !== (string) $attempt->getKey()
            || (int) $existing->amount_minor !== $amountMinor
            || $sig($this->allocationsOf($existing)) !== $sig($normalized)) {
            throw new PaymentRefundException('idempotency_conflict', 'مفتاح منع التكرار مستعمل لطلب مختلف.');
        }

        return $existing->load('allocations');
    }

    private function latestInvocation(PaymentRefund $refund): ?PaymentRefundAttempt
    {
        return PaymentRefundAttempt::query()->where('payment_refund_id', $refund->getKey())->orderByDesc('seq')->first();
    }

    private function lockAttempt(PaymentAttempt $attempt): PaymentAttempt
    {
        $locked = PaymentAttempt::query()->lockForUpdate()->find($attempt->getKey());
        if ($locked === null) {
            throw new PaymentRefundException('attempt_not_found', 'محاولة الدفع غير موجودة.');
        }

        return $locked;
    }

    /**
     * يقفل المحاولة ثم صف الاسترداد (الترتيب الثابت: دفعة ← استرداد).
     *
     * @return array{0: PaymentRefund, 1: PaymentAttempt}
     */
    private function lockRefund(PaymentRefund $refund): array
    {
        $attemptId = PaymentRefund::query()->whereKey($refund->getKey())->value('payment_attempt_id');
        if ($attemptId === null) {
            throw new PaymentRefundException('refund_not_found', 'الاسترداد غير موجود.');
        }
        $attempt = PaymentAttempt::query()->lockForUpdate()->find($attemptId);
        if ($attempt === null) {
            throw new PaymentRefundException('attempt_not_found', 'محاولة الدفع غير موجودة.');
        }
        $locked = PaymentRefund::query()->lockForUpdate()->find($refund->getKey());
        if ($locked === null) {
            throw new PaymentRefundException('refund_not_found', 'الاسترداد غير موجود.');
        }
        $locked->load('allocations');

        return [$locked, $attempt];
    }

    /** @param  list<array{kind: string, model: class-string, source_id: string, amount: int}>  $normalized */
    private function lockSourceRows(array $normalized): void
    {
        $this->sources->lockSources(collect($normalized)->map(fn (array $row) => ['source_type' => $row['model'], 'source_id' => $row['source_id']]));
    }

    /** @param  list<string>  $allowed */
    private function assertStatus(PaymentRefund $refund, array $allowed): void
    {
        if (! in_array($refund->status, $allowed, true)) {
            throw new PaymentRefundException('invalid_state', 'حالة الاسترداد لا تسمح بهذا الإجراء.');
        }
    }

    private function reason(string $reason): string
    {
        $reason = trim($reason);
        if (mb_strlen($reason) < 5) {
            throw new PaymentRefundException('reason_required', 'السبب مطلوب (٥ أحرف على الأقل).');
        }

        return mb_substr($reason, 0, 500);
    }

    private function assertEnabled(): void
    {
        $state = $this->rollout->effectiveForCurrentTenant();
        if (! $state->enabled) {
            throw new PaymentRefundException(
                $state->platformStopped ? 'platform_stop' : 'rollout_disabled',
                $state->platformStopped ? 'المدفوعات الإلكترونية موقوفة مؤقتاً من المنصة.' : 'المدفوعات الإلكترونية غير مفعّلة لهذه المؤسسة.',
            );
        }
    }

    private function freshUser(User $actor): User
    {
        // يُعاد تحميل الفاعل من القاعدة: نموذج محمَّل قبل تعطيله/حذفه/خفض دوره لا يُوثق به.
        $fresh = $this->tenant->has() && $actor->getKey() !== null
            ? User::query()->whereKey($actor->getKey())->where('tenant_id', (string) $this->tenant->id())->where('is_active', true)->first()
            : null;
        if ($fresh === null) {
            throw new PaymentRefundException('forbidden', 'المستخدم غير مخوّل.');
        }

        return $fresh;
    }

    private function actor(User $actor, string $permission): User
    {
        $fresh = $this->freshUser($actor);
        if (! Rbac::allows((string) $fresh->role, $permission)) {
            throw new PaymentRefundException('forbidden', 'ليست لديك صلاحية هذا الإجراء.');
        }

        return $fresh;
    }

    /** @param  array<string, mixed>|null  $meta */
    private function event(PaymentRefund $refund, string $action, ?string $from, ?string $to, ?User $actor = null, ?string $reason = null, ?array $meta = null): void
    {
        PaymentRefundEvent::query()->create([
            'payment_refund_id' => $refund->getKey(),
            'payment_attempt_id' => $refund->payment_attempt_id,
            'action' => $action,
            'from_status' => $from,
            'to_status' => $to,
            'actor_id' => $actor?->getKey(),
            'reason' => $reason !== null ? mb_substr($reason, 0, 500) : null,
            'meta' => $meta,
        ]);
    }
}
