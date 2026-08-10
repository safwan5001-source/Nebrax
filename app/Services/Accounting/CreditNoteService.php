<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\CreditNote;
use App\Models\CreditNoteLine;
use App\Models\Partner;
use App\Tenancy\BranchScope;
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
    private const ACC_PAYABLE    = '2110'; // الموردون — جانب الإشعار المدين
    private const ACC_INPUT_VAT  = '1150'; // ضريبة المدخلات — تُعكس مع الخصم
    private const ACC_ALLOWANCE  = '5115'; // مردودات ومسموحات المشتريات (مصروف مقابل)

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
                'number'              => $data['number'] ?? $this->nextNumber($date, $data['type'] ?? 'sales'),
                'partner_id'          => $data['partner_id'],
                'type'                => $data['type'] ?? 'sales',
                'refund_type'         => $data['refund_type'] ?? 'credit',
                'note_date'           => $date,
                'status'              => 'draft',
                'reason'              => $data['reason'] ?? null,
                'original_invoice_id'  => $data['original_invoice_id'] ?? null,
                'original_purchase_id' => $data['original_purchase_id'] ?? null,
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

            $lines = $note->isPurchase()
                ? $this->purchaseLines($note, $subtotal, $taxAmount, $total)
                : $this->salesLines($note, $subtotal, $taxAmount, $total);

            $label = $note->isPurchase() ? 'إشعار مدين' : 'إشعار دائن';

            $entry = $this->ledger->post($lines, [
                'entry_date'  => $note->note_date->toDateString(),
                'description' => "{$label} {$note->number}",
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

    /**
     * إشعار دائن (للعميل): عكس الإيراد وضريبة المخرجات مقابل الذمّة أو النقد.
     *   مدين 4110 المبيعات + مدين 2120 ضريبة المخرجات / دائن 1130 أو 1110
     */
    protected function salesLines(CreditNote $note, int $subtotal, int $taxAmount, int $total): array
    {
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

        return $lines;
    }

    /**
     * إشعار مدين (للمورّد): تخفيض ذمّة المورّد مقابل عكس الخصم وضريبة المدخلات.
     *   مدين 2110 الموردون (أو 1110 عند الاسترداد النقدي)
     *   دائن 5115 مردودات ومسموحات المشتريات + دائن 1150 ضريبة المدخلات
     *
     * **لا يُحمَّل على 1140 عمداً**: لا حركة مخزون هنا، فخصمُه من حساب المراقبة
     * كان يفصله عن دفتر المخزون المساعد (Σ كمية × متوسط تكلفة) بلا إنذار.
     * الحساب المقابل يحفظ المطابقة ويُظهر الخصم بنداً مقروءاً في قائمة الدخل.
     */
    protected function purchaseLines(CreditNote $note, int $subtotal, int $taxAmount, int $total): array
    {
        $debitLine = [
            'account_id' => $this->accountId($note->refund_type === 'cash' ? self::ACC_CASH : self::ACC_PAYABLE),
            'debit'      => $total,
        ];
        if ($note->refund_type === 'credit') {
            $debitLine['partner_type'] = Partner::class;
            $debitLine['partner_id']   = $note->partner_id;
        }

        $lines = [$debitLine, ['account_id' => $this->accountId(self::ACC_ALLOWANCE), 'credit' => $subtotal]];

        if ($taxAmount > 0) {
            $lines[] = ['account_id' => $this->accountId(self::ACC_INPUT_VAT), 'credit' => $taxAmount];
        }

        return $lines;
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
    /**
     * تسلسل مستقلّ لكل نوع: CN للإشعار الدائن، DN للمدين.
     * يُحسب **خارج عزل الفرع** لأن القيد الفريد `(tenant_id, number)` على
     * مستوى المستأجر — ولولا ذلك لبدأ كل فرع من ١ فاصطدمت الأرقام.
     */
    protected function nextNumber(string $date, string $type = 'sales'): string
    {
        $year   = substr($date, 0, 4);
        $prefix = $type === 'purchase' ? 'DN' : 'CN';
        $count  = CreditNote::withoutGlobalScope(BranchScope::class)
            ->where('type', $type)->whereYear('note_date', $year)->count() + 1;

        return sprintf('%s-%s-%05d', $prefix, $year, $count);
    }
}
