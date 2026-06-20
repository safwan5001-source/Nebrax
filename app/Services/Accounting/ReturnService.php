<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\Partner;
use App\Models\ReturnDocument;
use App\Models\ReturnLine;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  ReturnService — مرتجعات المبيعات والمشتريات
 * ═══════════════════════════════════════════════════════════════
 *  - create(): ينشئ مرتجعاً draft ويحسب الإجماليات من السطور.
 *  - post():   يرحّل المرتجع ويولّد قيداً عكسياً عبر LedgerService،
 *              ويعالج المخزون.
 *
 *  مرتجع مبيعات (sales) — عكس البيع:
 *    مدين 4110 المبيعات + مدين 2120 ضريبة المخرجات │ دائن 1130/1110 (الإجمالي)
 *    وللبضاعة المتابَعة: قيد عكس التكلفة (مدين 1140 / دائن 5110) + إرجاع للمخزون.
 *
 *  مرتجع مشتريات (purchase) — عكس الشراء:
 *    مدين 2110/1110 (الإجمالي) │ دائن 1140 المخزون + دائن 5150 + دائن 1150 ضريبة المدخلات
 *    وللبضاعة المتابَعة: إخراج من المخزون.
 *
 *  لا كتابة مباشرة في journal_lines — القيد عبر المحرك حصراً.
 */
class ReturnService
{
    private const ACC_CASH        = '1110';
    private const ACC_RECEIVABLE  = '1130';
    private const ACC_INVENTORY   = '1140';
    private const ACC_INPUT_VAT   = '1150';
    private const ACC_PAYABLE     = '2110';
    private const ACC_OUTPUT_VAT  = '2120';
    private const ACC_SALES       = '4110';
    private const ACC_COGS        = '5110';
    private const ACC_EXPENSE     = '5150';

    public function __construct(
        protected LedgerService $ledger,
        protected InventoryService $inventory
    ) {}

    /**
     * إنشاء مرتجع بحالة draft مع حساب الإجماليات من السطور.
     *
     * @param  array  $data   ['type'=>'sales|purchase', 'partner_id'=>uuid, 'payment_type'=>'credit|cash',
     *                         'return_date'=>?, 'notes'=>?, 'number'=>?, 'original_type'=>?, 'original_id'=>?]
     * @param  array  $items  [['product_id'=>?, 'description'=>?, 'quantity'=>int, 'unit_price'=>int, 'tax_rate'=>?int], ...]
     */
    public function create(array $data, array $items): ReturnDocument
    {
        $type = $data['type'] ?? null;
        if (! in_array($type, ['sales', 'purchase'], true)) {
            throw new RuntimeException("نوع المرتجع يجب أن يكون 'sales' أو 'purchase'.");
        }
        if (empty($items)) {
            throw new RuntimeException('المرتجع يجب أن يحتوي على سطر واحد على الأقل.');
        }

        return DB::transaction(function () use ($data, $items, $type) {
            $date = $data['return_date'] ?? now()->toDateString();

            $return = ReturnDocument::create([
                'number'        => $data['number'] ?? $this->nextNumber($type, $date),
                'type'          => $type,
                'partner_id'    => $data['partner_id'],
                'payment_type'  => $data['payment_type'] ?? 'credit',
                'return_date'   => $date,
                'status'        => 'draft',
                'notes'         => $data['notes'] ?? null,
                'original_type' => $data['original_type'] ?? null,
                'original_id'   => $data['original_id'] ?? null,
                'created_by'    => $data['created_by'] ?? null,
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

                ReturnLine::create([
                    'return_id'     => $return->id,
                    'product_id'    => $item['product_id'] ?? null,
                    'description'   => $item['description'] ?? null,
                    'quantity'      => $qty,
                    'unit_price'    => $unitPrice,
                    'tax_rate'      => $rate,
                    'line_subtotal' => $lineSubtotal,
                    'line_tax'      => $lineTax,
                    'line_total'    => $lineSubtotal + $lineTax,
                ]);

                $subtotal += $lineSubtotal;
                $taxTotal += $lineTax;
            }

            $return->update([
                'subtotal'   => $subtotal,
                'tax_amount' => $taxTotal,
                'total'      => $subtotal + $taxTotal,
            ]);

            return $return->load('lines');
        });
    }

    /**
     * ترحيل المرتجع: توليد القيد العكسي ومعالجة المخزون.
     */
    public function post(ReturnDocument $return): ReturnDocument
    {
        if (! $return->isDraft()) {
            throw new RuntimeException('لا يمكن ترحيل مرتجع غير مسوّد (draft).');
        }

        return DB::transaction(function () use ($return) {
            return $return->isSales()
                ? $this->postSalesReturn($return)
                : $this->postPurchaseReturn($return);
        });
    }

    /**
     * مرتجع مبيعات: عكس الإيراد والضريبة، وإرجاع البضاعة للمخزون بقيد عكس التكلفة.
     */
    protected function postSalesReturn(ReturnDocument $return): ReturnDocument
    {
        $return->loadMissing('lines.product');

        $subtotal = (int) $return->lines->sum('line_subtotal');
        $taxAmount = (int) $return->lines->sum('line_tax');
        $total = $subtotal + $taxAmount;

        // قيد عكس البيع: مدين 4110 + مدين 2120 / دائن 1130 أو 1110
        $lines = [['account_id' => $this->accountId(self::ACC_SALES), 'debit' => $subtotal]];
        if ($taxAmount > 0) {
            $lines[] = ['account_id' => $this->accountId(self::ACC_OUTPUT_VAT), 'debit' => $taxAmount];
        }
        $creditLine = [
            'account_id' => $this->accountId($return->payment_type === 'cash' ? self::ACC_CASH : self::ACC_RECEIVABLE),
            'credit'     => $total,
        ];
        if ($return->payment_type === 'credit') {
            $creditLine['partner_type'] = Partner::class;
            $creditLine['partner_id']   = $return->partner_id;
        }
        $lines[] = $creditLine;

        $entry = $this->ledger->post($lines, [
            'entry_date'  => $return->return_date->toDateString(),
            'description' => "مرتجع مبيعات {$return->number}",
            'source_type' => ReturnDocument::class,
            'source_id'   => $return->id,
            'created_by'  => $return->created_by,
        ]);

        // إرجاع البضاعة المتابَعة للمخزون + قيد عكس التكلفة (مدين 1140 / دائن 5110)
        $cogsTotal = 0;
        foreach ($return->lines as $line) {
            $product = $line->product;
            if ($product && $product->track_inventory && $line->quantity > 0) {
                $unitCost = $product->avg_cost;
                $this->inventory->applyReceipt($product, $line->quantity, $unitCost, [
                    'source_type' => ReturnDocument::class,
                    'source_id'   => $return->id,
                    'date'        => $return->return_date->toDateString(),
                    'notes'       => "إرجاع عبر المرتجع {$return->number}",
                ]);
                $cogsTotal += $line->quantity * $unitCost;
            }
        }

        $cogsEntryId = null;
        if ($cogsTotal > 0) {
            $cogsEntry = $this->ledger->post([
                ['account_id' => $this->accountId(self::ACC_INVENTORY), 'debit' => $cogsTotal],
                ['account_id' => $this->accountId(self::ACC_COGS), 'credit' => $cogsTotal],
            ], [
                'entry_date'  => $return->return_date->toDateString(),
                'description' => "عكس تكلفة مرتجع {$return->number}",
                'source_type' => ReturnDocument::class,
                'source_id'   => $return->id,
            ]);
            $cogsEntryId = $cogsEntry->id;
        }

        $return->update([
            'status'           => 'posted',
            'subtotal'         => $subtotal,
            'tax_amount'       => $taxAmount,
            'total'            => $total,
            'journal_entry_id' => $entry->id,
            'cogs_entry_id'    => $cogsEntryId,
        ]);

        return $return->fresh('lines');
    }

    /**
     * مرتجع مشتريات: عكس المخزون وضريبة المدخلات والذمم الدائنة، وإخراج البضاعة.
     */
    protected function postPurchaseReturn(ReturnDocument $return): ReturnDocument
    {
        $return->loadMissing('lines.product');

        $inventoryTotal = 0;
        $expenseTotal   = 0;
        $taxTotal       = 0;

        foreach ($return->lines as $line) {
            $taxTotal += $line->line_tax;
            $product = $line->product;
            if ($product && $product->track_inventory) {
                $inventoryTotal += $line->line_subtotal;
            } else {
                $expenseTotal += $line->line_subtotal;
            }
        }

        $subtotal = $inventoryTotal + $expenseTotal;
        $total    = $subtotal + $taxTotal;

        // قيد عكس الشراء: مدين 2110/1110 / دائن 1140 + دائن 5150 + دائن 1150
        $debitLine = [
            'account_id' => $this->accountId($return->payment_type === 'cash' ? self::ACC_CASH : self::ACC_PAYABLE),
            'debit'      => $total,
        ];
        if ($return->payment_type === 'credit') {
            $debitLine['partner_type'] = Partner::class;
            $debitLine['partner_id']   = $return->partner_id;
        }
        $lines = [$debitLine];

        if ($inventoryTotal > 0) {
            $lines[] = ['account_id' => $this->accountId(self::ACC_INVENTORY), 'credit' => $inventoryTotal];
        }
        if ($expenseTotal > 0) {
            $lines[] = ['account_id' => $this->accountId(self::ACC_EXPENSE), 'credit' => $expenseTotal];
        }
        if ($taxTotal > 0) {
            $lines[] = ['account_id' => $this->accountId(self::ACC_INPUT_VAT), 'credit' => $taxTotal];
        }

        $entry = $this->ledger->post($lines, [
            'entry_date'  => $return->return_date->toDateString(),
            'description' => "مرتجع مشتريات {$return->number}",
            'source_type' => ReturnDocument::class,
            'source_id'   => $return->id,
            'created_by'  => $return->created_by,
        ]);

        // إخراج البضاعة المتابَعة من المخزون (بسعر الشراء — القيد أعلاه)
        foreach ($return->lines as $line) {
            $product = $line->product;
            if ($product && $product->track_inventory && $line->quantity > 0) {
                $this->inventory->applyIssue($product, $line->quantity, $line->unit_price, [
                    'source_type' => ReturnDocument::class,
                    'source_id'   => $return->id,
                    'date'        => $return->return_date->toDateString(),
                    'notes'       => "إرجاع للمورد عبر المرتجع {$return->number}",
                ]);
            }
        }

        $return->update([
            'status'           => 'posted',
            'subtotal'         => $subtotal,
            'tax_amount'       => $taxTotal,
            'total'            => $total,
            'journal_entry_id' => $entry->id,
        ]);

        return $return->fresh('lines');
    }

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

    /**
     * توليد رقم مرتجع تسلسلي: SRET-2025-00001 (مبيعات) | PRET-2025-00001 (مشتريات)
     */
    protected function nextNumber(string $type, string $date): string
    {
        $prefix = $type === 'sales' ? 'SRET' : 'PRET';
        $year   = substr($date, 0, 4);
        $count  = ReturnDocument::where('type', $type)
            ->whereYear('return_date', $year)
            ->count() + 1;

        return sprintf('%s-%s-%05d', $prefix, $year, $count);
    }
}
