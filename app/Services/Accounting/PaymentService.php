<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\Partner;
use App\Models\Payment;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  PaymentService — سندات القبض والصرف
 * ═══════════════════════════════════════════════════════════════
 *  - create(): ينشئ سنداً بحالة draft.
 *  - post():   يرحّل السند ويولّد قيداً متوازناً عبر LedgerService.
 *
 *  قبض من عميل (received):  مدين 1110/1120 الصندوق/البنك │ دائن 1130 العملاء
 *  صرف لمورد  (paid):       مدين 2110 الموردون           │ دائن 1110/1120
 *
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
     * @param  array  $data  ['partner_id'=>uuid, 'amount'=>int, 'direction'=>'received|paid',
     *                         'method'=>'cash|bank', 'invoice_id'=>?, 'payment_date'=>?, 'notes'=>?, 'number'=>?]
     */
    public function create(array $data): Payment
    {
        $amount = (int) ($data['amount'] ?? 0);
        if ($amount <= 0) {
            throw new RuntimeException('مبلغ السند يجب أن يكون موجباً.');
        }

        $direction = $data['direction'] ?? 'received';
        $date      = $data['payment_date'] ?? now()->toDateString();

        return Payment::create([
            'number'       => $data['number'] ?? $this->nextNumber($direction, $date),
            'partner_id'   => $data['partner_id'],
            'invoice_id'   => $data['invoice_id'] ?? null,
            'direction'    => $direction,
            'method'       => $data['method'] ?? 'cash',
            'payment_date' => $date,
            'amount'       => $amount,
            'status'       => 'draft',
            'notes'        => $data['notes'] ?? null,
            'created_by'   => $data['created_by'] ?? null,
        ]);
    }

    /**
     * ترحيل السند: توليد القيد المتوازن عبر LedgerService.
     */
    public function post(Payment $payment): Payment
    {
        if (! $payment->isDraft()) {
            throw new RuntimeException('لا يمكن ترحيل سند غير مسوّد (draft).');
        }

        return DB::transaction(function () use ($payment) {
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

            return $payment->fresh();
        });
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
