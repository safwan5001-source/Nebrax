<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\Expense;
use App\Models\Partner;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  ExpenseService — المصروفات (مستند مالي صرف، بلا مخزون)
 * ═══════════════════════════════════════════════════════════════
 *  - create(): ينشئ مصروفاً draft ويشتقّ الضريبة والإجمالي من المبلغ.
 *  - post():   يرحّل المصروف ويولّد قيداً متوازناً عبر LedgerService.
 *
 *  مصروف إيجار 1000 + 15% ضريبة، مدفوع نقداً:
 *    مدين  5130 الإيجار            100000
 *    مدين  1150 ضريبة المدخلات      15000
 *    دائن  1110 الصندوق            115000
 *  (طريقة الدفع تحدّد الحساب الدائن: نقد 1110 / بنك 1120 / آجل 2110 الموردون)
 *
 *  لا كتابة مباشرة في journal_lines — المرور إجباري عبر المحرك.
 */
class ExpenseService
{
    private const ACC_CASH      = '1110';
    private const ACC_BANK      = '1120';
    private const ACC_PAYABLE   = '2110';
    private const ACC_INPUT_VAT = '1150';

    public function __construct(protected LedgerService $ledger) {}

    /**
     * @param  array  $data  ['account_id'=>uuid, 'amount'=>int(هللات), 'tax_rate'=>?int,
     *                         'payment_method'=>'cash|bank|credit', 'partner_id'=>?uuid,
     *                         'expense_date'=>?, 'description'=>?, 'number'=>?, 'created_by'=>?]
     */
    public function create(array $data): Expense
    {
        $amount = (int) ($data['amount'] ?? 0);
        if ($amount <= 0) {
            throw new RuntimeException('مبلغ المصروف يجب أن يكون موجباً.');
        }

        $this->assertExpenseAccount($data['account_id']);

        return DB::transaction(function () use ($data, $amount) {
            $date = $data['expense_date'] ?? now()->toDateString();
            $rate = (int) ($data['tax_rate'] ?? 15);
            $tax  = $this->calcTax($amount, $rate);

            return Expense::create([
                'number'         => $data['number'] ?? $this->nextNumber($date),
                'account_id'     => $data['account_id'],
                'partner_id'     => $data['partner_id'] ?? null,
                'cost_center_id' => $data['cost_center_id'] ?? null,
                'expense_date'   => $date,
                'payment_method' => $data['payment_method'] ?? 'cash',
                'description'    => $data['description'] ?? null,
                'amount'         => $amount,
                'tax_rate'       => $rate,
                'tax_amount'     => $tax,
                'total'          => $amount + $tax,
                'status'         => 'draft',
                'created_by'     => $data['created_by'] ?? null,
            ]);
        });
    }

    /**
     * ترحيل المصروف: توليد القيد المتوازن عبر LedgerService.
     */
    public function post(Expense $expense): Expense
    {
        if (! $expense->isDraft()) {
            throw new RuntimeException('لا يمكن ترحيل مصروف غير مسوّد (draft).');
        }

        return DB::transaction(function () use ($expense) {
            // إعادة اشتقاق الضريبة والإجمالي من المبلغ (مصدر الحقيقة) قبل توليد القيد.
            $amount = (int) $expense->amount;
            $tax    = $this->calcTax($amount, (int) $expense->tax_rate);
            $total  = $amount + $tax;

            // مدين حساب المصروف (موسوماً بمركز التكلفة) + مدين ضريبة المدخلات / دائن نقد أو بنك أو موردون
            $lines = [['account_id' => $expense->account_id, 'debit' => $amount, 'cost_center_id' => $expense->cost_center_id]];
            if ($tax > 0) {
                $lines[] = ['account_id' => $this->accountId(self::ACC_INPUT_VAT), 'debit' => $tax];
            }

            $creditLine = ['account_id' => $this->accountId($this->creditCode($expense->payment_method)), 'credit' => $total];
            if ($expense->payment_method === 'credit' && $expense->partner_id) {
                $creditLine['partner_type'] = Partner::class;
                $creditLine['partner_id']   = $expense->partner_id;
            }
            $lines[] = $creditLine;

            $entry = $this->ledger->post($lines, [
                'entry_date'  => $expense->expense_date->toDateString(),
                'description' => "مصروف {$expense->number}",
                'source_type' => Expense::class,
                'source_id'   => $expense->id,
                'created_by'  => $expense->created_by,
            ]);

            $expense->update([
                'status'           => 'posted',
                'tax_amount'       => $tax,
                'total'            => $total,
                'journal_entry_id' => $entry->id,
            ]);

            return $expense->fresh('account');
        });
    }

    /** الحساب الدائن وفق طريقة الدفع. */
    private function creditCode(string $method): string
    {
        return match ($method) {
            'bank'   => self::ACC_BANK,
            'credit' => self::ACC_PAYABLE,
            default  => self::ACC_CASH,
        };
    }

    /** التأكد أن الحساب المختار حساب مصروف فعلي يقبل القيود. */
    protected function assertExpenseAccount(string $accountId): void
    {
        $account = Account::find($accountId);
        if (! $account) {
            throw new RuntimeException('حساب المصروف غير موجود في دليل الحسابات.');
        }
        if ($account->type !== 'expense') {
            throw new RuntimeException('الحساب المختار ليس حساب مصروفات.');
        }
        if ($account->is_group) {
            throw new RuntimeException('لا يمكن تسجيل مصروف على حساب تجميعي.');
        }
    }

    /** حساب الضريبة كعدد صحيح (تقريب نصفي لأعلى) — بلا float. */
    protected function calcTax(int $base, int $rate): int
    {
        return intdiv($base * $rate + 50, 100);
    }

    protected function accountId(string $code): string
    {
        $account = Account::where('code', $code)->first();
        if (! $account) {
            throw new RuntimeException("الحساب بالكود {$code} غير موجود في دليل الحسابات.");
        }

        return $account->id;
    }

    /** توليد رقم تسلسلي: EXP-2025-00001 */
    protected function nextNumber(string $date): string
    {
        $year  = substr($date, 0, 4);
        $count = Expense::whereYear('expense_date', $year)->count() + 1;

        return sprintf('EXP-%s-%05d', $year, $count);
    }
}
