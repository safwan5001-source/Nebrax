<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\Invoice;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\PaymentAllocation;
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

    public function __construct(
        protected LedgerService $ledger
    ) {}

    /**
     * إنشاء سند قبض/صرف بحالة draft.
     *
     * @param  array  $data         ['partner_id'=>uuid, 'amount'=>int, 'direction'=>'received|paid',
     *                               'method'=>'cash|bank', 'invoice_id'=>?, 'payment_date'=>?, 'notes'=>?, 'number'=>?]
     * @param  array  $allocations  [['invoice_id'=>uuid, 'amount'=>int], ...] — للقبض على عدة فواتير
     */
    public function create(array $data, array $allocations = []): Payment
    {
        $amount = (int) ($data['amount'] ?? 0);
        if ($amount <= 0) {
            throw new RuntimeException('مبلغ السند يجب أن يكون موجباً.');
        }

        $direction = $data['direction'] ?? 'received';
        $date      = $data['payment_date'] ?? now()->toDateString();

        // التخصيص للقبض فقط: صريح، أو ضمنياً من invoice_id.
        $allocs = [];
        if ($direction === 'received') {
            if (! empty($allocations)) {
                $allocs = $allocations;
            } elseif (! empty($data['invoice_id'])) {
                $allocs = [['invoice_id' => $data['invoice_id'], 'amount' => $amount]];
            }
        }

        if (! empty($allocs)) {
            $sum = 0;
            foreach ($allocs as $a) {
                $amt = (int) ($a['amount'] ?? 0);
                if (empty($a['invoice_id']) || $amt <= 0) {
                    throw new RuntimeException('كل تخصيص يحتاج فاتورة ومبلغاً موجباً.');
                }
                $sum += $amt;
            }
            if ($sum !== $amount) {
                throw new RuntimeException("مجموع التخصيصات ({$sum}) يجب أن يساوي مبلغ السند ({$amount}).");
            }
        }

        return DB::transaction(function () use ($data, $amount, $direction, $date, $allocs) {
            $payment = Payment::create([
                'number'       => $data['number'] ?? $this->nextNumber($direction, $date),
                'partner_id'   => $data['partner_id'],
                'invoice_id'   => count($allocs) === 1 ? $allocs[0]['invoice_id'] : null,
                'direction'    => $direction,
                'method'       => $data['method'] ?? 'cash',
                'payment_date' => $date,
                'amount'       => $amount,
                'status'       => 'draft',
                'notes'        => $data['notes'] ?? null,
                'created_by'   => $data['created_by'] ?? null,
            ]);

            foreach ($allocs as $a) {
                PaymentAllocation::create([
                    'payment_id' => $payment->id,
                    'invoice_id' => $a['invoice_id'],
                    'amount'     => (int) $a['amount'],
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
            $allocations = $payment->allocations()->get();

            // التحقق من كل تخصيص قبل توليد القيد (لا أثر عند الرفض).
            $invoices = [];
            foreach ($allocations as $alloc) {
                $invoice = Invoice::lockForUpdate()->find($alloc->invoice_id);

                if (! $invoice) {
                    throw new RuntimeException('الفاتورة المخصَّصة غير موجودة.');
                }
                if (! $invoice->isPosted()) {
                    throw new RuntimeException('لا يمكن التحصيل على فاتورة غير مرحّلة.');
                }
                if ($invoice->partner_id !== $payment->partner_id) {
                    throw new RuntimeException('الفاتورة المخصَّصة لا تخص طرف السند.');
                }

                $remaining = $invoice->total - $invoice->paid_amount;
                if ($alloc->amount > $remaining) {
                    throw new RuntimeException(
                        "مبلغ التخصيص ({$alloc->amount}) يتجاوز المتبقي على الفاتورة ({$remaining})."
                    );
                }

                $invoices[$alloc->id] = $invoice;
            }

            $cashCode = $payment->method === 'bank' ? self::ACC_BANK : self::ACC_CASH;

            if ($payment->direction === 'received') {
                // قبض من عميل: مدين الصندوق/البنك، دائن العملاء
                $lines = [[
                    'account_id' => $this->accountId($cashCode),
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
                    'account_id' => $this->accountId($cashCode),
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

            // تطبيق التخصيصات: تحديث سداد كل فاتورة وحالتها.
            foreach ($allocations as $alloc) {
                $invoice = $invoices[$alloc->id];
                $newPaid = $invoice->paid_amount + $alloc->amount;
                $invoice->update([
                    'paid_amount'    => $newPaid,
                    'payment_status' => $this->paymentStatus($newPaid, $invoice->total),
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
        $prefix = $direction === 'received' ? 'REC' : 'PAY';
        $year   = substr($date, 0, 4);
        $count  = Payment::where('direction', $direction)
            ->whereYear('payment_date', $year)
            ->count() + 1;

        return sprintf('%s-%s-%05d', $prefix, $year, $count);
    }
}
