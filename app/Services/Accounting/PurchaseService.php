<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\Partner;
use App\Models\Purchase;
use App\Models\PurchaseLine;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  PurchaseService — وحدة فواتير المشتريات
 * ═══════════════════════════════════════════════════════════════
 *  - create(): ينشئ فاتورة مشتريات draft ويحسب الإجماليات من السطور.
 *  - post():   يرحّل الفاتورة، يولّد قيداً متوازناً عبر LedgerService،
 *              ويُدخِل البضاعة للمخزون بالتكلفة (متوسط متحرك) دون ازدواج القيد.
 *
 *  فاتورة مشتريات آجلة:
 *    مدين  1140 المخزون        (تكلفة البضاعة المتابَعة)
 *    مدين  5150 مصروفات عامة    (تكلفة البنود غير المتابَعة، إن وُجدت)
 *    مدين  1150 ضريبة المدخلات
 *    دائن  2110 الموردون        (الإجمالي، مربوط بالمورد)
 *  (نقدي: يُستبدل 2110 بـ 1110 الصندوق)
 *
 *  لا كتابة مباشرة في journal_lines — القيد عبر المحرك حصراً.
 */
class PurchaseService
{
    private const ACC_INVENTORY  = '1140'; // المخزون
    private const ACC_INPUT_VAT  = '1150'; // ضريبة المدخلات
    private const ACC_EXPENSE    = '5150'; // مصروفات عامة (بنود غير مخزنية)
    private const ACC_PAYABLE    = '2110'; // الموردون
    private const ACC_CASH       = '1110'; // الصندوق

    public function __construct(
        protected LedgerService $ledger,
        protected InventoryService $inventory
    ) {}

    /**
     * إنشاء فاتورة مشتريات بحالة draft مع حساب الإجماليات من السطور.
     *
     * @param  array  $data   ['partner_id'=>uuid, 'payment_type'=>'cash|credit', 'purchase_date'=>?,
     *                         'due_date'=>?, 'supplier_invoice_no'=>?, 'notes'=>?, 'number'=>?]
     * @param  array  $items  [['product_id'=>?, 'description'=>?, 'quantity'=>int, 'unit_price'=>int, 'tax_rate'=>?int], ...]
     */
    public function create(array $data, array $items): Purchase
    {
        if (empty($items)) {
            throw new RuntimeException('فاتورة المشتريات يجب أن تحتوي على سطر واحد على الأقل.');
        }

        return DB::transaction(function () use ($data, $items) {
            $date = $data['purchase_date'] ?? now()->toDateString();

            $purchase = Purchase::create([
                'number'              => $data['number'] ?? $this->nextNumber($date),
                'partner_id'          => $data['partner_id'],
                'payment_type'        => $data['payment_type'] ?? 'credit',
                'purchase_date'       => $date,
                'due_date'            => $data['due_date'] ?? null,
                'supplier_invoice_no' => $data['supplier_invoice_no'] ?? null,
                'status'              => 'draft',
                'notes'               => $data['notes'] ?? null,
                'created_by'          => $data['created_by'] ?? null,
            ]);

            $subtotal = $taxTotal = 0;

            foreach ($items as $item) {
                $qty       = (int) ($item['quantity'] ?? 1);
                $unitPrice = (int) ($item['unit_price'] ?? 0);
                $rate      = (int) ($item['tax_rate'] ?? 15);

                if ($qty <= 0 || $unitPrice < 0) {
                    throw new RuntimeException('الكمية يجب أن تكون موجبة والتكلفة غير سالبة.');
                }

                $lineSubtotal = $qty * $unitPrice;
                $lineTax      = $this->calcTax($lineSubtotal, $rate);

                PurchaseLine::create([
                    'purchase_id'   => $purchase->id,
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

            $purchase->update([
                'subtotal'   => $subtotal,
                'tax_amount' => $taxTotal,
                'total'      => $subtotal + $taxTotal,
            ]);

            return $purchase->load('lines');
        });
    }

    /**
     * ترحيل فاتورة المشتريات: توليد القيد المتوازن + إدخال البضاعة للمخزون.
     */
    public function post(Purchase $purchase): Purchase
    {
        if (! $purchase->isDraft()) {
            throw new RuntimeException('لا يمكن ترحيل فاتورة مشتريات غير مسوّدة (draft).');
        }

        return DB::transaction(function () use ($purchase) {
            // الإجماليات مشتقة من السطور (مصدر الحقيقة) قبل توليد القيد.
            $purchase->loadMissing('lines.product');

            $inventoryTotal = 0; // تكلفة البنود المخزنية (تذهب إلى 1140)
            $expenseTotal   = 0; // تكلفة البنود غير المخزنية (تذهب إلى 5150)
            $taxTotal       = 0;

            foreach ($purchase->lines as $line) {
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

            // بناء سطور القيد (الجانب المدين)
            $lines = [];
            if ($inventoryTotal > 0) {
                $lines[] = ['account_id' => $this->accountId(self::ACC_INVENTORY), 'debit' => $inventoryTotal];
            }
            if ($expenseTotal > 0) {
                $lines[] = ['account_id' => $this->accountId(self::ACC_EXPENSE), 'debit' => $expenseTotal];
            }
            if ($taxTotal > 0) {
                $lines[] = ['account_id' => $this->accountId(self::ACC_INPUT_VAT), 'debit' => $taxTotal];
            }

            // الجانب الدائن: الموردون (آجل) أو الصندوق (نقدي)
            $creditLine = [
                'account_id' => $this->accountId(
                    $purchase->payment_type === 'cash' ? self::ACC_CASH : self::ACC_PAYABLE
                ),
                'credit' => $total,
            ];
            if ($purchase->payment_type === 'credit') {
                $creditLine['partner_type'] = Partner::class;
                $creditLine['partner_id']   = $purchase->partner_id;
            }
            $lines[] = $creditLine;

            $entry = $this->ledger->post($lines, [
                'entry_date'  => $purchase->purchase_date->toDateString(),
                'description' => "فاتورة مشتريات {$purchase->number}",
                'source_type' => Purchase::class,
                'source_id'   => $purchase->id,
                'created_by'  => $purchase->created_by,
            ]);

            // إدخال البضاعة للمخزون (تحديث الكمية والمتوسط فقط — القيد أعلاه)
            foreach ($purchase->lines as $line) {
                $product = $line->product;
                if ($product && $product->track_inventory && $line->quantity > 0) {
                    $this->inventory->applyReceipt($product, $line->quantity, $line->unit_price, [
                        'source_type' => Purchase::class,
                        'source_id'   => $purchase->id,
                        'date'        => $purchase->purchase_date->toDateString(),
                        'notes'       => "شراء عبر الفاتورة {$purchase->number}",
                    ]);
                }
            }

            $purchase->update([
                'status'           => 'posted',
                'subtotal'         => $subtotal,
                'tax_amount'       => $taxTotal,
                'total'            => $total,
                'journal_entry_id' => $entry->id,
            ]);

            return $purchase->fresh('lines');
        });
    }

    /**
     * حساب الضريبة كعدد صحيح (تقريب نصفي لأعلى) — بلا float.
     */
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
     * توليد رقم فاتورة مشتريات تسلسلي: BILL-2025-00001
     */
    protected function nextNumber(string $date): string
    {
        $year  = substr($date, 0, 4);
        $count = Purchase::whereYear('purchase_date', $year)->count() + 1;

        return sprintf('BILL-%s-%05d', $year, $count);
    }
}
