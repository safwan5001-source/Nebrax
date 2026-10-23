<?php

namespace App\Services;

use App\Models\FiscalYear;
use App\Models\Partner;
use App\Models\PaymentAttempt;
use App\Models\PaymentRefund;
use App\Models\PaymentRefundEvent;
use App\Models\User;
use App\Services\Accounting\AccountingDateGuard;
use App\Services\Accounting\AccountingPeriodLockedException;
use App\Services\Accounting\AccountRoleResolver;
use App\Services\Accounting\FiscalYearClosedException;
use App\Services\Accounting\LedgerService;
use App\Support\PaymentRefundException;
use App\Support\Rbac;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * ترحيل استرداد بوابة مؤكَّد من المزوّد (PAY-H3-01c، ADR-0007 A5). **القيد الوحيد عبر `LedgerService::post`** (لا كتابة مباشرة في الأستاذ):
 *
 *      مدين  accounts_receivable + الطرف   بمبلغ الاسترداد   ┐ يعكس جزئياً قيد الالتقاط A1 (مدين gateway_clearing / دائن العملاء)
 *      دائن  gateway_clearing              بمبلغ الاسترداد   ┘ ويستهلك رصيد العميل الدائن الناتج عن الإشعار الدائن/المرتجع
 *
 *  لا سطر على الإيراد ولا الضريبة (عُكسا بقيد التصحيح التجاري)، ولا مساس بـZATCA/المخزون/`Invoice::paid_amount`. الدوران يُحلّان وقت الترحيل عبر
 *  `AccountRoleResolver` (فشل مغلق إن فُقد/عُطّل التعيين).
 *
 *  • **التاريخ المحاسبي = تاريخ لحظة التأكيد المحلي** بتوقيت Asia/Riyadh (قرار المالك 3)، يُثبَّت عند أول محاولة ولا يتغيّر؛ تاريخ المزوّد في `provider_refunded_at`.
 *  • **الفترة/السنة المقفلة:** `AccountingDateGuard` قبل القيد؛ الرفض يتراجع كلياً ثم تُسجَّل `blocked_period` مع السبب **والإثبات محفوظ** (المبلغ ومرجع المزوّد وسجل
 *    المحاولات) بلا إعادة تأريخ تلقائية. إعادة الترحيل صريحة بعد فتح رسمي فقط (`payments.resolve_blocked` + سبب مسجَّل) وبالتاريخ الأصلي.
 *  • **التفرد:** مدخل واحد لكل استرداد: قفل الصف + `payment_refunds_journal_unique` + حالة `posted` ⇒ التكرار `already_posted` بلا قيد ثانٍ.
 *  • **لا عكس** لاسترداد مؤكَّد (R11): المال خرج فعلاً لدى المزوّد؛ لا مسار `reverse` هنا.
 *  • الأقفال: المحاولة ← صف الاسترداد ← مِرساة المستأجر (داخل `LedgerService`).
 */
final class PaymentRefundPostingService
{
    public const OUTCOME_POSTED = 'posted';

    public const OUTCOME_ALREADY_POSTED = 'already_posted';

    public const OUTCOME_BLOCKED_PERIOD = 'blocked_period';

    public const OUTCOME_SKIPPED = 'skipped';

    private const ACCOUNTING_TIMEZONE = 'Asia/Riyadh';

    public function __construct(
        private readonly LedgerService $ledger,
        private readonly AccountRoleResolver $roles,
        private readonly AccountingDateGuard $dateGuard,
        private readonly TenantContext $tenant,
    ) {}

    /**
     * @param  bool  $explicit  إعادة ترحيل صريحة لاسترداد `blocked_period` (بعد فتح رسمي) — لا يُستعمل تلقائياً.
     * @return self::OUTCOME_*
     */
    public function process(PaymentRefund $refund, bool $explicit = false): string
    {
        try {
            return DB::transaction(fn (): string => $this->postWithinTransaction($refund, $explicit));
        } catch (AccountingPeriodLockedException|FiscalYearClosedException $e) {
            // التراجع كامل (لا قيد). نسجّل الحجب بمعاملة مستقلة مع بقاء الإثبات كما هو.
            return $this->recordBlocked($refund, $e);
        }
    }

    /**
     * R10 — إعادة ترحيل صريحة لاسترداد محجوب بفترة/سنة مقفلة **بعد فتحها رسمياً**، بقرار مخوَّل (`payments.resolve_blocked`) وسبب ≥ 5 أحرف. التاريخ الأصلي لا يتغير.
     * ما زال مقفلاً ⇒ يبقى محجوباً والقرار يُسجَّل `still_blocked`. القرار والترحيل في معاملة واحدة.
     *
     * @return self::OUTCOME_POSTED|self::OUTCOME_BLOCKED_PERIOD
     */
    public function repost(PaymentRefund $refund, User $actor, string $reason): string
    {
        $reason = trim($reason);
        if (mb_strlen($reason) < 5 || mb_strlen($reason) > 500) {
            throw new PaymentRefundException('reason_required', 'سبب إعادة الترحيل مطلوب (5–500 حرفاً).');
        }
        $fresh = $this->tenant->has() && $actor->getKey() !== null
            ? User::query()->whereKey($actor->getKey())->where('tenant_id', (string) $this->tenant->id())->where('is_active', true)->first()
            : null;
        if ($fresh === null || ! Rbac::allows((string) $fresh->role, 'payments.resolve_blocked')) {
            throw new PaymentRefundException('forbidden', 'ليست لديك صلاحية معالجة الاستردادات المحجوبة.');
        }

        return DB::transaction(function () use ($refund, $fresh, $reason): string {
            $attemptId = PaymentRefund::query()->whereKey($refund->getKey())->value('payment_attempt_id');
            $attempt = $attemptId === null ? null : PaymentAttempt::query()->lockForUpdate()->find($attemptId);
            $current = $attempt === null ? null : PaymentRefund::query()->lockForUpdate()->find($refund->getKey());
            if ($current === null || $current->posting_status !== PaymentRefund::POSTING_BLOCKED_PERIOD) {
                throw new PaymentRefundException('not_blocked', 'الاسترداد ليس محجوباً بفترة مقفلة.');
            }

            $outcome = $this->process($current, true);
            if (! in_array($outcome, [self::OUTCOME_POSTED, self::OUTCOME_BLOCKED_PERIOD], true)) {
                throw new PaymentRefundException('not_postable', 'تعذّر ترحيل الاسترداد (يحتاج مراجعة).');
            }
            PaymentRefundEvent::query()->create([
                'payment_refund_id' => $current->getKey(),
                'payment_attempt_id' => $current->payment_attempt_id,
                'action' => 'repost',
                'from_status' => $current->status,
                'to_status' => $current->status,
                'actor_id' => $fresh->getKey(),
                'reason' => $reason,
                'meta' => ['outcome' => $outcome === self::OUTCOME_POSTED ? 'posted' : 'still_blocked'],
            ]);

            return $outcome;
        });
    }

    /**
     * شبكة أمان: يرحّل الاستردادات المؤكَّدة المعلّقة (فشل المستمع/انهيار). كل استرداد معزول؛ فشل واحد لا يوقف البقية. لا يعيد ترحيل المحجوب (قرار بشري).
     *
     * @return array{processed: int, posted: int, blocked: int, failed: int}
     */
    public function runPending(int $limit = 100): array
    {
        $summary = ['processed' => 0, 'posted' => 0, 'blocked' => 0, 'failed' => 0];

        $rows = PaymentRefund::query()->withoutGlobalScopes()
            ->where('status', PaymentRefund::CONFIRMED)
            ->where('posting_status', PaymentRefund::POSTING_PENDING)
            ->orderBy('confirmed_at')->limit($limit)->get(['id', 'tenant_id']);

        $previous = $this->tenant->id();
        foreach ($rows as $row) {
            $summary['processed']++;
            $this->tenant->set((string) $row->tenant_id);
            try {
                $refund = PaymentRefund::query()->find($row->getKey());
                $outcome = $refund === null ? self::OUTCOME_SKIPPED : $this->process($refund);
                match ($outcome) {
                    self::OUTCOME_POSTED, self::OUTCOME_ALREADY_POSTED => $summary['posted']++,
                    self::OUTCOME_BLOCKED_PERIOD => $summary['blocked']++,
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

    private function postWithinTransaction(PaymentRefund $refund, bool $explicit): string
    {
        // الترتيب الثابت: المحاولة ← الاسترداد (ثم مِرساة المستأجر داخل LedgerService).
        $attemptId = PaymentRefund::query()->whereKey($refund->getKey())->value('payment_attempt_id');
        if ($attemptId === null || PaymentAttempt::query()->lockForUpdate()->find($attemptId) === null) {
            return self::OUTCOME_SKIPPED;
        }
        $locked = PaymentRefund::query()->lockForUpdate()->find($refund->getKey());
        if ($locked === null || $locked->status !== PaymentRefund::CONFIRMED || $locked->posting_status === null) {
            return self::OUTCOME_SKIPPED;
        }
        if ($locked->posting_status === PaymentRefund::POSTING_POSTED) {
            return self::OUTCOME_ALREADY_POSTED;
        }
        if ($locked->posting_status === PaymentRefund::POSTING_BLOCKED_PERIOD && ! $explicit) {
            return self::OUTCOME_BLOCKED_PERIOD;
        }

        $amount = (int) $locked->amount_minor;
        $allocated = (int) $locked->allocations()->sum('amount_minor');
        if ($amount <= 0 || $allocated !== $amount) {
            return self::OUTCOME_SKIPPED; // لا ترحيل بتخصيص مخالف للمبلغ (دفاع إضافي؛ القاعدة تمنع ذلك عند الاعتماد)
        }

        $date = $locked->accounting_date?->toDateString() ?? $this->localDate($locked);
        $this->dateGuard->assertOpen($date, 'ترحيل استرداد بوابة');

        $receivable = $this->roles->resolve('accounts_receivable');
        $clearing = $this->roles->resolve('gateway_clearing');

        $entry = $this->ledger->post([
            [
                'account_id' => $receivable->id,
                'debit' => $amount,
                'partner_type' => Partner::class,
                'partner_id' => $locked->partner_id,
            ],
            [
                'account_id' => $clearing->id,
                'credit' => $amount,
            ],
        ], [
            'entry_date' => $date,
            'description' => "استرداد بوابة {$locked->number}",
            'source_type' => PaymentRefund::class,
            'source_id' => $locked->getKey(),
            'branch_id' => $locked->branch_id,
            'created_by' => $locked->requested_by,
        ]);

        $locked->forceFill([
            'posting_status' => PaymentRefund::POSTING_POSTED,
            'journal_entry_id' => $entry->id,
            'accounting_date' => $date,
            'posted_at' => now('UTC'),
            'posting_blocked_reason' => null,
        ])->save();

        return self::OUTCOME_POSTED;
    }

    private function recordBlocked(PaymentRefund $refund, Throwable $e): string
    {
        return DB::transaction(function () use ($refund, $e): string {
            $attemptId = PaymentRefund::query()->whereKey($refund->getKey())->value('payment_attempt_id');
            if ($attemptId !== null) {
                PaymentAttempt::query()->lockForUpdate()->find($attemptId);
            }
            $locked = PaymentRefund::query()->lockForUpdate()->find($refund->getKey());
            if ($locked === null || $locked->status !== PaymentRefund::CONFIRMED || $locked->posting_status === PaymentRefund::POSTING_POSTED) {
                return $locked?->posting_status === PaymentRefund::POSTING_POSTED ? self::OUTCOME_ALREADY_POSTED : self::OUTCOME_SKIPPED;
            }

            $date = $locked->accounting_date?->toDateString() ?? $this->localDate($locked);
            $reason = $e instanceof FiscalYearClosedException
                ? ['kind' => 'year', 'fiscal_year_id' => FiscalYear::query()->where('status', FiscalYear::STATUS_CLOSED)
                    ->whereDate('start_date', '<=', $date)->whereDate('end_date', '>=', $date)->value('id')]
                : ['kind' => 'period', 'lock_id' => $this->dateGuard->activeLockFor($date)?->id];

            $updates = ['posting_blocked_reason' => $reason];
            if ($locked->accounting_date === null) {
                $updates['accounting_date'] = $date;
            }
            if ($locked->posting_status !== PaymentRefund::POSTING_BLOCKED_PERIOD) {
                $updates['posting_status'] = PaymentRefund::POSTING_BLOCKED_PERIOD;
            }
            $locked->forceFill($updates)->save();

            return self::OUTCOME_BLOCKED_PERIOD;
        });
    }

    /** تاريخ لحظة التأكيد المحلي بتوقيت المحاسبة. */
    private function localDate(PaymentRefund $refund): string
    {
        return $refund->confirmed_at->copy()->setTimezone(self::ACCOUNTING_TIMEZONE)->toDateString();
    }
}
