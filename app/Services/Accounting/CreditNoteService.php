<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\CreditNote;
use App\Models\CreditNoteLine;
use App\Models\Partner;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  CreditNoteService — الإشعارات الدائنة (مستند مالي للعميل)
 * ═══════════════════════════════════════════════════════════════
 *  - create(): ينشئ إشعاراً draft ويحسب الإجماليات من السطور.
 *  - post():   يرحّل الإشعار ويولّد قيداً عكسياً متوازناً عبر LedgerService.
 *
 *  إشعار دائن (آجل) بقيمة 1000 + 15%:
 *    مدين  4110 إيرادات المبيعات   100000
 *    مدين  2120 ضريبة المخرجات      15000
 *    دائن  1130 العملاء            115000
 *  (للاسترداد النقدي يُستبدل 1130 بـ 1110 الصندوق)
 *
 *  مالي صرف — لا حركة مخزون. لا كتابة مباشرة في journal_lines.
 */
class CreditNoteService
{
    private const ACC_CASH       = '1110';
    private const ACC_RECEIVABLE = '1130';
    private const ACC_OUTPUT_VAT = '2120';
    private const ACC_SALES      = '4110';

    public function __construct(protected LedgerService $ledger) {}

    /**
     * @param  array  $data   ['partner_id'=>uuid, 'refund_type'=>'credit|cash', 'note_date'=>?, 'reason'=>?, 'original_invoice_id'=>?, 'number'=>?]
     * @param  array  $items  [['product_id'=>?, 'description'=>?, 'quantity'=>int, 'unit_price'=>int, 'tax_rate'=>?int], ...]
     */
    public function create(array $data, array $items): CreditNote
    {
        if (empty($items)) {
            throw new RuntimeException('الإشعار الدائن يجب أن يحتوي على سطر واحد على الأقل.');
        }

        return DB::transaction(function () use ($data, $items) {
            $date = $data['note_date'] ?? now()->toDateString();

            $note = CreditNote::create([
                'number'              => $data['number'] ?? $this->nextNumber($date),
                'partner_id'          => $data['partner_id'],
                'refund_type'         => $data['refund_type'] ?? 'credit',
                'note_date'           => $date,
                'status'              => 'draft',
                'reason'              => $data['reason'] ?? null,
                'original_invoice_id' => $data['original_invoice_id'] ?? null,
                'created_by'          => $data['created_by'] ?? null,
            ]);

            $subtotal = $taxTotal = 0;

            foreach ($items as $item) {
                $qty       = (int) ($item['quantity'] ?? 1);
                $unitPrice = (int) ($item['unit_price'] ?? 0);
                $rate      = (int) ($item['tax_rate'] ?? 15);

                if ($qty <= 0 || $unitPrice < 0) {
                    throw new RuntimeException('الكمية يجب أن تكون موجبة والسعر غير سالب.');
                }

                $lineSubtotal = $qty * $unitPrice;
                $lineTax      = $this->calcTax($lineSubtotal, $rate);

                CreditNoteLine::create([
                    'credit_note_id' => $note->id,
                    'product_id'     => $item['product_id'] ?? null,
                    'description'    => $item['description'] ?? null,
                    'quantity'       => $qty,
                    'unit_price'     => $unitPrice,
                    'tax_rate'       => $rate,
                    'line_subtotal'  => $lineSubtotal,
                    'line_tax'       => $lineTax,
                    'line_total'     => $lineSubtotal + $lineTax,
                ]);

                $subtotal += $lineSubtotal;
                $taxTotal += $lineTax;
            }

            $note->update([
                'subtotal'   => $subtotal,
                'tax_amount' => $taxTotal,
                'total'      => $subtotal + $taxTotal,
            ]);

            return $note->load('lines');
        });
    }

    /**
     * ترحيل الإشعار: توليد القيد العكسي المتوازن عبر LedgerService.
     */
    public function post(CreditNote $note): CreditNote
    {
        if (! $note->isDraft()) {
            throw new RuntimeException('لا يمكن ترحيل إشعار غير مسوّد (draft).');
        }

        return DB::transaction(function () use ($note) {
            // إعادة احتساب الإجماليات من السطور (مصدر الحقيقة) قبل توليد القيد.
            $note->loadMissing('lines');
            $subtotal  = (int) $note->lines->sum('line_subtotal');
            $taxAmount = (int) $note->lines->sum('line_tax');
            $total     = $subtotal + $taxAmount;

            // مدين 4110 المبيعات + مدين 2120 الضريبة / دائن 1130 أو 1110
            $lines = [['account_id' => $this->accountId(self::ACC_SALES), 'debit' => $subtotal]];
            if ($taxAmount > 0) {
                $lines[] = ['account_id' => $this->accountId(self::ACC_OUTPUT_VAT), 'debit' => $taxAmount];
            }
            $creditLine = [
                'account_id' => $this->accountId($note->refund_type === 'cash' ? self::ACC_CASH : self::ACC_RECEIVABLE),
                'credit'     => $total,
            ];
            if ($note->refund_type === 'credit') {
                $creditLine['partner_type'] = Partner::class;
                $creditLine['partner_id']   = $note->partner_id;
            }
            $lines[] = $creditLine;

            $entry = $this->ledger->post($lines, [
                'entry_date'  => $note->note_date->toDateString(),
                'description' => "إشعار دائن {$note->number}",
                'source_type' => CreditNote::class,
                'source_id'   => $note->id,
                'created_by'  => $note->created_by,
            ]);

            $note->update([
                'status'           => 'posted',
                'subtotal'         => $subtotal,
                'tax_amount'       => $taxAmount,
                'total'            => $total,
                'journal_entry_id' => $entry->id,
            ]);

            return $note->fresh('lines');
        });
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

    /** توليد رقم تسلسلي: CN-2025-00001 */
    protected function nextNumber(string $date): string
    {
        $year  = substr($date, 0, 4);
        $count = CreditNote::whereYear('note_date', $year)->count() + 1;

        return sprintf('CN-%s-%05d', $year, $count);
    }
}
