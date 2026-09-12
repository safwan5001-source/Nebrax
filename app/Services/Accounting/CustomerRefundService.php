<?php

namespace App\Services\Accounting;

use App\Models\CreditNote;
use App\Models\CustomerRefund;
use App\Models\CustomerRefundAllocation;
use App\Models\Partner;
use App\Models\PaymentMethod;
use App\Models\ReturnDocument;
use App\Models\User;
use App\Tenancy\BranchContext;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  CustomerRefundService — استرداد نقدي فعلي لعميل (PAY-V2-6B)
 * ═══════════════════════════════════════════════════════════════
 *
 *  `مرتجع المبيعات/الإشعار الدائن ≠ استرداد العميل`. التصحيح التجاري الآجل
 *  يعكس الإيراد ويُدائن العملاء ولا يُخرج نقداً؛ وهذا المستند وحده يسجّل
 *  خروج المال:
 *
 *      مدين  العملاء (`accounts_receivable` عبر AccountRoleResolver)
 *      دائن  الخزينة/البنك المختار (CashBankAccount) — سحب
 *
 *  الجانب النقدي يبقى بالكامل ملك `CashBankAccountService` — لا دور دلالي
 *  عام للنقد/البنك. وطرف العميل إلزامي على سطر المدين.
 *
 *  **V1: الاسترداد مخصَّصٌ بالكامل** على تصحيحات تجارية مرحّلة لنفس العميل
 *  أنشأت رصيد عميل (مجموع التخصيصات = مبلغ الاسترداد):
 *    - مرتجع مبيعات `payment_type=credit`
 *    - إشعار دائن مبيعات `refund_type=credit`
 *  مرتجع/إشعار نقدي سبق أن دائن الصندوق مباشرةً — ليس هدفاً قابلاً للاسترداد.
 *  لا استرداد «على الحساب» بلا تخصيص — ذاك عقدٌ مستقل لم يُقرّ بعد.
 *
 *  الرصيد القابل للاسترداد = إجمالي التصحيح ناقص تخصيصات الاستردادات
 *  **المرحّلة غير المعكوسة** وحدها. لا مخزون رصيدٍ متغيّر ولا مساس بـ
 *  `Invoice::paid_amount` ولا بتخصيصات `Payment`.
 *
 *  **الفرع يُورَّث من التصحيح التجاري ولا يُختار مستقلاً.** كل المصادر في
 *  استرداد واحد يجب أن تشترك في `branch_id` نفسه (بما في ذلك `null`). لا سياسة
 *  معتمدة لتخصيص عابر للفروع — المزيج يُرفض مغلقاً. قيد الاسترداد يُوسَم بفرع
 *  المصدر لا بالفرع النشط ولا بقيمة صريحة مخالفة. سياق فرعٍ نشط يخالف المصدر
 *  يُرفض كذلك (نفس اصطلاح سند التسليم → فاتورة).
 *
 *  دورة الحياة: draft → posted → reversed. لا كتابة مباشرة في journal_lines.
 */
class CustomerRefundService
{
    public const SOURCE_SALES_RETURN = 'sales_return';
    public const SOURCE_CREDIT_NOTE = 'credit_note';

    private const SOURCE_MODELS = [
        self::SOURCE_SALES_RETURN => ReturnDocument::class,
        self::SOURCE_CREDIT_NOTE => CreditNote::class,
    ];

    public function __construct(
        protected LedgerService $ledger,
        protected CashBankAccountService $cashBankAccounts,
        protected AccountRoleResolver $accountRoles,
    ) {}

    /**
     * الرصيد القابل للاسترداد لتصحيح تجاري: إجماليه ناقص ما استُرد فعلاً
     * (تخصيصات الاستردادات المرحّلة غير المعكوسة). مصدر الحقيقة الوحيد —
     * لا لقطة مخزَّنة تفترق عنه بصمت.
     */
    public function refundableBalance(ReturnDocument|CreditNote $source): int
    {
        return (int) $source->total - $this->refundedTotal($this->sourceKind($source), $source->id);
    }

    /** ما استُرد فعلاً عن مصدر واحد (المرحّل غير المعكوس فقط). */
    private function refundedTotal(string $kind, string $sourceId): int
    {
        return (int) CustomerRefundAllocation::query()
            ->where('source_type', self::SOURCE_MODELS[$kind])
            ->where('source_id', $sourceId)
            ->whereHas('customerRefund', fn ($q) => $q->where('status', 'posted'))
            ->sum('amount');
    }

    /**
     * التصحيحات التجارية المرحّلة لعميلٍ ما ولها رصيد قابل للاسترداد — تغذّي
     * شاشة الإنشاء. لا تُرجع مستنداً استُرد بالكامل ولا تصحيحاً نقدياً سبق
     * أن حرّك الصندوق. مع فرعٍ نشط لا تُعرض مصادر فرعٍ آخر (لا يمكن تخصيصها
     * تحت قاعدة وراثة الفرع).
     *
     * @return array<int, array{source_type:string,id:string,number:string,date:string,total:int,refunded:int,refundable:int}>
     */
    public function eligibleSources(string $partnerId): array
    {
        $rows = [];
        $restrictToBranch = app(BranchContext::class)->has();
        $branchId = $restrictToBranch ? app(BranchContext::class)->id() : false;

        $returns = ReturnDocument::query()
            ->where('type', 'sales')
            ->where('payment_type', 'credit')
            ->where('status', 'posted')
            ->where('partner_id', $partnerId)
            ->when($restrictToBranch, fn ($q) => $q->where('branch_id', $branchId))
            ->orderBy('return_date')
            ->orderBy('number')
            ->get();

        foreach ($returns as $return) {
            $refunded = $this->refundedTotal(self::SOURCE_SALES_RETURN, $return->id);
            $refundable = (int) $return->total - $refunded;
            if ($refundable <= 0) {
                continue;
            }

            $rows[] = [
                'source_type' => self::SOURCE_SALES_RETURN,
                'id'          => $return->id,
                'number'      => $return->number,
                'date'        => $return->return_date->toDateString(),
                'total'       => (int) $return->total,
                'refunded'    => $refunded,
                'refundable'  => $refundable,
            ];
        }

        $notes = CreditNote::query()
            ->where('type', 'sales')
            ->where('refund_type', 'credit')
            ->where('status', 'posted')
            ->where('partner_id', $partnerId)
            ->when($restrictToBranch, fn ($q) => $q->where('branch_id', $branchId))
            ->orderBy('note_date')
            ->orderBy('number')
            ->get();

        foreach ($notes as $note) {
            $refunded = $this->refundedTotal(self::SOURCE_CREDIT_NOTE, $note->id);
            $refundable = (int) $note->total - $refunded;
            if ($refundable <= 0) {
                continue;
            }

            $rows[] = [
                'source_type' => self::SOURCE_CREDIT_NOTE,
                'id'          => $note->id,
                'number'      => $note->number,
                'date'        => $note->note_date->toDateString(),
                'total'       => (int) $note->total,
                'refunded'    => $refunded,
                'refundable'  => $refundable,
            ];
        }

        return $rows;
    }

    /**
     * إنشاء استرداد بحالة draft مع تخصيصاته.
     *
     * @param  array  $data         ['partner_id'=>uuid,'amount'=>int,'method'=>'cash|bank','cash_account_id'=>?,
     *                               'payment_method_id'=>?,'refund_date'=>?,'reference'=>?,'notes'=>?,'branch_id'=>?]
     * @param  array  $allocations  [['source_type'=>'sales_return|credit_note','source_id'=>uuid,'amount'=>int], ...]
     */
    public function create(array $data, array $allocations = []): CustomerRefund
    {
        unset($data['tenant_id']);

        $amount = (int) ($data['amount'] ?? 0);
        if ($amount <= 0) {
            throw new RuntimeException('مبلغ الاسترداد يجب أن يكون موجباً.');
        }

        $normalized = $this->normalizeAllocations($allocations, $amount);
        $date = $data['refund_date'] ?? now()->toDateString();
        [$method, $cashAccountId, $paymentMethod] = $this->resolveDestination($data);
        $this->assertCustomer($data['partner_id'] ?? null);

        return DB::transaction(function () use ($data, $amount, $date, $normalized, $method, $cashAccountId, $paymentMethod) {
            $requestedBranch = array_key_exists('branch_id', $data) ? ($data['branch_id'] ?? null) : false;
            $sourceBranch = $this->assertAllocatable($normalized, $data['partner_id'], $requestedBranch);

            $number = $data['number'] ?? CustomerRefund::nextDocumentNumber('CRF', $date, $sourceBranch);

            $attributes = [
                'number'              => $number,
                'partner_id'          => $data['partner_id'],
                'refund_date'         => $date,
                'amount'              => $amount,
                'method'              => $method,
                'payment_method_id'   => $paymentMethod['id'],
                'payment_method_name' => $paymentMethod['name'],
                'cash_account_id'     => $cashAccountId,
                'reference'           => $data['reference'] ?? null,
                'notes'               => $data['notes'] ?? null,
                'status'              => 'draft',
                'created_by'          => $data['created_by'] ?? null,
                'branch_id'           => $sourceBranch,
            ];

            $refund = CustomerRefund::create($attributes);
            // BelongsToBranch يسم الفرع النشط حين يكون branch_id فارغاً — مصدر
            // بلا فرع (null) لا يجوز أن يُوسَم بفرعٍ نشط غير ذي صلة.
            if ($refund->branch_id !== $sourceBranch) {
                $refund->forceFill(['branch_id' => $sourceBranch])->save();
            }

            foreach ($normalized as $allocation) {
                CustomerRefundAllocation::create([
                    'customer_refund_id' => $refund->id,
                    'source_type'        => self::SOURCE_MODELS[$allocation['source_type']],
                    'source_id'          => $allocation['source_id'],
                    'amount'             => $allocation['amount'],
                ]);
            }

            return $refund->fresh('allocations');
        });
    }

    /** تعديل مسوّدة الاسترداد؛ المرحّل والمعكوس لا يُعدَّلان إطلاقاً. */
    public function update(CustomerRefund $refund, array $data, array $allocations = []): CustomerRefund
    {
        unset($data['tenant_id']);

        if (! $refund->isDraft()) {
            throw new RuntimeException('لا يمكن تعديل استرداد مرحّل أو معكوس.');
        }

        $amount = (int) ($data['amount'] ?? 0);
        if ($amount <= 0) {
            throw new RuntimeException('مبلغ الاسترداد يجب أن يكون موجباً.');
        }

        $normalized = $this->normalizeAllocations($allocations, $amount);
        [$method, $cashAccountId, $paymentMethod] = $this->resolveDestination($data);
        $this->assertCustomer($data['partner_id'] ?? $refund->partner_id);

        return DB::transaction(function () use ($refund, $data, $amount, $normalized, $method, $cashAccountId, $paymentMethod) {
            $refund = CustomerRefund::lockForUpdate()->findOrFail($refund->id);
            if (! $refund->isDraft()) {
                throw new RuntimeException('لا يمكن تعديل استرداد مرحّل أو معكوس.');
            }

            $requestedBranch = array_key_exists('branch_id', $data) ? ($data['branch_id'] ?? null) : false;
            $sourceBranch = $this->assertAllocatable(
                $normalized,
                $data['partner_id'] ?? $refund->partner_id,
                $requestedBranch,
            );

            $refund->update([
                'partner_id'          => $data['partner_id'] ?? $refund->partner_id,
                'refund_date'         => $data['refund_date'] ?? $refund->refund_date->toDateString(),
                'amount'              => $amount,
                'method'              => $method,
                'payment_method_id'   => $paymentMethod['id'],
                'payment_method_name' => $paymentMethod['name'],
                'cash_account_id'     => $cashAccountId,
                'reference'           => $data['reference'] ?? null,
                'notes'               => $data['notes'] ?? null,
                'branch_id'           => $sourceBranch,
            ]);

            $refund->allocations()->delete();
            foreach ($normalized as $allocation) {
                CustomerRefundAllocation::create([
                    'customer_refund_id' => $refund->id,
                    'source_type'        => self::SOURCE_MODELS[$allocation['source_type']],
                    'source_id'          => $allocation['source_id'],
                    'amount'             => $allocation['amount'],
                ]);
            }

            return $refund->fresh('allocations');
        });
    }

    /** حذف مسوّدة فقط — المستند المرحّل حجّة قائمة لا تُحذف. */
    public function delete(CustomerRefund $refund): void
    {
        if (! $refund->isDraft()) {
            throw new RuntimeException('لا يمكن حذف استرداد مرحّل أو معكوس.');
        }

        DB::transaction(function () use ($refund) {
            $refund = CustomerRefund::lockForUpdate()->findOrFail($refund->id);
            if (! $refund->isDraft()) {
                throw new RuntimeException('لا يمكن حذف استرداد مرحّل أو معكوس.');
            }

            $refund->allocations()->delete();
            $refund->delete();
        });
    }

    /**
     * ترحيل الاسترداد: معاملةٌ واحدة تقفل المستند ثم مصادره بترتيب حتمي،
     * تُعيد التحقق من الأرصدة القابلة للاسترداد داخل القفل، ثم تولّد القيد.
     * لا أثر جزئي ينجو من أي فشل.
     */
    public function post(CustomerRefund $refund, ?User $actor = null): CustomerRefund
    {
        if (! $refund->isDraft()) {
            throw new RuntimeException('لا يمكن ترحيل استرداد غير مسوّد (draft).');
        }

        return DB::transaction(function () use ($refund, $actor) {
            $refund = CustomerRefund::lockForUpdate()->findOrFail($refund->id);
            if (! $refund->isDraft()) {
                throw new RuntimeException('لا يمكن ترحيل استرداد غير مسوّد (draft).');
            }

            $allocations = $refund->allocations()
                ->orderBy('source_type')
                ->orderBy('source_id')
                ->get();
            if ($allocations->isEmpty()) {
                throw new RuntimeException('لا يمكن ترحيل استرداد بلا تخصيص على تصحيح تجاري.');
            }

            $allocatedTotal = (int) $allocations->sum('amount');
            if ($allocatedTotal !== (int) $refund->amount) {
                throw new RuntimeException(
                    "مجموع التخصيصات ({$allocatedTotal}) يجب أن يساوي مبلغ الاسترداد ({$refund->amount})."
                );
            }

            // قفل المصادر بترتيب حتمي: كل مرتجعات المبيعات أولاً ثم الإشعارات،
            // كل مجموعة بمعرّف تصاعدي — استردادان متزامنان يصطفّان بدل أن
            // يقرأ كلٌّ منهما رصيداً قديماً.
            $this->lockSources($allocations);

            $lockedSources = [];
            foreach ($allocations as $allocation) {
                $source = $this->loadSource($allocation->source_type, $allocation->source_id);
                $this->assertSourceEligible($source, $refund->partner_id);

                $refundable = $this->refundableBalance($source);
                if ($allocation->amount > $refundable) {
                    throw new RuntimeException(
                        "مبلغ التخصيص ({$allocation->amount}) يتجاوز الرصيد القابل للاسترداد على التصحيح ({$refundable})."
                    );
                }
                $lockedSources[] = $source;
            }

            $sourceBranch = $this->sharedSourceBranch($lockedSources);
            if ($sourceBranch !== $refund->branch_id) {
                throw new RuntimeException('فرع الاسترداد يجب أن يطابق فرع التصحيح التجاري المخصَّص.');
            }

            // الوجهة النقدية من نطاق CashBankAccount وحده، وصلاحية السحب
            // تُفحص عند الأثر المالي — المال يخرج من خزينتنا فهو سحب.
            $cashEntity = $this->cashBankAccounts->resolveForPayment($refund->cash_account_id, $refund->method);
            $this->cashBankAccounts->assertAllowed($cashEntity, 'withdraw', $actor);

            $receivableAccount = $this->accountRoles->resolve('accounts_receivable');

            $entry = $this->ledger->post([
                [
                    'account_id'   => $receivableAccount->id,
                    'debit'        => (int) $refund->amount,
                    'partner_type' => Partner::class,
                    'partner_id'   => $refund->partner_id,
                ],
                [
                    'account_id' => $cashEntity->account_id,
                    'credit'     => (int) $refund->amount,
                ],
            ], [
                'entry_date'  => $refund->refund_date->toDateString(),
                'description' => "استرداد عميل {$refund->number}",
                'source_type' => CustomerRefund::class,
                'source_id'   => $refund->id,
                'branch_id'   => $refund->branch_id,
                'created_by'  => $refund->created_by,
            ]);

            $refund->update([
                'status'           => 'posted',
                'journal_entry_id' => $entry->id,
                'posted_at'        => now(),
            ]);

            return $refund->fresh('allocations');
        });
    }

    /**
     * عكس الاسترداد: يعكس القيد الأصلي بحساباته الفعلية المخزَّنة عبر
     * `LedgerService::reverse()` — لا إعادة حلٍّ لأي تعيين حالي. صفوف
     * التخصيص تبقى تاريخاً، لكنها تتوقف فوراً عن خصم الرصيد القابل للاسترداد
     * لأن الحساب يقرأ الاستردادات المرحّلة وحدها.
     */
    public function reverse(CustomerRefund $refund, ?string $date = null, ?string $reason = null): CustomerRefund
    {
        if (! $refund->isPosted()) {
            throw new RuntimeException('لا يمكن عكس استرداد غير مرحّل.');
        }

        return DB::transaction(function () use ($refund, $date, $reason) {
            $refund = CustomerRefund::lockForUpdate()->findOrFail($refund->id);
            if (! $refund->isPosted()) {
                throw new RuntimeException('لا يمكن عكس استرداد غير مرحّل.');
            }
            if ($refund->journal_entry_id === null) {
                throw new RuntimeException('لا يوجد قيد أصلي لعكسه.');
            }

            $original = $refund->journalEntry()->firstOrFail();
            $reversal = $this->ledger->reverse($original, $date, $reason ?? "عكس استرداد عميل {$refund->number}");

            $refund->update([
                'status'            => 'reversed',
                'reversal_entry_id' => $reversal->id,
                'reversed_at'       => now(),
            ]);

            return $refund->fresh('allocations');
        });
    }

    /**
     * @return array<int, array{source_type:string, source_id:string, amount:int}>
     */
    private function normalizeAllocations(array $allocations, int $amount): array
    {
        if (empty($allocations)) {
            throw new RuntimeException('الاسترداد يحتاج تخصيصاً واحداً على الأقل على تصحيح تجاري مرحّل.');
        }

        $normalized = [];
        $seen = [];
        $sum = 0;

        foreach ($allocations as $allocation) {
            $kind = $allocation['source_type'] ?? null;
            $sourceId = $allocation['source_id'] ?? null;
            $allocated = (int) ($allocation['amount'] ?? 0);

            if (! is_string($kind) || ! isset(self::SOURCE_MODELS[$kind])) {
                throw new RuntimeException('نوع مصدر التخصيص يجب أن يكون مرتجع مبيعات أو إشعاراً دائناً.');
            }
            if (empty($sourceId) || $allocated <= 0) {
                throw new RuntimeException('كل تخصيص يحتاج تصحيحاً تجارياً ومبلغاً موجباً.');
            }

            $key = $kind . ':' . $sourceId;
            if (isset($seen[$key])) {
                throw new RuntimeException('لا يمكن تخصيص التصحيح نفسه مرتين في استرداد واحد.');
            }

            $seen[$key] = true;
            $normalized[] = [
                'source_type' => $kind,
                'source_id'   => $sourceId,
                'amount'      => $allocated,
            ];
            $sum += $allocated;
        }

        if ($sum !== $amount) {
            throw new RuntimeException("مجموع التخصيصات ({$sum}) يجب أن يساوي مبلغ الاسترداد ({$amount}).");
        }

        return $normalized;
    }

    /**
     * @param  array<int, array{source_type:string, source_id:string, amount:int}>  $allocations
     * @param  string|null|false  $requestedBranch  false = لم يُمرَّر فرع صريح — يُورَّث من المصدر
     */
    private function assertAllocatable(array $allocations, string $partnerId, string|null|false $requestedBranch = false): ?string
    {
        $sources = [];
        foreach ($allocations as $allocation) {
            $model = self::SOURCE_MODELS[$allocation['source_type']];
            $source = $this->loadSource($model, $allocation['source_id']);
            $this->assertSourceEligible($source, $partnerId);

            $refundable = $this->refundableBalance($source);
            if ($allocation['amount'] > $refundable) {
                throw new RuntimeException(
                    "مبلغ التخصيص ({$allocation['amount']}) يتجاوز الرصيد القابل للاسترداد على التصحيح ({$refundable})."
                );
            }
            $sources[] = $source;
        }

        $sourceBranch = $this->sharedSourceBranch($sources);
        $this->assertBranchAgreement($sourceBranch, $requestedBranch);

        return $sourceBranch;
    }

    /**
     * فرع واحد لكل المصادر، أو رفض مغلق. لا سياسة معتمدة لتخصيص عابر للفروع
     * (سند التسليم → فاتورة يرفض branch_mismatch ومزيج المستودعات/العملاء).
     *
     * @param  array<int, ReturnDocument|CreditNote>  $sources
     */
    private function sharedSourceBranch(array $sources): ?string
    {
        $unique = array_values(array_unique(array_map(
            fn (ReturnDocument|CreditNote $source) => $source->branch_id,
            $sources,
        ), SORT_REGULAR));

        if (count($unique) !== 1) {
            throw new RuntimeException('لا يمكن تخصيص تصحيحات تجارية من فروع مختلفة في استرداد واحد.');
        }

        return $unique[0];
    }

    /**
     * @param  string|null|false  $requestedBranch  false = لم يُطلب فرع صريح
     */
    private function assertBranchAgreement(?string $sourceBranch, string|null|false $requestedBranch): void
    {
        if ($requestedBranch !== false && $requestedBranch !== $sourceBranch) {
            throw new RuntimeException('فرع الاسترداد يجب أن يطابق فرع التصحيح التجاري المخصَّص.');
        }

        $ctx = app(BranchContext::class);
        if ($ctx->has() && $ctx->id() !== $sourceBranch) {
            throw new RuntimeException('فرع الاسترداد يجب أن يطابق فرع التصحيح التجاري المخصَّص.');
        }
    }

    private function loadSource(string $model, string $sourceId): ReturnDocument|CreditNote
    {
        $source = $model::find($sourceId);
        if (! $source) {
            throw new RuntimeException('التصحيح التجاري المخصَّص غير موجود.');
        }

        return $source;
    }

    private function assertSourceEligible(ReturnDocument|CreditNote $source, string $partnerId): void
    {
        if ($source instanceof ReturnDocument) {
            if ($source->type !== 'sales') {
                throw new RuntimeException('الاسترداد يُخصَّص على مرتجعات مبيعات أو إشعارات دائنة فقط.');
            }
            if ($source->payment_type !== 'credit') {
                throw new RuntimeException('مرتجع المبيعات النقدي سبق أن ردّ النقد ولا يُستردّ بهذا المستند.');
            }
            if (! $source->isPosted()) {
                throw new RuntimeException('لا يمكن الاسترداد على مرتجع مبيعات غير مرحّل.');
            }
        } else {
            if ($source->type !== 'sales') {
                throw new RuntimeException('الاسترداد يُخصَّص على مرتجعات مبيعات أو إشعارات دائنة فقط.');
            }
            if ($source->refund_type !== 'credit') {
                throw new RuntimeException('الإشعار الدائن النقدي سبق أن ردّ النقد ولا يُستردّ بهذا المستند.');
            }
            if ($source->status !== 'posted') {
                throw new RuntimeException('لا يمكن الاسترداد على إشعار دائن غير مرحّل.');
            }
        }

        if ($source->partner_id !== $partnerId) {
            throw new RuntimeException('التصحيح المخصَّص لا يخص عميل الاسترداد.');
        }
    }

    /**
     * @param  \Illuminate\Support\Collection<int, CustomerRefundAllocation>  $allocations
     */
    private function lockSources($allocations): void
    {
        $returnIds = $allocations
            ->where('source_type', ReturnDocument::class)
            ->pluck('source_id')
            ->sort()
            ->values();
        $noteIds = $allocations
            ->where('source_type', CreditNote::class)
            ->pluck('source_id')
            ->sort()
            ->values();

        foreach ($returnIds as $id) {
            ReturnDocument::lockForUpdate()->find($id);
        }
        foreach ($noteIds as $id) {
            CreditNote::lockForUpdate()->find($id);
        }
    }

    private function sourceKind(ReturnDocument|CreditNote $source): string
    {
        return $source instanceof ReturnDocument
            ? self::SOURCE_SALES_RETURN
            : self::SOURCE_CREDIT_NOTE;
    }

    /** العميل إلزامي وموجود داخل المستأجر النشط، ونوعه عميل أو كلا الطرفين. */
    private function assertCustomer(?string $partnerId): void
    {
        if (empty($partnerId)) {
            throw new RuntimeException('العميل غير موجود.');
        }

        $partner = Partner::whereKey($partnerId)->first();
        if (! $partner || ! in_array($partner->type, ['customer', 'both'], true)) {
            throw new RuntimeException('العميل غير موجود.');
        }
    }

    /**
     * وجهة النقد: طريقة الدفع النشطة إن اختيرت، وإلا نوع الطريقة وحسابها.
     * يُخزَّن حساب الأستاذ الفعلي — نفس اصطلاح `payments.cash_account_id`.
     *
     * @return array{0:string,1:string,2:array{id:?string,name:?string}}
     */
    private function resolveDestination(array $data): array
    {
        $paymentMethodId = $data['payment_method_id'] ?? null;
        if (! $paymentMethodId) {
            $method = $data['method'] ?? 'cash';
            $cashAccount = $this->cashBankAccounts->resolveForPayment($data['cash_account_id'] ?? null, $method);

            return [$method, $cashAccount->account_id, ['id' => null, 'name' => null]];
        }

        $paymentMethod = PaymentMethod::with('cashBankAccount')->find($paymentMethodId);
        if (! $paymentMethod || ! $paymentMethod->is_active) {
            throw new RuntimeException('طريقة الدفع المختارة غير موجودة أو معطلة.');
        }

        $method = $paymentMethod->settlement_type;
        $accountId = $data['cash_account_id'] ?? $paymentMethod->cashBankAccount?->account_id;
        $cashAccount = $this->cashBankAccounts->resolveForPayment($accountId, $method);

        return [$method, $cashAccount->account_id, ['id' => $paymentMethod->id, 'name' => $paymentMethod->name]];
    }
}
