<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\Invoice;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\PaymentAllocation;
use App\Models\Purchase;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  PaymentService — سندات القبض والصرف + تخصيصها على الفواتير
 * ═══════════════════════════════════════════════════════════════
 *  - create(): ينشئ سنداً بحالة draft، ويبني تخصيصاته على الفواتير.
 *  - post():   يرحّل السند، يولّد قيداً متوازناً عبر LedgerService،
 *              ويحدّث سداد كل فاتورة مخصَّصة (unpaid → partial → paid).
 *
 *  قبض من عميل (received):  مدين 1110/1120 │ دائن 1130 العملاء
 *  صرف لمورد  (paid):       مدين 2110       │ دائن 1110/1120
 *
 *  التخصيص (allocation) للقبض فقط: مجموع التخصيصات = مبلغ السند،
 *  وكل تخصيص ≤ متبقي فاتورته، والفاتورة مرحّلة وتخص طرف السند.
 *  لا كتابة مباشرة في journal_lines — القيد عبر المحرك حصراً.
 */
class PaymentService
{
    private const ACC_CASH        = '1110'; // الصندوق
    private const ACC_BANK        = '1120'; // البنك
    private const ACC_RECEIVABLE  = '1130'; // العملاء
    private const ACC_PAYABLE     = '2110'; // الموردون

    /**
     * عائلة النقد والبنوك في دليل الحسابات — المدى المقبول لـ«الخزينة».
     * خزينةٌ ثانية أو حسابٌ بنكي إضافي يُرمَّز داخل 111x/112x، وما دونه
     * (1130 العملاء، 1140 المخزون…) يجعل قيد السند متوازناً وكاذباً معاً.
     */
    private const CASH_CODE_PREFIXES = ['111', '112'];

    public function __construct(
        protected LedgerService $ledger
    ) {}

    /**
     * إنشاء سند قبض/صرف بحالة draft.
     *
     * @param  array  $data         ['partner_id'=>uuid, 'amount'=>int, 'direction'=>'received|paid',
     *                               'method'=>'cash|bank', 'reference'=>?, 'cash_account_id'=>?,
     *                               'invoice_id'=>?, 'purchase_id'=>?, 'payment_date'=>?, 'notes'=>?, 'number'=>?]
     * @param  array  $allocations  قبض: [['invoice_id'=>uuid,'amount'=>int], ...]
     *                              صرف: [['purchase_id'=>uuid,'amount'=>int], ...]
     */
    public function create(array $data, array $allocations = []): Payment
    {
        $amount = (int) ($data['amount'] ?? 0);
        if ($amount <= 0) {
            throw new RuntimeException('مبلغ السند يجب أن يكون موجباً.');
        }

        $direction = $data['direction'] ?? 'received';
        $date      = $data['payment_date'] ?? now()->toDateString();

        // المستند المستهدَف حسب الاتجاه: قبض→فاتورة مبيعات، صرف→فاتورة مشتريات.
        [$targetClass, $key] = $direction === 'received'
            ? [Invoice::class, 'invoice_id']
            : [Purchase::class, 'purchase_id'];

        // بناء التخصيصات: صريحة، أو ضمنياً من معرّف المستند المفرد.
        $items = ! empty($allocations)
            ? $allocations
            : (! empty($data[$key]) ? [[$key => $data[$key], 'amount' => $amount]] : []);

        $allocs = [];
        $sum = 0;
        foreach ($items as $a) {
            $amt = (int) ($a['amount'] ?? 0);
            if (empty($a[$key]) || $amt <= 0) {
                throw new RuntimeException('كل تخصيص يحتاج مستنداً ومبلغاً موجباً.');
            }
            $allocs[] = ['type' => $targetClass, 'id' => $a[$key], 'amount' => $amt];
            $sum += $amt;
        }

        if (! empty($allocs) && $sum !== $amount) {
            throw new RuntimeException("مجموع التخصيصات ({$sum}) يجب أن يساوي مبلغ السند ({$amount}).");
        }

        // الخزينة تُتحقَّق **قبل** الإنشاء: سندٌ يحمل حساباً مرفوضاً كان سيُرفض
        // عند الترحيل وحده، فيبقى في القاعدة مسوّدةً لا تُرحَّل أبداً.
        $cashAccountId = $this->validCashAccountId($data['cash_account_id'] ?? null);

        return DB::transaction(function () use ($data, $amount, $direction, $date, $allocs, $cashAccountId) {
            $payment = Payment::create([
                'number'          => $data['number'] ?? $this->nextNumber($direction, $date),
                'partner_id'      => $data['partner_id'],
                'invoice_id'      => $data['invoice_id'] ?? null, // مرجع اختياري للقبض
                'direction'       => $direction,
                'method'          => $data['method'] ?? 'cash',
                'reference'       => $data['reference'] ?? null,
                'cash_account_id' => $cashAccountId,
                'payment_date'    => $date,
                'amount'          => $amount,
                'status'          => 'draft',
                'notes'           => $data['notes'] ?? null,
                'created_by'      => $data['created_by'] ?? null,
            ]);

            foreach ($allocs as $a) {
                PaymentAllocation::create([
                    'payment_id'       => $payment->id,
                    'allocatable_type' => $a['type'],
                    'allocatable_id'   => $a['id'],
                    'amount'           => $a['amount'],
                ]);
            }

            return $payment;
        });
    }

    /**
     * ترحيل السند: توليد القيد المتوازن عبر LedgerService + تحديث سداد الفواتير.
     */
    public function post(Payment $payment): Payment
    {
        if (! $payment->isDraft()) {
            throw new RuntimeException('لا يمكن ترحيل سند غير مسوّد (draft).');
        }

        return DB::transaction(function () use ($payment) {
            // قفل الصف وإعادة فحص الحالة — يمنع الترحيل المزدوج المتزامن.
            $payment = Payment::lockForUpdate()->findOrFail($payment->id);
            if (! $payment->isDraft()) {
                throw new RuntimeException('لا يمكن ترحيل سند غير مسوّد (draft).');
            }

            $allocations = $payment->allocations()->get();

            // التحقق من كل تخصيص قبل توليد القيد (لا أثر عند الرفض).
            // المستند polymorphic: فاتورة مبيعات (قبض) أو فاتورة مشتريات (صرف).
            $targets = [];
            foreach ($allocations as $alloc) {
                $class  = $alloc->allocatable_type;
                $target = $class::lockForUpdate()->find($alloc->allocatable_id);

                if (! $target) {
                    throw new RuntimeException('المستند المخصَّص غير موجود.');
                }
                if (! $target->isPosted()) {
                    throw new RuntimeException(
                        $payment->direction === 'received'
                            ? 'لا يمكن التحصيل على فاتورة غير مرحّلة.'
                            : 'لا يمكن السداد على فاتورة مشتريات غير مرحّلة.'
                    );
                }
                if ($target->partner_id !== $payment->partner_id) {
                    throw new RuntimeException('الفاتورة المخصَّصة لا تخص طرف السند.');
                }

                $remaining = $target->total - $target->paid_amount;
                if ($alloc->amount > $remaining) {
                    throw new RuntimeException(
                        "مبلغ التخصيص ({$alloc->amount}) يتجاوز المتبقي على الفاتورة ({$remaining})."
                    );
                }

                $targets[$alloc->id] = $target;
            }

            // الخزينة المختارة تعلو على الاشتقاق من الطريقة؛ وغيابها = سلوك ما قبل الحقل.
            $cashCode      = $payment->method === 'bank' ? self::ACC_BANK : self::ACC_CASH;
            $cashAccountId = $payment->cash_account_id ?: $this->accountId($cashCode);

            if ($payment->direction === 'received') {
                // قبض من عميل: مدين الصندوق/البنك، دائن العملاء
                $lines = [[
                    'account_id' => $cashAccountId,
                    'debit'      => $payment->amount,
                ], [
                    'account_id'   => $this->accountId(self::ACC_RECEIVABLE),
                    'credit'       => $payment->amount,
                    'partner_type' => Partner::class,
                    'partner_id'   => $payment->partner_id,
                ]];
            } else {
                // صرف لمورد: مدين الموردون، دائن الصندوق/البنك
                $lines = [[
                    'account_id'   => $this->accountId(self::ACC_PAYABLE),
                    'debit'        => $payment->amount,
                    'partner_type' => Partner::class,
                    'partner_id'   => $payment->partner_id,
                ], [
                    'account_id' => $cashAccountId,
                    'credit'     => $payment->amount,
                ]];
            }

            $label = $payment->direction === 'received' ? 'سند قبض' : 'سند صرف';

            $entry = $this->ledger->post($lines, [
                'entry_date'  => $payment->payment_date->toDateString(),
                'description' => "{$label} {$payment->number}",
                'source_type' => Payment::class,
                'source_id'   => $payment->id,
                'created_by'  => $payment->created_by,
            ]);

            $payment->update([
                'status'           => 'posted',
                'journal_entry_id' => $entry->id,
            ]);

            // تطبيق التخصيصات: تحديث سداد كل مستند وحالته.
            foreach ($allocations as $alloc) {
                $target  = $targets[$alloc->id];
                $newPaid = $target->paid_amount + $alloc->amount;
                $target->update([
                    'paid_amount'    => $newPaid,
                    'payment_status' => $this->paymentStatus($newPaid, $target->total),
                ]);
            }

            return $payment->fresh();
        });
    }

    /**
     * حالة سداد الفاتورة حسب المسدَّد مقابل الإجمالي.
     */
    protected function paymentStatus(int $paid, int $total): string
    {
        if ($paid <= 0) {
            return 'unpaid';
        }

        return $paid >= $total ? 'paid' : 'partial';
    }

    /**
     * تحقّق «الخزينة» المختارة وإعادتها (أو null إن لم تُختَر).
     *
     * ثلاثة شروط لا رابع: موجودة في مستأجر السند، **فرعية لا تجميعية**
     * (قاعدة معمارية: `is_group` لا يقبل قيوداً)، ومن عائلة النقد والبنوك.
     */
    protected function validCashAccountId(?string $accountId): ?string
    {
        if (empty($accountId)) {
            return null;
        }

        $account = Account::find($accountId); // TenantScope يتكفّل بالعزل

        if (! $account) {
            throw new RuntimeException('الخزينة المختارة غير موجودة.');
        }
        if ($account->is_group) {
            throw new RuntimeException('الحساب التجميعي لا يقبل قيوداً مباشرة، فلا يصلح خزينةً.');
        }

        $inCashFamily = $account->type === 'asset' && count(array_filter(
            self::CASH_CODE_PREFIXES,
            fn (string $prefix) => str_starts_with((string) $account->code, $prefix)
        )) > 0;

        if (! $inCashFamily) {
            throw new RuntimeException('الخزينة يجب أن تكون حساب نقد أو بنك (111x/112x).');
        }

        return $account->id;
    }

    /**
     * معرّف الحساب من كوده ضمن المستأجر الحالي.
     */
    protected function accountId(string $code): string
    {
        $account = Account::where('code', $code)->first();

        if (! $account) {
            throw new RuntimeException("الحساب بالكود {$code} غير موجود في دليل الحسابات.");
        }

        return $account->id;
    }

    /**
     * توليد رقم سند تسلسلي: REC-2025-00001 (قبض) | PAY-2025-00001 (صرف)
     */
    protected function nextNumber(string $direction, string $date): string
    {
        return Payment::nextDocumentNumber($direction === 'received' ? 'REC' : 'PAY', $date);
    }
}
