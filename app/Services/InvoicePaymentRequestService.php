<?php

namespace App\Services;

use App\Models\Invoice;
use App\Models\InvoicePaymentRequest;
use App\Models\PaymentAttempt;
use App\Support\PaymentLinkToken;
use App\Models\PaymentGateway;
use App\Models\User;
use App\Support\InvoicePayable;
use App\Support\PaymentNotPayableException;
use App\Support\PaymentOrchestrationException;
use App\Support\Rbac;
use App\Tenancy\TenantContext;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/**
 * طلبات دفع الفواتير (PAY-H2-02b، ADR-0006): إنشاء/إلغاء/إدراج + بدء محاولة دفع عبر `PaymentOrchestrator`. **لا أثر محاسبي هنا**
 * (لا سند ولا قيد؛ الترحيل شريحة H2-02c).
 *
 * D-16: الدفع الجزئي ممنوع افتراضياً ويُفعَّل لكل رابط (`allow_partial`) ولا يتجاوز المتبقي. D-24: التقاط فوري فقط.
 * أخطاء العمل: `PaymentOrchestrationException` برمز ثابت يترجمه العميل.
 */
final class InvoicePaymentRequestService
{
    /** سقف مسح المكنسة في التشغيل الواحد (حماية من مسح غير محدود). */
    private const SWEEP_SCAN_CAP = 2000;

    public function __construct(
        private readonly PaymentOrchestrator $orchestrator,
        private readonly PaymentsRolloutControlService $rollout,
        private readonly TenantContext $tenant,
    ) {}

    /** @return Collection<int, InvoicePaymentRequest> */
    public function listForInvoice(Invoice $invoice): Collection
    {
        return InvoicePaymentRequest::query()->where('invoice_id', $invoice->getKey())->orderByDesc('created_at')->get();
    }

    public function find(string $id): InvoicePaymentRequest
    {
        return InvoicePaymentRequest::query()->findOrFail($id);
    }

    public function create(Invoice $invoice, PaymentGateway $gateway, ?User $actor, bool $allowPartial = false, ?CarbonInterface $expiresAt = null): InvoicePaymentRequest
    {
        $this->assertActor($actor);
        $this->assertEnabled();

        $invoice = Invoice::query()->findOrFail($invoice->getKey());
        if (! $invoice->isPosted() || $invoice->remaining() <= 0) {
            throw new PaymentOrchestrationException('invoice_not_payable', 'الفاتورة غير مرحَّلة أو مسدَّدة بالكامل.');
        }
        if (! filled($invoice->partner_id)) {
            throw new PaymentOrchestrationException('partner_required', 'الدفع الإلكتروني يتطلب فاتورة لها طرف (عميل).');
        }
        $gateway = PaymentGateway::query()->find($gateway->getKey());
        if ($gateway === null || ! $gateway->isUsable()) {
            throw new PaymentOrchestrationException('gateway_unavailable', 'اتصال البوابة غير مفعّل.');
        }
        if ($gateway->requiresVerification() && $gateway->verified_at === null) {
            throw new PaymentOrchestrationException('gateway_unverified', 'أسرار الاتصال غير متحقَّق منها بعد.');
        }
        if ($expiresAt !== null && $expiresAt->isPast()) {
            throw new PaymentOrchestrationException('invalid_expiry', 'تاريخ الانتهاء يجب أن يكون في المستقبل.');
        }

        try {
            return DB::transaction(fn () => InvoicePaymentRequest::query()->create([
                'invoice_id' => $invoice->getKey(),
                'partner_id' => $invoice->partner_id,
                'payment_gateway_id' => $gateway->getKey(),
                'currency' => strtoupper((string) $this->tenantCurrency($invoice)),
                'allow_partial' => $allowPartial,
                'expires_at' => $expiresAt,
                'created_by' => $actor?->getKey(),
            ]));
        } catch (QueryException $e) {
            // فهرس القاعدة الفريد: طلب مفتوح واحد لكل فاتورة (يغطي السباق أيضاً).
            if ($this->isUniqueViolation($e)) {
                throw new PaymentOrchestrationException('open_request_exists', 'يوجد طلب دفع مفتوح لهذه الفاتورة.', $e);
            }
            throw $e;
        }
    }

    /**
     * إلغاء طلب مفتوح. محاولته النشطة (إن وُجدت) تُلغى عبر المنسّق أولاً؛ إن حُسمت ملتقَطةً لا يُلغى الطلب (الدفع حقيقة).
     */
    public function cancel(InvoicePaymentRequest $request, ?User $actor): InvoicePaymentRequest
    {
        $this->assertActor($actor);
        $request = InvoicePaymentRequest::query()->findOrFail($request->getKey());
        if ($request->status === InvoicePaymentRequest::STATUS_CANCELLED) {
            return $request; // idempotent
        }
        if ($request->status !== InvoicePaymentRequest::STATUS_OPEN) {
            throw new PaymentOrchestrationException('request_not_open', 'طلب الدفع لم يعد مفتوحاً.');
        }

        // التقاط مؤكَّد لم يُرحَّل بعد: الطلب سيكتمل بالترحيل، فلا يُلغى (وإلا بقي مدفوعٌ مسجَّلاً ملغى إلى الأبد).
        if ($this->hasUnreflectedCapture($request)) {
            throw new PaymentOrchestrationException('payment_captured', 'اكتمل الدفع لدى المزوّد؛ لا يمكن إلغاء الطلب.');
        }

        $active = PaymentAttempt::query()->where('payable_key', $request->payableKey())->whereIn('capture_status', PaymentAttempt::ACTIVE_STATUSES)->first();
        if ($active !== null) {
            // الإلغاء محلي لا أثر له لدى المزوّد، فيُستعلم المزوّد (الحقيقة) أولاً: دفعٌ التُقط فعلاً لا يُلغى (الدفع حقيقة).
            // تعذّر المزوّد لا يمنع الإلغاء: التقاط متأخر لاحق يُقبل ويُراجَع (D-15/M8) ولا يضيع.
            if ($active->provider_payment_id !== null) {
                try {
                    $synced = $this->orchestrator->sync($active, $actor)->attempt;
                } catch (PaymentOrchestrationException $e) {
                    if ($e->reason === 'forbidden') {
                        throw $e;
                    }
                    $synced = $active;
                }
                if ($synced->capture_status === PaymentAttempt::STATUS_CAPTURED) {
                    throw new PaymentOrchestrationException('payment_captured', 'اكتمل الدفع لدى المزوّد؛ لا يمكن إلغاء الطلب.');
                }
                $active = $synced;
            }
            $this->orchestrator->cancel($active, $actor);
        }

        return DB::transaction(function () use ($request, $actor): InvoicePaymentRequest {
            $locked = InvoicePaymentRequest::query()->lockForUpdate()->findOrFail($request->getKey());
            if ($locked->status !== InvoicePaymentRequest::STATUS_OPEN) {
                return $locked;
            }
            $locked->forceFill(['status' => InvoicePaymentRequest::STATUS_CANCELLED, 'cancelled_at' => now(), 'cancelled_by' => $actor?->getKey()])->save();

            return $locked;
        });
    }

    /**
     * يُصدر رابط الدفع العام لطلب مفتوح مرة واحدة: رمز عشوائي 32 بايت (base64url، 43 حرفاً) يُعاد خاماً **هنا فقط**، ويُخزَّن SHA-256 له وحده
     * (`token_hash`، ثابت بعد التثبيت). ضياع الرمز ⇒ إلغاء الطلب وإنشاء آخر (لا إعادة عرض ولا تدوير).
     */
    public function issueLink(InvoicePaymentRequest $request, ?User $actor): string
    {
        $this->assertActor($actor);
        $this->assertEnabled();

        return DB::transaction(function () use ($request): string {
            $locked = InvoicePaymentRequest::query()->lockForUpdate()->findOrFail($request->getKey());
            if ($locked->status !== InvoicePaymentRequest::STATUS_OPEN) {
                throw new PaymentOrchestrationException('request_not_open', 'طلب الدفع لم يعد مفتوحاً.');
            }
            // لا يُستهلك الرمز الوحيد على طلب مات فعلاً قبل أن تكنسه المكنسة (منتهٍ/فاتورة مسدَّدة أو غير مرحَّلة).
            if ($locked->expires_at !== null && $locked->expires_at->isPast()) {
                throw new PaymentOrchestrationException('request_expired', 'انتهت صلاحية طلب الدفع.');
            }
            $invoice = Invoice::query()->find($locked->invoice_id);
            if ($invoice === null || ! $invoice->isPosted() || $invoice->remaining() <= 0) {
                throw new PaymentOrchestrationException('invoice_not_payable', 'الفاتورة لم تعد قابلة للدفع.');
            }
            if ($locked->token_hash !== null) {
                throw new PaymentOrchestrationException('link_already_issued', 'أُصدر رابط هذا الطلب سابقاً ولا يُعاد عرضه؛ ألغِ الطلب وأنشئ آخر.');
            }
            $token = PaymentLinkToken::generate();
            $locked->forceFill(['token_hash' => PaymentLinkToken::hash($token)])->save();

            return $token;
        });
    }

    /**
     * مكنسة دورية عبر المستأجرين (مسار نظامي بلا فاعل): تلغي طلباً مفتوحاً لفاتورة لم تعد قابلة للدفع (سُدّدت/خُفّضت بإشعار دائن إلى صفر/لم تعد
     * مرحَّلة) بالمسار القائم (يستعلم المزوّد أولاً؛ دفعة ملتقطة لا تُلغى)، وتُنهي منتهي الصلاحية بلا محاولة نشطة. لا قيد ولا سند ولا مساس بالمحاسبة.
     *
     * @return array{cancelled: int, expired: int, skipped: int}
     */
    public function closeStale(int $limit = 200): array
    {
        $summary = ['cancelled' => 0, 'expired' => 0, 'skipped' => 0];
        $previous = $this->tenant->id();

        // مرشّحون محتملون فقط (منتهٍ أو فاتورته لم تعد قابلة للدفع) وبمسح بالمعرّف حتى سقف ثابت، فلا تُجوِّع صفوفٌ حيّة قديمة الطابور.
        $now = now('UTC');
        $candidates = fn () => InvoicePaymentRequest::query()->withoutGlobalScopes()
            ->where('status', InvoicePaymentRequest::STATUS_OPEN)
            ->where(function ($q) use ($now) {
                $q->where('expires_at', '<=', $now)->orWhereExists(function ($s) {
                    $s->select(DB::raw(1))->from('invoices')->whereColumn('invoices.id', 'invoice_payment_requests.invoice_id')
                        ->where(fn ($i) => $i->where('invoices.status', '!=', 'posted')->orWhereRaw('invoices.total - invoices.paid_amount <= 0'));
                });
            });
        $rows = collect();
        $cursor = null;
        for ($scanned = 0; $scanned < self::SWEEP_SCAN_CAP && $rows->count() < $limit; ) {
            $batch = $candidates()->when($cursor !== null, fn ($q) => $q->where('id', '>', $cursor))->orderBy('id')->limit($limit)->get(['id', 'tenant_id']);
            if ($batch->isEmpty()) {
                break;
            }
            $rows = $rows->concat($batch);
            $cursor = $batch->last()->id;
            $scanned += $batch->count();
        }
        foreach ($rows as $row) {
            $this->tenant->set((string) $row->tenant_id);
            try {
                $request = InvoicePaymentRequest::query()->find($row->id);
                if ($request === null || $request->status !== InvoicePaymentRequest::STATUS_OPEN) {
                    continue;
                }
                $invoice = Invoice::query()->find($request->invoice_id);
                $settled = $invoice === null || ! $invoice->isPosted() || $invoice->remaining() <= 0;
                if ($settled) {
                    $this->cancel($request, null);
                    $summary['cancelled']++;
                } elseif ($request->expires_at !== null && $request->expires_at->isPast()) {
                    $hasActive = PaymentAttempt::query()->where('payable_key', $request->payableKey())->whereIn('capture_status', PaymentAttempt::ACTIVE_STATUSES)->exists();
                    if ($hasActive) {
                        $summary['skipped']++;

                        continue;
                    }
                    DB::transaction(function () use ($request): void {
                        $locked = InvoicePaymentRequest::query()->lockForUpdate()->findOrFail($request->getKey());
                        if ($locked->status === InvoicePaymentRequest::STATUS_OPEN) {
                            $locked->forceFill(['status' => InvoicePaymentRequest::STATUS_EXPIRED])->save();
                        }
                    });
                    $summary['expired']++;
                }
            } catch (\Throwable $e) {
                $summary['skipped']++;
                if (! $e instanceof PaymentOrchestrationException) {
                    report($e);
                }
            } finally {
                $previous === null ? $this->tenant->forget() : $this->tenant->set($previous);
            }
        }

        return $summary;
    }

    /**
     * بدء محاولة دفع لطلب مفتوح. `$amountMinor = null` ⇒ المتبقي كاملاً. مبلغ جزئي يتطلب `allow_partial` للرابط (D-16) ولا يتجاوز المتبقي.
     */
    public function startAttempt(InvoicePaymentRequest $request, string $idempotencyKey, ?int $amountMinor, ?User $actor = null): PaymentAttempt
    {
        $request = InvoicePaymentRequest::query()->findOrFail($request->getKey());
        if ($request->status !== InvoicePaymentRequest::STATUS_OPEN) {
            throw new PaymentOrchestrationException('request_not_open', 'طلب الدفع لم يعد مفتوحاً.');
        }
        if ($request->expires_at !== null && $request->expires_at->isPast()) {
            throw new PaymentOrchestrationException('request_expired', 'انتهت صلاحية طلب الدفع.');
        }

        // مال التُقط لدى المزوّد ولم ينعكس بعد على المتبقي (ترحيل معلّق أو محجوب بفترة مقفلة): محاولة جديدة قد تخصم الدافع مرتين.
        if ($this->hasUnreflectedCapture($request)) {
            throw new PaymentOrchestrationException('payment_captured', 'اكتمل دفع لدى المزوّد ولم يُرحَّل بعد؛ لا يمكن بدء دفعة جديدة.');
        }

        $invoice = Invoice::query()->findOrFail($request->invoice_id);
        $remaining = $invoice->remaining();
        if ($amountMinor !== null) {
            if ($amountMinor <= 0) {
                throw new PaymentOrchestrationException('invalid_amount', 'المبلغ يجب أن يكون موجباً.');
            }
            if ($amountMinor !== $remaining) {
                if (! $request->allow_partial) {
                    throw new PaymentOrchestrationException('partial_not_allowed', 'الدفع الجزئي غير مفعّل لهذا الرابط.');
                }
                if ($amountMinor > $remaining) {
                    throw new PaymentOrchestrationException('amount_exceeds_remaining', 'المبلغ يتجاوز المتبقي على الفاتورة.');
                }
            }
        }

        $gateway = PaymentGateway::query()->find($request->payment_gateway_id);
        if ($gateway === null) {
            throw new PaymentOrchestrationException('gateway_unavailable', 'اتصال البوابة غير موجود.');
        }

        try {
            return $this->orchestrator->start(new InvoicePayable($request, $amountMinor), $gateway, $idempotencyKey, $actor);
        } catch (PaymentNotPayableException $e) {
            // الفاتورة سُدّدت/لم تعد مرحَّلة/تغيّر طرفها بعد إنشاء الطلب: خطأ عمل بصيغة موحّدة لا 500.
            throw new PaymentOrchestrationException('invoice_not_payable', 'الفاتورة لم تعد قابلة للدفع.', $e);
        }
    }

    /** التُقط مال لدى المزوّد ولم ينعكس بعد على المتبقي (ترحيل معلّق أو محجوب بفترة مقفلة). */
    private function hasUnreflectedCapture(InvoicePaymentRequest $request): bool
    {
        return PaymentAttempt::query()->where('payable_key', $request->payableKey())
            ->where('capture_status', PaymentAttempt::STATUS_CAPTURED)
            ->whereIn('posting_status', [PaymentAttempt::POSTING_PENDING, PaymentAttempt::POSTING_BLOCKED_PERIOD])->exists();
    }

    private function tenantCurrency(Invoice $invoice): string
    {
        return (string) (\App\Models\Tenant::query()->whereKey($this->tenant->id())->value('currency') ?: 'SAR');
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

    /** يُعاد تحميل الفاعل من القاعدة (مفعّل، من المستأجر نفسه، بدور يملك `payments.manage`)؛ null ⇒ مسار نظامي. */
    private function assertActor(?User $actor): void
    {
        if ($actor === null) {
            return;
        }
        $fresh = $this->tenant->has() && $actor->getKey() !== null
            ? User::query()->whereKey($actor->getKey())->where('tenant_id', (string) $this->tenant->id())->where('is_active', true)->first()
            : null;
        if ($fresh === null || ! Rbac::allows((string) $fresh->role, 'payments.manage')) {
            throw new PaymentOrchestrationException('forbidden', 'ليست لديك صلاحية إدارة المدفوعات.');
        }
    }

    private function isUniqueViolation(QueryException $e): bool
    {
        $state = (string) $e->getCode();

        return $state === '23505' || ($state === '23000' && str_contains($e->getMessage(), 'UNIQUE'));
    }
}
