<?php

namespace App\Services\Commerce;

use App\Models\CommerceOrder;
use App\Models\CommercePaymentIntent;
use App\Models\PaymentAttempt;
use App\Models\PaymentGateway;
use App\Models\PaymentMethod;
use App\Services\PaymentGatewayAdapterRegistry;
use App\Services\PaymentOrchestrator;
use App\Support\CommercePayable;
use App\Support\PaymentNotPayableException;
use App\Support\PaymentOrchestrationException;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * ═══════════════════════════════════════════════════════════════
 *  الدفع الإلكتروني لطلبات المتجر — PAY-H4-04a (ADR-04 §5–§7، Payments Horizon A13 جزئياً)
 * ═══════════════════════════════════════════════════════════════
 *  يستعمل `CommercePaymentIntent` القائمة (لا جدول نوايا موازٍ) و`PaymentOrchestrator` و`MoyasarAdapter` كما هي؛ هذه الخدمة غراء بينها:
 *  تحديد البوابة من طريقة الدفع المختارة، بدء/استئناف المحاولة، قراءة النتيجة من المزوّد، وتثبيت النية مدفوعةً مرة واحدة.
 *
 *  • **الحقيقة من الخادم لا من المتصفح:** `status()` لا يقرأ شيئاً من عودة المتصفح؛ يستعلم المزوّد (`sync`) ثم يطبّق اللقطة رتيباً. الطلب لا يصير
 *    مدفوعاً إلا بالتقاط مؤكَّد من المزوّد بمبلغ وعملة مطابقين (وإلا يبقى معلّقاً للمراجعة).
 *  • **مرة واحدة فقط:** تثبيت `pending → paid` تحت قفل صف النية؛ إعادة الحدث/المزامنة/الـwebhook/الأمر الدوري كلها تتقارب بلا أثر ثانٍ.
 *  • **idempotency من الخادم:** مفتاح المحاولة = (النية، ترتيب المحاولة): طلبان متزامنان يلتقيان على المحاولة نفسها؛ بعد فشل/انتهاء/إلغاء تُنشأ محاولة جديدة.
 *  • **لا أثر محاسبي ولا مخزني هنا** (G3 غير معتمدة: D-05 طرف، D-13 فاتورة، D-14 حجز). `posting_status` يبقى فارغاً والمبلغ ملتقَط لدى المزوّد
 *    وغير مرحَّل — لذلك البوابة `payments.commerce_online_checkout.enabled` مغلقة افتراضياً ولا تُفتح لمستأجر حي قبل إغلاق G3.
 *  • الالتقاط المتأخر (محاولة منتهية/ملغاة أو نية ملغاة) لا يعدّل الطلب ولا يردّ مالاً: يُوسم للمراجعة البشرية (D-15 الافتراضي المحافظ).
 */
final class CommerceOnlinePaymentService
{
    /** أسباب مراجعة تمنع تثبيت النية مدفوعة تلقائياً (مبلغ/عملة غير مطابقين أو تعارض حالة). */
    private const HOLDING_REASONS = [
        PaymentAttempt::REVIEW_AMOUNT_MISMATCH,
        PaymentAttempt::REVIEW_CURRENCY_MISMATCH,
        PaymentAttempt::REVIEW_STATE_CONFLICT,
    ];

    /** أدنى فاصل بين استعلامين للمزوّد لنفس المحاولة من قراءات الحالة العامة (ثوانٍ). */
    private const SYNC_MIN_INTERVAL = 3;

    public function __construct(
        private readonly PaymentOrchestrator $orchestrator,
        private readonly PaymentGatewayAdapterRegistry $adapters,
        private readonly TenantContext $tenant,
    ) {}

    public static function enabled(): bool
    {
        return (bool) config('payments.commerce_online_checkout.enabled', false);
    }

    /**
     * هل ترتبط طريقة الدفع باتصال بوابة حقيقي (له محوّل)؟ يُستعمل عند الإتمام: ارتباط + بوابة غير جاهزة ⇒ رفض (لا سقوط صامت إلى COD).
     */
    public function isGatewayLinked(PaymentMethod $method): bool
    {
        return $this->linkedGateways($method)->isNotEmpty();
    }

    /** هل يدعم محوّل الاتصال المبلغ والعملة المطلوبين؟ يُفحص عند الإتمام كي لا يُلتزم بطلب إلكتروني لا يقبله المزوّد أصلاً (حدّ أدنى/عملة). */
    public function gatewaySupports(PaymentGateway $gateway, int $amountMinor, string $currency): bool
    {
        $capabilities = $this->adapters->for((string) $gateway->provider)->capabilities();

        return $capabilities->supportsCurrency(strtoupper($currency)) && $capabilities->supportsAmount($amountMinor);
    }

    /** أول اتصال جاهز لطلب الدفع (نشط، متحقَّق من أسراره، بمحوّل) مرتبط بالطريقة؛ وإلا null. التفعيل المنصّي/المستأجر شرط. */
    public function usableGatewayFor(PaymentMethod $method): ?PaymentGateway
    {
        if (! self::enabled() || ! $this->orchestrator->canStart()) {
            return null;
        }

        return $this->linkedGateways($method)->first(
            fn (PaymentGateway $g): bool => $g->isUsable() && (! $g->requiresVerification() || $g->verified_at !== null),
        );
    }

    /**
     * يبدأ محاولة دفع للنية (أو يستأنف النشطة). idempotent بمفتاح خادمي من (النية، ترتيب المحاولة).
     *
     * @return array{attempt: PaymentAttempt, created: bool}
     *
     * @throws CommerceOnlinePaymentException
     */
    public function start(CommerceOrder $order): array
    {
        $intent = $this->onlineIntent($order);
        if ($intent->isPaid()) {
            throw new CommerceOnlinePaymentException('already_paid', 'الطلب مدفوع بالفعل.');
        }
        if ($intent->status !== CommercePaymentIntent::STATUS_PENDING) {
            throw new CommerceOnlinePaymentException('not_payable', 'الطلب لم يعد بانتظار الدفع.');
        }

        $method = $intent->payment_method_id === null ? null : PaymentMethod::query()->find($intent->payment_method_id);
        $gateway = $method === null ? null : $this->usableGatewayFor($method);
        if ($gateway === null) {
            throw new CommerceOnlinePaymentException('payment_unavailable', 'الدفع الإلكتروني غير متاح حالياً.');
        }

        // استئناف: محاولة نشطة لها صفحة دفع حيّة تُعاد كما هي (لا محاولة ثانية ولا تحصيل مزدوج).
        $active = $this->activeAttempt($intent);
        if ($active !== null && $active->capture_status === PaymentAttempt::STATUS_PENDING_CUSTOMER
            && $active->expires_at !== null && $active->expires_at->isPast()) {
            // صفحتها انتهت: نسأل المزوّد أولاً (قد يكون التُقط) ثم تُنهى محلياً، فلا يعلق العميل حتى يمرّ المطابِق الدوري.
            try {
                $this->orchestrator->reconcile($active);
            } catch (PaymentOrchestrationException) {
                throw new CommerceOnlinePaymentException('provider_unavailable', 'تعذّر الوصول إلى مزوّد الدفع للتحقق من محاولة سابقة.');
            }
            if ($this->latestAttempt($intent)?->capture_status === PaymentAttempt::STATUS_CAPTURED) {
                $this->completeCaptured($this->latestAttempt($intent));
                throw new CommerceOnlinePaymentException('already_paid', 'الطلب مدفوع بالفعل.');
            }
            $active = $this->activeAttempt($intent);
        }
        if ($active !== null && $active->capture_status !== PaymentAttempt::STATUS_CREATED
            && ! ($active->expires_at !== null && $active->expires_at->isPast())) {
            return ['attempt' => $active, 'created' => false];
        }

        $ordinal = PaymentAttempt::query()->where('payable_key', $intent->payableKey())->count();
        // محاولة `created` (استدعاء مزوّد لم يكتمل) تُستأنف بمفتاحها الثابت؛ وإلا مفتاح الترتيب التالي.
        $key = $active !== null && $active->capture_status === PaymentAttempt::STATUS_CREATED
            ? (string) $active->idempotency_key
            : $this->attemptKey($intent, $ordinal);

        try {
            $attempt = $this->orchestrator->start(new CommercePayable($intent), $gateway, $key, null);
        } catch (PaymentNotPayableException $e) {
            throw new CommerceOnlinePaymentException('not_payable', 'الطلب لم يعد قابلاً للدفع.', $e);
        } catch (PaymentOrchestrationException $e) {
            throw $this->map($e);
        }

        // سباق مع إلغاء الإدارة: النية قد أُلغيت بين فحص الصلاحية وولادة المحاولة ⇒ تُغلق المحاولة الجديدة ولا تُسلَّم صفحة دفع لنية ملغاة.
        $current = CommercePaymentIntent::query()->find($intent->getKey());
        if ($current === null || $current->status !== CommercePaymentIntent::STATUS_PENDING) {
            $this->closeActiveAttempts($intent);
            throw new CommerceOnlinePaymentException('not_payable', 'الطلب لم يعد قابلاً للدفع.');
        }

        return ['attempt' => $attempt, 'created' => $active === null || $active->getKey() !== $attempt->getKey()];
    }

    /**
     * حالة الدفع كما يعرفها الخادم (بعد استعلام المزوّد عند الحاجة). لا تعتمد على أي مدخل من عودة المتصفح.
     *
     * @return array<string, mixed>
     *
     * @throws CommerceOnlinePaymentException
     */
    public function status(CommerceOrder $order): array
    {
        $intent = $this->onlineIntent($order);
        $attempt = $this->latestAttempt($intent);

        if ($attempt !== null && ! $intent->isPaid() && $this->shouldSync($attempt)) {
            try {
                $expired = $attempt->capture_status === PaymentAttempt::STATUS_PENDING_CUSTOMER
                    && $attempt->expires_at !== null && $attempt->expires_at->isPast();
                // صفحة انتهت محلياً: المطابقة تسأل المزوّد ثم تُنهي المحاولة (فيُتاح التكرار) بدل بقائها «معلّقة» حتى المطابِق الدوري.
                $expired ? $this->orchestrator->reconcile($attempt) : $this->orchestrator->sync($attempt);
            } catch (PaymentOrchestrationException) {
                // المزوّد غير متاح الآن: نعرض آخر حالة معروفة (الحقيقة تصل لاحقاً بالـwebhook/المطابِق).
            }
            $attempt = $this->latestAttempt($intent) ?? $attempt;
        }

        if ($attempt !== null && $attempt->capture_status === PaymentAttempt::STATUS_CAPTURED) {
            $this->completeCaptured($attempt);
        }

        return $this->present($intent->fresh() ?? $intent, $this->latestAttempt($intent));
    }

    /**
     * الحالة كما هي مخزَّنة الآن بلا استعلام مزوّد (لاستجابة بدء الدفع).
     *
     * @return array<string, mixed>
     *
     * @throws CommerceOnlinePaymentException
     */
    public function snapshot(CommerceOrder $order): array
    {
        $intent = $this->onlineIntent($order);

        return $this->present($intent, $this->latestAttempt($intent));
    }

    /**
     * يثبّت النية مدفوعةً (مرة واحدة) بعد التقاط مؤكَّد؛ idempotent بالكامل. يعيد true إن صارت/كانت مدفوعة.
     */
    public function completeCaptured(PaymentAttempt $attempt): bool
    {
        $prefix = CommercePaymentIntent::PAYABLE_TYPE.':';
        if ($attempt->capture_status !== PaymentAttempt::STATUS_CAPTURED || ! str_starts_with((string) $attempt->payable_key, $prefix)) {
            return false;
        }
        $intentId = substr((string) $attempt->payable_key, strlen($prefix));

        $result = DB::transaction(function () use ($attempt, $intentId): string {
            $intent = CommercePaymentIntent::query()->whereKey($intentId)->lockForUpdate()->first();
            if ($intent === null) {
                return 'missing';
            }
            if ($intent->isPaid()) {
                // نية مدفوعة والتُقطت محاولة أخرى لها (دفعة مزدوجة، ولو بلا مرور بحالة «ملغاة» كمحاولة مفوَّضة): تُوسم للمراجعة البشرية.
                $dup = PaymentAttempt::query()->find($attempt->getKey());
                if ($dup !== null && $dup->capture_status === PaymentAttempt::STATUS_CAPTURED
                    && ! in_array(PaymentAttempt::REVIEW_LATE_CAPTURE, $dup->review_reasons ?? [], true)
                    && PaymentAttempt::query()->where('payable_key', $dup->payable_key)->where('id', '!=', $dup->getKey())
                        ->where('capture_status', PaymentAttempt::STATUS_CAPTURED)->exists()) {
                    $dup->forceFill(['review_reasons' => array_values(array_unique([...($dup->review_reasons ?? []), PaymentAttempt::REVIEW_LATE_CAPTURE]))])->save();
                }

                return 'paid';
            }
            $fresh = PaymentAttempt::query()->find($attempt->getKey());
            if ($fresh === null || $fresh->capture_status !== PaymentAttempt::STATUS_CAPTURED) {
                return 'not_captured';
            }
            if (array_intersect(self::HOLDING_REASONS, $fresh->review_reasons ?? []) !== []) {
                return 'held'; // مبلغ/عملة غير مطابقين: مراجعة بشرية، لا تثبيت تلقائي
            }
            if ($intent->status !== CommercePaymentIntent::STATUS_PENDING) {
                // نية ملغاة والمزوّد التقط فعلاً: التقاط متأخر ⇒ مراجعة بشرية (D-15)، لا تعديل للنية ولا استرداد آلي.
                if (! in_array(PaymentAttempt::REVIEW_LATE_CAPTURE, $fresh->review_reasons ?? [], true)) {
                    $fresh->forceFill(['review_reasons' => array_values(array_unique([...($fresh->review_reasons ?? []), PaymentAttempt::REVIEW_LATE_CAPTURE]))])->save();
                }

                return 'late';
            }

            $intent->forceFill([
                'status' => CommercePaymentIntent::STATUS_PAID,
                'paid_at' => $fresh->captured_at ?? now('UTC'),
            ])->save();
            // H4-02: طلب مدفوع ⇒ حجزه لا ينتهي بالموعد (يبقى حتى الإصدار المحاسبي).
            app(CommerceOrderReservationService::class)->makePermanent((string) $intent->commerce_order_id);

            return 'paid';
        });

        if ($result === 'paid') {
            $this->cancelOtherActiveAttempts($intentId, (string) $attempt->getKey());
        }

        return $result === 'paid';
    }

    /** هل التُقط مبلغ لهذه النية (محاولة `captured`)؟ يُستعمل تحت قفل صف النية قبل إلغائها. */
    public function hasCapture(CommercePaymentIntent $intent): bool
    {
        return PaymentAttempt::query()->where('payable_key', $intent->payableKey())
            ->where('capture_status', PaymentAttempt::STATUS_CAPTURED)->exists();
    }

    /**
     * يغلق (محلياً) كل محاولة نشطة لنية أُلغيت. best-effort وخارج أي معاملة: فشل إغلاق واحدة لا يُرجع الإلغاء (النية الملغاة ترفض أي بدء جديد،
     * والتقاط لاحق على صفحة بقيت حيّة يُوسم `late_capture` للمراجعة).
     */
    public function closeActiveAttempts(CommercePaymentIntent $intent): void
    {
        foreach (PaymentAttempt::query()->where('payable_key', $intent->payableKey())->whereIn('capture_status', PaymentAttempt::ACTIVE_STATUSES)->get() as $active) {
            try {
                $this->orchestrator->cancel($active);
            } catch (PaymentOrchestrationException) {
                // يعالجه المطابِق الدوري
            }
        }
    }

    /**
     * ADR-28 P-3: نسخة **معزولة** لتنظيف ما بعد الإلغاء — لا ترمي أبداً (كل محاولة في try/catch لـ`Throwable` وتُسجَّل)، وتعيد عدّادات
     * تسمح بالمطابِق الدوري بإعادة المحاولة. تُستدعى بعد الالتزام النهائي فقط وبلا أقفال معلَّقة (تتصل بالمزوّد وتقفل صف المحاولة).
     * `cannot_cancel` = المحاولة لم تعد نشطة (سبقها التقاط/انتهاء/إلغاء) فتُحتسب «متخطّاة» لا فشلاً. idempotent.
     *
     * @return array{closed: int, skipped: int, failed: int, remaining: int}
     */
    public function closeActiveAttemptsIsolated(CommercePaymentIntent $intent): array
    {
        $result = ['closed' => 0, 'skipped' => 0, 'failed' => 0, 'remaining' => 0];

        try {
            $attempts = PaymentAttempt::query()->where('payable_key', $intent->payableKey())->whereIn('capture_status', PaymentAttempt::ACTIVE_STATUSES)->get();
        } catch (\Throwable $e) {
            report($e);

            return $result + ['failed' => 1];
        }

        foreach ($attempts as $active) {
            try {
                $this->orchestrator->cancel($active);
                $result['closed']++;
            } catch (PaymentOrchestrationException $e) {
                if ($e->reason === 'cannot_cancel') {
                    $result['skipped']++;
                } else {
                    $result['failed']++;
                }
            } catch (\Throwable $e) {
                $result['failed']++;
                report($e);
            }
        }

        try {
            $result['remaining'] = PaymentAttempt::query()->where('payable_key', $intent->payableKey())->whereIn('capture_status', PaymentAttempt::ACTIVE_STATUSES)->count();
        } catch (\Throwable $e) {
            report($e);
        }

        return $result;
    }

    /**
     * شبكة أمان: التقاطات مؤكَّدة لنوايا ما زالت `pending` (فشل المستمع/انهيار بعد الالتزام). كل محاولة معزولة؛ idempotent.
     *
     * @return array{processed: int, completed: int, failed: int}
     */
    public function runPending(int $limit = 100): array
    {
        $summary = ['processed' => 0, 'completed' => 0, 'failed' => 0];
        $rows = PaymentAttempt::query()->withoutGlobalScopes()
            ->where('capture_status', PaymentAttempt::STATUS_CAPTURED)
            ->where('payable_key', 'like', CommercePaymentIntent::PAYABLE_TYPE.':%')
            ->whereExists(fn ($q) => $q->selectRaw('1')->from('commerce_payment_intents as i')
                ->whereRaw("payment_attempts.payable_key = 'commerce_payment_intent:' || i.id")
                ->where('i.status', CommercePaymentIntent::STATUS_PENDING))
            ->orderBy('captured_at');
        // المحجوزة للمراجعة (مبلغ/عملة/تعارض) لا تُحتسب في الدفعة: وإلا سدّت الأقدم منها (وعبر المستأجرين) باب استرداد ما فاتته المستمعات.
        foreach (self::HOLDING_REASONS as $reason) {
            $rows->where(fn ($q) => $q->whereNull('review_reasons')
                ->orWhereRaw('CAST(review_reasons AS TEXT) NOT LIKE ?', ['%"'.$reason.'"%']));
        }
        $rows = $rows->limit($limit)->get();

        $previous = $this->tenant->id();
        foreach ($rows as $row) {
            $summary['processed']++;
            $this->tenant->set((string) $row->tenant_id);
            try {
                $attempt = PaymentAttempt::query()->find($row->getKey());
                if ($attempt !== null && $this->completeCaptured($attempt)) {
                    $summary['completed']++;
                }
            } catch (\Throwable $e) {
                $summary['failed']++;
                report($e);
            } finally {
                $previous === null ? $this->tenant->forget() : $this->tenant->set($previous);
            }
        }

        return $summary;
    }

    // ───────────────────────── الداخل ─────────────────────────

    private function onlineIntent(CommerceOrder $order): CommercePaymentIntent
    {
        $intent = CommercePaymentIntent::query()->where('commerce_order_id', $order->getKey())->first();
        if ($intent === null || ! $intent->isOnline()) {
            throw new CommerceOnlinePaymentException('not_online', 'هذا الطلب لا يستخدم الدفع الإلكتروني.');
        }

        return $intent;
    }

    /** @return \Illuminate\Support\Collection<int, PaymentGateway> */
    private function linkedGateways(PaymentMethod $method)
    {
        return PaymentGateway::query()
            ->where('payment_method_id', $method->getKey())
            ->orderBy('created_at')->orderBy('id')
            ->get()
            ->filter(fn (PaymentGateway $g): bool => $this->adapters->has((string) $g->provider))
            ->values();
    }

    private function activeAttempt(CommercePaymentIntent $intent): ?PaymentAttempt
    {
        return PaymentAttempt::query()->where('payable_key', $intent->payableKey())
            ->whereIn('capture_status', PaymentAttempt::ACTIVE_STATUSES)->latest('created_at')->first();
    }

    private function latestAttempt(CommercePaymentIntent $intent): ?PaymentAttempt
    {
        return PaymentAttempt::query()->where('payable_key', $intent->payableKey())
            ->orderByDesc('created_at')->orderByDesc('id')->first();
    }

    private function shouldSync(PaymentAttempt $attempt): bool
    {
        if ($attempt->provider_payment_id === null
            || ! in_array($attempt->capture_status, [PaymentAttempt::STATUS_PENDING_CUSTOMER, PaymentAttempt::STATUS_AUTHORIZED, PaymentAttempt::STATUS_CREATED], true)) {
            return false;
        }

        return $attempt->last_synced_at === null || $attempt->last_synced_at->diffInSeconds(now('UTC'), true) >= self::SYNC_MIN_INTERVAL;
    }

    private function attemptKey(CommercePaymentIntent $intent, int $ordinal): string
    {
        return 'cmo-'.substr(hash('sha256', $this->tenant->id().'|'.$intent->getKey().'|'.$ordinal), 0, 48);
    }

    /** يلغي محلياً المحاولات النشطة الأخرى بعد دفع ناجح (دفعة مزدوجة لاحقة تُوسم late_capture للمراجعة). خارج المعاملة. */
    private function cancelOtherActiveAttempts(string $intentId, string $exceptAttemptId): void
    {
        $key = CommercePaymentIntent::PAYABLE_TYPE.':'.$intentId;
        foreach (PaymentAttempt::query()->where('payable_key', $key)->whereIn('capture_status', PaymentAttempt::ACTIVE_STATUSES)->where('id', '!=', $exceptAttemptId)->get() as $other) {
            try {
                $this->orchestrator->cancel($other);
            } catch (PaymentOrchestrationException) {
                // يعالجه المطابِق الدوري؛ لا يمنع تثبيت الدفع الناجح.
            }
        }
    }

    /** @return array<string, mixed> */
    private function present(CommercePaymentIntent $intent, ?PaymentAttempt $attempt): array
    {
        $held = $attempt !== null
            && $attempt->capture_status === PaymentAttempt::STATUS_CAPTURED
            && ! $intent->isPaid()
            && $intent->status === CommercePaymentIntent::STATUS_PENDING;

        $status = match (true) {
            $intent->isPaid() => 'paid',
            $intent->isCancelled() => 'cancelled',
            $held => 'under_review',
            $attempt === null => 'awaiting_payment',
            // محاولة بدأت ولم تبلغ المزوّد (انقطاع عند البدء): لا صفحة للعميل بعد؛ إعادة `payment-intent` تستأنفها بمفتاحها الثابت.
            $attempt->capture_status === PaymentAttempt::STATUS_CREATED && $attempt->provider_payment_id === null => 'awaiting_payment',
            in_array($attempt->capture_status, [PaymentAttempt::STATUS_CREATED, PaymentAttempt::STATUS_PENDING_CUSTOMER, PaymentAttempt::STATUS_AUTHORIZED], true) => 'pending',
            $attempt->capture_status === PaymentAttempt::STATUS_EXPIRED => 'expired',
            $attempt->capture_status === PaymentAttempt::STATUS_CANCELLED => 'cancelled',
            default => 'failed', // failed | voided
        };

        $live = $attempt !== null && $status === 'pending' && $attempt->checkout_url !== null
            && ! ($attempt->expires_at !== null && $attempt->expires_at->isPast());
        $canRetry = $intent->status === CommercePaymentIntent::STATUS_PENDING && ! $held && $status !== 'pending' && $status !== 'paid';

        return [
            'status' => $status,
            'can_retry' => $canRetry && self::enabled(),
            'amount' => ['amount_minor' => (int) $intent->amount_minor, 'currency' => $intent->currency],
            'paid_at' => $intent->paid_at?->toIso8601String(),
            'expires_at' => $live ? $attempt->expires_at?->toIso8601String() : null,
            'checkout_url' => $live ? $attempt->checkout_url : null,
        ];
    }

    private function map(PaymentOrchestrationException $e): CommerceOnlinePaymentException
    {
        $reason = match ($e->reason) {
            'rollout_disabled', 'platform_stop', 'gateway_unavailable', 'gateway_unverified', 'adapter_unavailable' => 'payment_unavailable',
            'provider_unavailable' => 'provider_unavailable',
            'active_attempt_exists', 'idempotency_conflict', 'payable_changed' => 'attempt_in_progress',
            'nothing_due', 'currency_unsupported', 'amount_below_minimum' => 'not_payable',
            default => 'payment_unavailable',
        };

        return new CommerceOnlinePaymentException($reason, 'تعذّر بدء الدفع الإلكتروني.', $e);
    }
}
