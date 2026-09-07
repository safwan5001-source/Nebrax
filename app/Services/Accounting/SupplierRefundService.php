<?php

namespace App\Services\Accounting;

use App\Models\Partner;
use App\Models\PaymentMethod;
use App\Models\ReturnDocument;
use App\Models\SupplierRefund;
use App\Models\SupplierRefundAllocation;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  SupplierRefundService — استرداد نقدي فعلي من مورّد (ACC-RET-1)
 * ═══════════════════════════════════════════════════════════════
 *
 *  `مرتجع المشتريات ≠ استرداد المورّد`. المرتجع يعكس الالتزام تجارياً على
 *  الموردين ولا يحرّك نقداً إطلاقاً؛ وهذا المستند وحده يسجّل عودة المال:
 *
 *      مدين  الخزينة/البنك المختار (CashBankAccount)
 *      دائن  الموردين (`accounts_payable` عبر AccountRoleResolver)
 *
 *  الجانب النقدي يبقى بالكامل ملك `CashBankAccountService` — لا دور دلالي
 *  عام للنقد/البنك. وطرف المورّد إلزامي على سطر الدائن.
 *
 *  **V1: الاسترداد مخصَّصٌ بالكامل** على مرتجعات مشتريات مرحّلة لنفس المورّد
 *  (مجموع التخصيصات = مبلغ الاسترداد). لا استرداد «على الحساب» بلا تخصيص —
 *  ذاك عقدٌ مستقل لم يُقرّ بعد.
 *
 *  الرصيد القابل للاسترداد لمرتجعٍ ما = إجماليه ناقص تخصيصات الاستردادات
 *  **المرحّلة غير المعكوسة** وحدها. لا مخزون رصيدٍ متغيّر ولا مساس بـ
 *  `Purchase::paid_amount` ولا بتخصيصات `Payment`.
 *
 *  دورة الحياة: draft → posted → reversed. لا كتابة مباشرة في journal_lines.
 */
class SupplierRefundService
{
    public function __construct(
        protected LedgerService $ledger,
        protected CashBankAccountService $cashBankAccounts,
        protected AccountRoleResolver $accountRoles,
    ) {}

    /**
     * الرصيد القابل للاسترداد لمرتجع مشتريات: إجماليه ناقص ما استُرد فعلاً
     * (تخصيصات الاستردادات المرحّلة غير المعكوسة). مصدر الحقيقة الوحيد —
     * لا لقطة مخزَّنة تفترق عنه بصمت.
     */
    public function refundableBalance(ReturnDocument $return): int
    {
        return (int) $return->total - $this->refundedTotal($return->id);
    }

    /** ما استُرد فعلاً عن مرتجع واحد (المرحّل غير المعكوس فقط). */
    private function refundedTotal(string $returnId): int
    {
        return (int) SupplierRefundAllocation::query()
            ->where('purchase_return_id', $returnId)
            ->whereHas('supplierRefund', fn ($q) => $q->where('status', 'posted'))
            ->sum('amount');
    }

    /**
     * مرتجعات المشتريات المرحّلة لمورّدٍ ما ولها رصيد قابل للاسترداد — تغذّي
     * شاشة الإنشاء. لا تُرجع مرتجعاً استُرد بالكامل.
     *
     * @return array<int, array{id:string,number:string,return_date:string,total:int,refunded:int,refundable:int}>
     */
    public function eligibleReturns(string $partnerId): array
    {
        $returns = ReturnDocument::query()
            ->where('type', 'purchase')
            ->where('status', 'posted')
            ->where('partner_id', $partnerId)
            ->orderBy('return_date')
            ->orderBy('number')
            ->get();

        $rows = [];
        foreach ($returns as $return) {
            $refunded = $this->refundedTotal($return->id);
            $refundable = (int) $return->total - $refunded;
            if ($refundable <= 0) {
                continue;
            }

            $rows[] = [
                'id'          => $return->id,
                'number'      => $return->number,
                'return_date' => $return->return_date->toDateString(),
                'total'       => (int) $return->total,
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
     * @param  array  $allocations  [['purchase_return_id'=>uuid,'amount'=>int], ...]
     */
    public function create(array $data, array $allocations = []): SupplierRefund
    {
        $amount = (int) ($data['amount'] ?? 0);
        if ($amount <= 0) {
            throw new RuntimeException('مبلغ الاسترداد يجب أن يكون موجباً.');
        }

        $normalized = $this->normalizeAllocations($allocations, $amount);
        $date = $data['refund_date'] ?? now()->toDateString();
        [$method, $cashAccountId, $paymentMethod] = $this->resolveDestination($data);
        $this->assertSupplier($data['partner_id'] ?? null);

        return DB::transaction(function () use ($data, $amount, $date, $normalized, $method, $cashAccountId, $paymentMethod) {
            // النسخ/الإنشاء لفرعٍ محدد يحفظ نطاق المصدر صراحةً، فلا ينتقل الرقم
            // إلى سلسلة الفرع النشط ثم يصطدم بقيدها الفريد.
            $hasExplicitBranch = array_key_exists('branch_id', $data);
            $number = $data['number'] ?? (
                $hasExplicitBranch
                    ? SupplierRefund::nextDocumentNumber('SRF', $date, $data['branch_id'])
                    : SupplierRefund::nextDocumentNumber('SRF', $date)
            );

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
            ];
            if ($hasExplicitBranch) {
                $attributes['branch_id'] = $data['branch_id'];
            }

            $refund = SupplierRefund::create($attributes);

            // التحقق التجاري للتخصيصات يجري داخل المعاملة نفسها: مسوّدتان
            // أُنشئتا معاً لا تحجزان رصيداً، والحسم النهائي عند الترحيل.
            $this->assertAllocatable($normalized, $refund->partner_id);

            foreach ($normalized as $allocation) {
                SupplierRefundAllocation::create([
                    'supplier_refund_id' => $refund->id,
                    'purchase_return_id' => $allocation['purchase_return_id'],
                    'amount'             => $allocation['amount'],
                ]);
            }

            return $refund->fresh('allocations');
        });
    }

    /** تعديل مسوّدة الاسترداد؛ المرحّل والمعكوس لا يُعدَّلان إطلاقاً. */
    public function update(SupplierRefund $refund, array $data, array $allocations = []): SupplierRefund
    {
        if (! $refund->isDraft()) {
            throw new RuntimeException('لا يمكن تعديل استرداد مرحّل أو معكوس.');
        }

        $amount = (int) ($data['amount'] ?? 0);
        if ($amount <= 0) {
            throw new RuntimeException('مبلغ الاسترداد يجب أن يكون موجباً.');
        }

        $normalized = $this->normalizeAllocations($allocations, $amount);
        [$method, $cashAccountId, $paymentMethod] = $this->resolveDestination($data);
        $this->assertSupplier($data['partner_id'] ?? $refund->partner_id);

        return DB::transaction(function () use ($refund, $data, $amount, $normalized, $method, $cashAccountId, $paymentMethod) {
            $refund = SupplierRefund::lockForUpdate()->findOrFail($refund->id);
            if (! $refund->isDraft()) {
                throw new RuntimeException('لا يمكن تعديل استرداد مرحّل أو معكوس.');
            }

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
            ]);

            $this->assertAllocatable($normalized, $refund->partner_id);

            $refund->allocations()->delete();
            foreach ($normalized as $allocation) {
                SupplierRefundAllocation::create([
                    'supplier_refund_id' => $refund->id,
                    'purchase_return_id' => $allocation['purchase_return_id'],
                    'amount'             => $allocation['amount'],
                ]);
            }

            return $refund->fresh('allocations');
        });
    }

    /** حذف مسوّدة فقط — المستند المرحّل حجّة قائمة لا تُحذف. */
    public function delete(SupplierRefund $refund): void
    {
        if (! $refund->isDraft()) {
            throw new RuntimeException('لا يمكن حذف استرداد مرحّل أو معكوس.');
        }

        DB::transaction(function () use ($refund) {
            $refund = SupplierRefund::lockForUpdate()->findOrFail($refund->id);
            if (! $refund->isDraft()) {
                throw new RuntimeException('لا يمكن حذف استرداد مرحّل أو معكوس.');
            }

            $refund->allocations()->delete();
            $refund->delete();
        });
    }

    /**
     * ترحيل الاسترداد: معاملةٌ واحدة تقفل المستند ثم مرتجعاته بترتيب حتمي،
     * تُعيد التحقق من الأرصدة القابلة للاسترداد داخل القفل، ثم تولّد القيد.
     * لا أثر جزئي ينجو من أي فشل.
     */
    public function post(SupplierRefund $refund, ?User $actor = null): SupplierRefund
    {
        if (! $refund->isDraft()) {
            throw new RuntimeException('لا يمكن ترحيل استرداد غير مسوّد (draft).');
        }

        return DB::transaction(function () use ($refund, $actor) {
            // 1) قفل المستند وإعادة فحص حالته — يمنع الترحيل المزدوج المتزامن.
            $refund = SupplierRefund::lockForUpdate()->findOrFail($refund->id);
            if (! $refund->isDraft()) {
                throw new RuntimeException('لا يمكن ترحيل استرداد غير مسوّد (draft).');
            }

            $allocations = $refund->allocations()->orderBy('purchase_return_id')->get();
            if ($allocations->isEmpty()) {
                throw new RuntimeException('لا يمكن ترحيل استرداد بلا تخصيص على مرتجعات مشتريات.');
            }

            $allocatedTotal = (int) $allocations->sum('amount');
            if ($allocatedTotal !== (int) $refund->amount) {
                throw new RuntimeException(
                    "مجموع التخصيصات ({$allocatedTotal}) يجب أن يساوي مبلغ الاسترداد ({$refund->amount})."
                );
            }

            // 2) قفل المرتجعات بترتيب حتمي (معرّف تصاعدي) — استردادان متزامنان
            //    على المرتجع نفسه يصطفّان بدل أن يقرأ كلٌّ منهما رصيداً قديماً.
            foreach ($allocations as $allocation) {
                $return = ReturnDocument::lockForUpdate()->find($allocation->purchase_return_id);

                // 3) إعادة التحقق الكاملة **داخل** القفل لا قبله.
                if (! $return) {
                    throw new RuntimeException('مرتجع المشتريات المخصَّص غير موجود.');
                }
                if ($return->type !== 'purchase') {
                    throw new RuntimeException('الاسترداد يُخصَّص على مرتجعات مشتريات فقط.');
                }
                if (! $return->isPosted()) {
                    throw new RuntimeException('لا يمكن الاسترداد على مرتجع مشتريات غير مرحّل.');
                }
                if ($return->partner_id !== $refund->partner_id) {
                    throw new RuntimeException('المرتجع المخصَّص لا يخص مورّد الاسترداد.');
                }

                $refundable = $this->refundableBalance($return);
                if ($allocation->amount > $refundable) {
                    throw new RuntimeException(
                        "مبلغ التخصيص ({$allocation->amount}) يتجاوز الرصيد القابل للاسترداد على المرتجع ({$refundable})."
                    );
                }
            }

            // 4) الوجهة النقدية من نطاق CashBankAccount وحده، وصلاحية الإيداع
            //    تُفحص عند الأثر المالي — المال يدخل خزينتنا فهو إيداع.
            $cashEntity = $this->cashBankAccounts->resolveForPayment($refund->cash_account_id, $refund->method);
            $this->cashBankAccounts->assertAllowed($cashEntity, 'deposit', $actor);

            // 5) طرف المورّد عبر الدور الدلالي؛ تعيينٌ صريح غير صالح يفشل مغلقاً.
            $payableAccount = $this->accountRoles->resolve('accounts_payable');

            // 6) القيد عبر المحرك حصراً: مدين النقد/البنك، دائن الموردين.
            $entry = $this->ledger->post([
                [
                    'account_id' => $cashEntity->account_id,
                    'debit'      => (int) $refund->amount,
                ],
                [
                    'account_id'   => $payableAccount->id,
                    'credit'       => (int) $refund->amount,
                    'partner_type' => Partner::class,
                    'partner_id'   => $refund->partner_id,
                ],
            ], [
                'entry_date'  => $refund->refund_date->toDateString(),
                'description' => "استرداد مورّد {$refund->number}",
                'source_type' => SupplierRefund::class,
                'source_id'   => $refund->id,
                'branch_id'   => $refund->branch_id, // القيد يتبع فرع المستند لا الفرع النشط
                'created_by'  => $refund->created_by,
            ]);

            // 7) تثبيت الحالة والقيد داخل المعاملة نفسها.
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
    public function reverse(SupplierRefund $refund, ?string $date = null, ?string $reason = null): SupplierRefund
    {
        if (! $refund->isPosted()) {
            throw new RuntimeException('لا يمكن عكس استرداد غير مرحّل.');
        }

        return DB::transaction(function () use ($refund, $date, $reason) {
            $refund = SupplierRefund::lockForUpdate()->findOrFail($refund->id);
            if (! $refund->isPosted()) {
                throw new RuntimeException('لا يمكن عكس استرداد غير مرحّل.');
            }
            if ($refund->journal_entry_id === null) {
                throw new RuntimeException('لا يوجد قيد أصلي لعكسه.');
            }

            $original = $refund->journalEntry()->firstOrFail();
            $reversal = $this->ledger->reverse($original, $date, $reason ?? "عكس استرداد مورّد {$refund->number}");

            $refund->update([
                'status'            => 'reversed',
                'reversal_entry_id' => $reversal->id,
                'reversed_at'       => now(),
            ]);

            return $refund->fresh('allocations');
        });
    }

    /**
     * تطبيع التخصيصات والتحقق الشكلي منها: مبالغ موجبة، بلا تكرار لمرتجع،
     * ومجموعها يساوي مبلغ الاسترداد (V1 لا يقبل استرداداً غير مخصَّص كاملاً).
     *
     * @return array<int, array{purchase_return_id:string, amount:int}>
     */
    private function normalizeAllocations(array $allocations, int $amount): array
    {
        if (empty($allocations)) {
            throw new RuntimeException('الاسترداد يحتاج تخصيصاً واحداً على الأقل على مرتجع مشتريات مرحّل.');
        }

        $normalized = [];
        $seen = [];
        $sum = 0;

        foreach ($allocations as $allocation) {
            $returnId = $allocation['purchase_return_id'] ?? null;
            $allocated = (int) ($allocation['amount'] ?? 0);

            if (empty($returnId) || $allocated <= 0) {
                throw new RuntimeException('كل تخصيص يحتاج مرتجع مشتريات ومبلغاً موجباً.');
            }
            if (isset($seen[$returnId])) {
                throw new RuntimeException('لا يمكن تخصيص المرتجع نفسه مرتين في استرداد واحد.');
            }

            $seen[$returnId] = true;
            $normalized[] = ['purchase_return_id' => $returnId, 'amount' => $allocated];
            $sum += $allocated;
        }

        if ($sum !== $amount) {
            throw new RuntimeException("مجموع التخصيصات ({$sum}) يجب أن يساوي مبلغ الاسترداد ({$amount}).");
        }

        return $normalized;
    }

    /**
     * تحقق تجاري من كل هدف: مرتجع مشتريات مرحّل، لنفس المورّد، ولا يتجاوز
     * رصيده القابل للاسترداد. يُعاد كاملاً داخل قفل الترحيل — هذا الفحص
     * المبكّر يمنع مسوّدة مستحيلة لا أكثر.
     *
     * @param  array<int, array{purchase_return_id:string, amount:int}>  $allocations
     */
    private function assertAllocatable(array $allocations, string $partnerId): void
    {
        foreach ($allocations as $allocation) {
            // المعرّف يمرّ عبر TenantScope: مرتجع مستأجرٍ آخر لا يُحلّ أصلاً.
            $return = ReturnDocument::find($allocation['purchase_return_id']);

            if (! $return) {
                throw new RuntimeException('مرتجع المشتريات المخصَّص غير موجود.');
            }
            if ($return->type !== 'purchase') {
                throw new RuntimeException('الاسترداد يُخصَّص على مرتجعات مشتريات فقط.');
            }
            if (! $return->isPosted()) {
                throw new RuntimeException('لا يمكن الاسترداد على مرتجع مشتريات غير مرحّل.');
            }
            if ($return->partner_id !== $partnerId) {
                throw new RuntimeException('المرتجع المخصَّص لا يخص مورّد الاسترداد.');
            }

            $refundable = $this->refundableBalance($return);
            if ($allocation['amount'] > $refundable) {
                throw new RuntimeException(
                    "مبلغ التخصيص ({$allocation['amount']}) يتجاوز الرصيد القابل للاسترداد على المرتجع ({$refundable})."
                );
            }
        }
    }

    /** المورّد إلزامي وموجود داخل المستأجر النشط. */
    private function assertSupplier(?string $partnerId): void
    {
        if (empty($partnerId) || ! Partner::whereKey($partnerId)->exists()) {
            throw new RuntimeException('المورّد غير موجود.');
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
