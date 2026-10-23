<?php

namespace App\Services;

use App\Models\FiscalYear;
use App\Models\Invoice;
use App\Models\InvoicePaymentRequest;
use App\Models\Payment;
use App\Models\PaymentAttempt;
use App\Models\PaymentAttemptPosting;
use App\Models\PaymentAttemptPostingEvent;
use App\Models\User;
use App\Services\Accounting\AccountingDateGuard;
use App\Services\Accounting\AccountingPeriodLockedException;
use App\Services\Accounting\FiscalYearClosedException;
use App\Services\Accounting\PaymentService;
use App\Support\PaymentOrchestrationException;
use App\Support\Rbac;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * ترحيل التقاط محاولة دفع فاتورة إلى سندات قبض (PAY-H2-02c، ADR-0006 M1–M8). **ينسّق فقط**: السندات والقيود والتخصيص وتحديث السداد
 * كلها بـ`PaymentService::create/post` حصراً (لا كتابة مباشرة في الأستاذ). الإجمالي والأحداث:
 *
 * - **ذرّية وتفرد:** كل المجموعة (سند مخصّص ± سند زائد + صفوف الربط + حالة المحاولة + إكمال الطلب) في معاملة واحدة تحت قفل المحاولة، و
 *   `UNIQUE(attempt_id, role)` شبكة أمان. إعادة الاستدعاء (حدث مكرر، مطابِق، سباق) لا تُنتج سنداً ولا قيداً إضافياً (M4).
 * - **التخصيص:** المخصَّص = min(الملتقط، المتبقي على الفاتورة وقت الترحيل)، والفائض سند غير مخصص + مراجعة `overpayment` (D-26، M3/M3ب).
 * - **الفترة المقفلة (ADR-0004 §3، M5):** فحص `AccountingDateGuard` على التاريخ المحاسبي (التقاط المزوّد بتوقيت الرياض) قبل أي سند؛ الرفض يتراجع
 *   كلياً ثم تُسجَّل `blocked_period` (مع السبب) بلا قيد ولا تغيير تاريخ. إعادة الترحيل بعد فتح رسمي = `$explicit` فقط (لا تلقائياً).
 * - **القفل:** المحاولة ← الطلب ← الفاتورة ← السند ← مِرساة المستأجر.
 * - **المحتجَز (M6):** عدم تطابق مبلغ/عملة أو تعارض حالة ⇒ لا ترحيل ويبقى `pending` للمراجعة البشرية.
 */
final class PaymentAttemptPostingService
{
    public const OUTCOME_POSTED = 'posted';

    public const OUTCOME_ALREADY_POSTED = 'already_posted';

    public const OUTCOME_BLOCKED_PERIOD = 'blocked_period';

    public const OUTCOME_HELD = 'held';

    public const OUTCOME_SKIPPED = 'skipped';

    private const ACCOUNTING_TIMEZONE = 'Asia/Riyadh';

    /** أسباب مراجعة تمنع الترحيل التلقائي (M6 + تعارض الحالة). */
    public const HOLDING_REASONS = [
        PaymentAttempt::REVIEW_AMOUNT_MISMATCH,
        PaymentAttempt::REVIEW_CURRENCY_MISMATCH,
        PaymentAttempt::REVIEW_STATE_CONFLICT,
    ];

    public function __construct(
        private readonly PaymentService $payments,
        private readonly AccountingDateGuard $dateGuard,
        private readonly TenantContext $tenant,
    ) {}

    /** يعالج الـPayable هذه الخدمة؟ */
    public static function handles(string $payableKey): bool
    {
        return str_starts_with($payableKey, InvoicePaymentRequest::PAYABLE_TYPE.':');
    }

    /**
     * @param  bool  $explicit  إعادة ترحيل صريحة لمحاولة `blocked_period` (بعد فتح رسمي) — لا يُستعمل تلقائياً.
     * @return self::OUTCOME_*
     */
    public function process(PaymentAttempt $attempt, bool $explicit = false): string
    {
        try {
            return DB::transaction(fn (): string => $this->postWithinTransaction($attempt, $explicit));
        } catch (AccountingPeriodLockedException|FiscalYearClosedException $e) {
            // التراجع كامل (لا سند ولا قيد). نسجّل الحجب بمعاملة مستقلة.
            return $this->recordBlocked($attempt, $e);
        }
    }

    /**
     * M5-R1 — إعادة ترحيل صريحة لالتقاط محجوب بفترة/سنة مقفلة **بعد فتحها رسمياً**، بقرار مخوَّل (`payments.resolve_blocked`) وسبب مسجَّل. التاريخ
     * المحاسبي الأصلي لا يتغير. ما زال التاريخ مقفلاً ⇒ يبقى محجوباً والقرار يُسجَّل `still_blocked`. القرار والترحيل في معاملة واحدة (لا ترحيل بلا أثر تدقيق).
     *
     * @return self::OUTCOME_POSTED|self::OUTCOME_BLOCKED_PERIOD
     */
    public function repost(PaymentAttempt $attempt, User $actor, string $reason): string
    {
        $reason = trim($reason);
        if (mb_strlen($reason) < 5 || mb_strlen($reason) > 500) {
            throw new PaymentOrchestrationException('reason_required', 'سبب إعادة الترحيل مطلوب (5–500 حرفاً).');
        }
        // يُعاد تحميل الفاعل من القاعدة: خفض الدور/التعطيل بعد التحميل لا يُتجاوز.
        $fresh = $this->tenant->has() && $actor->getKey() !== null
            ? User::query()->whereKey($actor->getKey())->where('tenant_id', (string) $this->tenant->id())->where('is_active', true)->first()
            : null;
        if ($fresh === null || ! Rbac::allows((string) $fresh->role, 'payments.resolve_blocked')) {
            throw new PaymentOrchestrationException('forbidden', 'ليست لديك صلاحية معالجة الدفعات المحجوبة.');
        }

        return DB::transaction(function () use ($attempt, $fresh, $reason): string {
            $current = PaymentAttempt::query()->lockForUpdate()->find($attempt->getKey());
            if ($current === null || ! self::handles((string) $current->payable_key)
                || $current->posting_status !== PaymentAttempt::POSTING_BLOCKED_PERIOD) {
                throw new PaymentOrchestrationException('not_blocked', 'الدفعة ليست محجوبة بفترة مقفلة.');
            }

            $outcome = $this->process($current, true);
            if (! in_array($outcome, [self::OUTCOME_POSTED, self::OUTCOME_BLOCKED_PERIOD], true)) {
                throw new PaymentOrchestrationException('not_postable', 'تعذّر ترحيل الدفعة (تحتاج مراجعة).');
            }
            PaymentAttemptPostingEvent::create([
                'payment_attempt_id' => $current->id,
                'action' => PaymentAttemptPostingEvent::ACTION_REPOST,
                'outcome' => $outcome === self::OUTCOME_POSTED ? PaymentAttemptPostingEvent::OUTCOME_POSTED : PaymentAttemptPostingEvent::OUTCOME_STILL_BLOCKED,
                'actor_id' => $fresh->id,
                'reason' => $reason,
            ]);

            return $outcome;
        });
    }

    /**
     * يعالج الالتقاطات المعلّقة (شبكة أمان لفشل المستمع/الانهيار). كل محاولة معزولة؛ فشل واحدة لا يوقف البقية.
     *
     * @return array{processed: int, posted: int, blocked: int, held: int, failed: int}
     */
    public function runPending(int $limit = 100): array
    {
        $summary = ['processed' => 0, 'posted' => 0, 'blocked' => 0, 'held' => 0, 'failed' => 0];

        $query = PaymentAttempt::query()->withoutGlobalScopes()
            ->where('capture_status', PaymentAttempt::STATUS_CAPTURED)
            ->where('posting_status', PaymentAttempt::POSTING_PENDING)
            ->where('payable_key', 'like', InvoicePaymentRequest::PAYABLE_TYPE.':%');
        foreach (self::HOLDING_REASONS as $reason) {
            $query->where(fn ($q) => $q->whereNull('review_reasons')
                ->orWhereRaw('CAST(review_reasons AS TEXT) NOT LIKE ?', ['%"'.$reason.'"%']));
        }

        $previous = $this->tenant->id();
        foreach ($query->orderBy('captured_at')->limit($limit)->get() as $row) {
            $summary['processed']++;
            $this->tenant->set((string) $row->tenant_id);
            try {
                $attempt = PaymentAttempt::query()->find($row->getKey());
                $outcome = $attempt === null ? self::OUTCOME_SKIPPED : $this->process($attempt);
                match ($outcome) {
                    self::OUTCOME_POSTED, self::OUTCOME_ALREADY_POSTED => $summary['posted']++,
                    self::OUTCOME_BLOCKED_PERIOD => $summary['blocked']++,
                    self::OUTCOME_HELD => $summary['held']++,
                    default => null,
                };
            } catch (Throwable $e) {
                $summary['failed']++;
                report($e);
            } finally {
                $previous === null ? $this->tenant->forget() : $this->tenant->set($previous);
            }
        }

        return $summary;
    }

    private function postWithinTransaction(PaymentAttempt $attempt, bool $explicit): string
    {
        $locked = PaymentAttempt::query()->lockForUpdate()->find($attempt->getKey());
        if ($locked === null || ! self::handles((string) $locked->payable_key)) {
            return self::OUTCOME_SKIPPED;
        }
        if ($locked->capture_status !== PaymentAttempt::STATUS_CAPTURED || $locked->posting_status === null
            || $locked->posting_status === PaymentAttempt::POSTING_NOT_POSTABLE) {
            return self::OUTCOME_SKIPPED;
        }
        if ($locked->posting_status === PaymentAttempt::POSTING_POSTED) {
            return self::OUTCOME_ALREADY_POSTED;
        }
        if ($locked->posting_status === PaymentAttempt::POSTING_BLOCKED_PERIOD && ! $explicit) {
            return self::OUTCOME_BLOCKED_PERIOD;
        }
        if (array_intersect(self::HOLDING_REASONS, $locked->review_reasons ?? []) !== []) {
            return self::OUTCOME_HELD;
        }

        $requestId = substr((string) $locked->payable_key, strlen(InvoicePaymentRequest::PAYABLE_TYPE) + 1);
        $request = InvoicePaymentRequest::query()->lockForUpdate()->find($requestId);
        if ($request === null || $request->partner_id === null) {
            return self::OUTCOME_SKIPPED; // لا طرف ⇒ لا ترحيل (D-05)
        }
        $invoice = Invoice::query()->lockForUpdate()->find($request->invoice_id);
        if ($invoice === null || (string) $invoice->partner_id !== (string) $request->partner_id) {
            return self::OUTCOME_SKIPPED;
        }

        // سلامة إضافية لقاعدة التفرد: مجموعة موجودة ⇒ المحاولة مرحَّلة فعلاً (لا سند ثانٍ أبداً).
        if (PaymentAttemptPosting::query()->where('payment_attempt_id', $locked->id)->exists()) {
            $locked->forceFill(['posting_status' => PaymentAttempt::POSTING_POSTED])->save();

            return self::OUTCOME_ALREADY_POSTED;
        }

        $date = $locked->accounting_date?->toDateString()
            ?? $locked->captured_at->copy()->setTimezone(self::ACCOUNTING_TIMEZONE)->toDateString();
        $this->dateGuard->assertOpen($date, 'ترحيل التقاط دفعة إلكترونية');

        $captured = (int) $locked->captured_minor;
        $remaining = $invoice->isPosted() ? $invoice->remaining() : 0;
        $allocated = min($captured, $remaining);
        $excess = $captured - $allocated;

        $postings = [];
        if ($allocated > 0) {
            $postings[PaymentAttemptPosting::ROLE_ALLOCATED] = [$this->voucher($locked, $request, $invoice, $date, $allocated, true), $allocated];
        }
        if ($excess > 0) {
            $postings[PaymentAttemptPosting::ROLE_EXCESS] = [$this->voucher($locked, $request, $invoice, $date, $excess, false), $excess];
        }
        foreach ($postings as $role => [$payment, $amount]) {
            PaymentAttemptPosting::create([
                'payment_attempt_id' => $locked->id,
                'role' => $role,
                'payment_id' => $payment->id,
                'amount_minor' => $amount,
            ]);
        }

        $updates = ['posting_status' => PaymentAttempt::POSTING_POSTED, 'posting_blocked_reason' => null];
        if ($locked->accounting_date === null) {
            $updates['accounting_date'] = $date;
        }
        if ($locked->posted_at === null) {
            $updates['posted_at'] = now('UTC');
        }
        if ($excess > 0) {
            $updates['review_reasons'] = array_values(array_unique([...($locked->review_reasons ?? []), PaymentAttempt::REVIEW_OVERPAYMENT]));
        }
        $locked->forceFill($updates)->save();

        if ($request->status === InvoicePaymentRequest::STATUS_OPEN && $invoice->fresh()->remaining() === 0) {
            $request->forceFill(['status' => InvoicePaymentRequest::STATUS_COMPLETED, 'completed_at' => now('UTC')])->save();
        }

        return self::OUTCOME_POSTED;
    }

    /** سند قبض مرتبط ببوابة (قيد: مدين 1170 / دائن 1130 + الطرف) — مخصّص بالفاتورة أو غير مخصص. */
    private function voucher(PaymentAttempt $attempt, InvoicePaymentRequest $request, Invoice $invoice, string $date, int $amount, bool $allocate): Payment
    {
        $data = [
            'partner_id' => $request->partner_id,
            'amount' => $amount,
            'direction' => 'received',
            'method' => 'bank',
            'payment_gateway_id' => $attempt->payment_gateway_id,
            'reference' => $attempt->provider_payment_id,
            'payment_date' => $date,
            'payment_details' => json_encode([
                'payment_attempt_id' => $attempt->id,
                'provider' => $attempt->provider,
                'role' => $allocate ? PaymentAttemptPosting::ROLE_ALLOCATED : PaymentAttemptPosting::ROLE_EXCESS,
            ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
            'notes' => $allocate ? 'دفعة إلكترونية — رابط دفع فاتورة' : 'دفعة إلكترونية زائدة غير مخصصة — تحتاج مراجعة',
            'created_by' => $attempt->created_by,
        ];
        if ($allocate) {
            $data['invoice_id'] = $invoice->id;
        }
        $branchId = $attempt->branch_id ?? $invoice->branch_id;
        if ($branchId !== null) {
            $data['branch_id'] = $branchId;
        }

        $payment = $this->payments->create($data, $allocate ? [['invoice_id' => $invoice->id, 'amount' => $amount]] : []);

        return $this->payments->post($payment);
    }

    private function recordBlocked(PaymentAttempt $attempt, Throwable $e): string
    {
        return DB::transaction(function () use ($attempt, $e): string {
            $locked = PaymentAttempt::query()->lockForUpdate()->find($attempt->getKey());
            if ($locked === null || $locked->posting_status === PaymentAttempt::POSTING_POSTED
                || $locked->capture_status !== PaymentAttempt::STATUS_CAPTURED) {
                return $locked?->posting_status === PaymentAttempt::POSTING_POSTED ? self::OUTCOME_ALREADY_POSTED : self::OUTCOME_SKIPPED;
            }

            $date = $locked->accounting_date?->toDateString()
                ?? $locked->captured_at->copy()->setTimezone(self::ACCOUNTING_TIMEZONE)->toDateString();

            $reason = $e instanceof FiscalYearClosedException
                ? ['kind' => 'year', 'fiscal_year_id' => FiscalYear::query()->where('status', FiscalYear::STATUS_CLOSED)
                    ->whereDate('start_date', '<=', $date)->whereDate('end_date', '>=', $date)->value('id')]
                : ['kind' => 'period', 'lock_id' => $this->dateGuard->activeLockFor($date)?->id];

            $updates = ['posting_blocked_reason' => $reason];
            if ($locked->accounting_date === null) {
                $updates['accounting_date'] = $date;
            }
            if ($locked->posting_status !== PaymentAttempt::POSTING_BLOCKED_PERIOD) {
                $updates['posting_status'] = PaymentAttempt::POSTING_BLOCKED_PERIOD;
            }
            $locked->forceFill($updates)->save();

            return self::OUTCOME_BLOCKED_PERIOD;
        });
    }
}
