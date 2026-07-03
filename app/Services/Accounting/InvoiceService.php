<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\Invoice;
use App\Models\InvoiceLine;
use App\Models\Partner;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  InvoiceService — وحدة فواتير المبيعات
 * ═══════════════════════════════════════════════════════════════
 *  - create(): ينشئ فاتورة draft ويحسب الإجماليات من السطور.
 *  - post():   يرحّل الفاتورة ويولّد قيداً متوازناً عبر LedgerService.
 *
 *  لا كتابة مباشرة في journal_lines — القيد يُولَّد حصراً عبر المحرك.
 *  كل المبالغ بالـ minor units (هللات) كأعداد صحيحة، بلا float إطلاقاً.
 */
class InvoiceService
{
    // أكواد الحسابات المرجعية في دليل الحسابات
    private const ACC_CASH        = '1110'; // الصندوق (بيع نقدي)
    private const ACC_RECEIVABLE  = '1130'; // العملاء (بيع آجل)
    private const ACC_SALES       = '4110'; // إيرادات المبيعات
    private const ACC_VAT_OUTPUT  = '2120'; // ضريبة المخرجات

    public function __construct(
        protected LedgerService $ledger,
        protected InventoryService $inventory,
        protected ZatcaService $zatca
    ) {}

    /**
     * إنشاء فاتورة مبيعات بحالة draft مع حساب الإجماليات من السطور.
     *
     * @param  array  $data   ['partner_id'=>uuid, 'payment_type'=>'cash|credit', 'invoice_date'=>?, 'due_date'=>?, 'notes'=>?, 'number'=>?]
     * @param  array  $items  [['product_id'=>?, 'description'=>?, 'quantity'=>int, 'unit_price'=>int, 'tax_rate'=>?int], ...]
     */
    public function create(array $data, array $items): Invoice
    {
        if (empty($items)) {
            throw new RuntimeException('الفاتورة يجب أن تحتوي على سطر واحد على الأقل.');
        }

        return DB::transaction(function () use ($data, $items) {
            $date = $data['invoice_date'] ?? now()->toDateString();

            $invoice = Invoice::create([
                'number'       => $data['number'] ?? $this->nextNumber($date),
                'partner_id'   => $data['partner_id'],
                'type'         => 'sale',
                'payment_type' => $data['payment_type'] ?? 'cash',
                'invoice_date' => $date,
                'due_date'     => $data['due_date'] ?? null,
                'cost_center_id' => $data['cost_center_id'] ?? null,
                'salesperson_id' => $data['salesperson_id'] ?? null,
                'status'       => 'draft',
                'notes'        => $data['notes'] ?? null,
                'created_by'   => $data['created_by'] ?? null,
            ]);

            $subtotal = $taxTotal = 0;

            foreach ($items as $item) {
                $qty       = (int) ($item['quantity'] ?? 1);
                $unitPrice = (int) ($item['unit_price'] ?? 0);
                $rate      = (int) ($item['tax_rate'] ?? 15);
                $lineDisc  = (int) ($item['discount'] ?? 0);

                if ($qty <= 0 || $unitPrice < 0) {
                    throw new RuntimeException('الكمية يجب أن تكون موجبة والسعر غير سالب.');
                }

                $lineSubtotal = $qty * $unitPrice;                 // إجمالي السطر قبل خصم السطر
                if ($lineDisc < 0 || $lineDisc > $lineSubtotal) {
                    throw new RuntimeException('خصم السطر لا يمكن أن يتجاوز إجمالي السطر.');
                }
                $lineNet = $lineSubtotal - $lineDisc;               // الأساس الخاضع بعد خصم السطر
                $lineTax = $this->calcTax($lineNet, $rate);

                InvoiceLine::create([
                    'invoice_id'    => $invoice->id,
                    'product_id'    => $item['product_id'] ?? null,
                    'description'   => $item['description'] ?? null,
                    'quantity'      => $qty,
                    'unit_price'    => $unitPrice,
                    'tax_rate'      => $rate,
                    'line_subtotal' => $lineSubtotal,
                    'line_discount' => $lineDisc,
                    'line_tax'      => $lineTax,
                    'line_total'    => $lineNet + $lineTax,
                ]);

                $subtotal += $lineNet;                             // إجمالي الفاتورة = مجموع صافي السطور
                $taxTotal += $lineTax;
            }

            // خصم على مستوى الفاتورة (net method): يخفّض الإيراد والضريبة تناسبياً.
            [$discount, $taxAmount, $total] = $this->applyDiscount($subtotal, $taxTotal, (int) ($data['discount'] ?? 0));

            $invoice->update([
                'subtotal'   => $subtotal,
                'discount'   => $discount,
                'tax_amount' => $taxAmount,
                'total'      => $total,
            ]);

            return $invoice->load('lines');
        });
    }

    /**
     * ترحيل الفاتورة: توليد القيد المحاسبي المتوازن عبر LedgerService.
     *
     * فاتورة مبيعات نقدية 1150 (1000 + 15%):
     *   مدين  1110 الصندوق        115000
     *   دائن  4110 إيرادات المبيعات 100000
     *   دائن  2120 ضريبة المخرجات   15000
     * (للبيع الآجل يُستبدل 1110 بـ 1130 العملاء)
     */
    public function post(Invoice $invoice): Invoice
    {
        if (! $invoice->isDraft()) {
            throw new RuntimeException('لا يمكن ترحيل فاتورة غير مسوّدة (draft).');
        }

        return DB::transaction(function () use ($invoice) {
            // إعادة احتساب الإجماليات من السطور (مصدر الحقيقة) قبل توليد القيد.
            // يضمن أن القيد = السطور دائماً، ويوفّق رأس الفاتورة معها،
            // فلا يمكن أن يتعارض total مع subtotal + tax_amount مهما عُبث بالرأس.
            $invoice->loadMissing('lines');
            // إجمالي الفاتورة = مجموع صافي السطور (بعد خصم كل سطر).
            $subtotal  = (int) $invoice->lines->sum(fn ($l) => (int) $l->line_subtotal - (int) $l->line_discount);
            $taxGross  = (int) $invoice->lines->sum('line_tax');

            // تطبيق خصم الفاتورة على الأساس المشتقّ من السطور (net method).
            [$discount, $taxAmount, $total] = $this->applyDiscount($subtotal, $taxGross, (int) $invoice->discount);
            $netSales = $subtotal - $discount;

            $debitCode = $invoice->payment_type === 'cash'
                ? self::ACC_CASH
                : self::ACC_RECEIVABLE;

            $lines = [[
                'account_id'   => $this->accountId($debitCode),
                'debit'        => $total,
                'partner_type' => Partner::class,
                'partner_id'   => $invoice->partner_id,
            ], [
                'account_id'     => $this->accountId(self::ACC_SALES),
                'credit'         => $netSales,
                'cost_center_id' => $invoice->cost_center_id, // وسم الإيراد بمركز التكلفة
            ]];

            if ($taxAmount > 0) {
                $lines[] = [
                    'account_id' => $this->accountId(self::ACC_VAT_OUTPUT),
                    'credit'     => $taxAmount,
                ];
            }

            $entry = $this->ledger->post($lines, [
                'entry_date'  => $invoice->invoice_date->toDateString(),
                'description' => "فاتورة مبيعات {$invoice->number}",
                'source_type' => Invoice::class,
                'source_id'   => $invoice->id,
                'created_by'  => $invoice->created_by,
            ]);

            // قيد تكلفة البضاعة المباعة للمنتجات المتابَعة مخزونياً (إن وُجدت)
            $cogsEntry = $this->inventory->recordSaleCogs($invoice);

            // توليد بيانات ZATCA (المرحلة 1+2) من الإجماليات النهائية المشتقة من السطور
            $invoice->subtotal   = $subtotal;
            $invoice->tax_amount = $taxAmount;
            $invoice->total      = $total;
            $zatca = $this->zatca->buildFor($invoice);

            $invoice->update([
                'status'              => 'posted',
                'subtotal'            => $subtotal,
                'discount'            => $discount,
                'tax_amount'          => $taxAmount,
                'total'               => $total,
                'journal_entry_id'    => $entry->id,
                'cogs_entry_id'       => $cogsEntry?->id,
                'zatca_qr'            => $zatca['qr'],
                'zatca_hash'          => $zatca['hash'],
                'zatca_uuid'          => $zatca['uuid'],
                'zatca_icv'           => $zatca['icv'],
                'zatca_previous_hash' => $zatca['prev'],
                'zatca_xml'           => $zatca['xml'],
            ]);

            return $invoice->fresh('lines');
        });
    }

    /**
     * حساب الضريبة كعدد صحيح (تقريب نصفي لأعلى) — بلا float.
     */
    protected function calcTax(int $base, int $rate): int
    {
        return intdiv($base * $rate + 50, 100);
    }

    /**
     * تطبيق خصم على مستوى الفاتورة (net method): يخفّض الإيراد الخاضع والضريبة تناسبياً.
     * الضريبة الصافية = الضريبة الإجمالية × (الأساس بعد الخصم ÷ الأساس قبله) — بلا float.
     * خصم = 0 يُرجع القيم كما هي (توافق رجعي كامل).
     *
     * @return array{0:int,1:int,2:int}  [discount, taxNet, total]
     */
    protected function applyDiscount(int $subtotal, int $taxGross, int $discount): array
    {
        $discount = max(0, $discount);
        if ($discount > $subtotal) {
            throw new RuntimeException('الخصم لا يمكن أن يتجاوز إجمالي السطور.');
        }

        $net    = $subtotal - $discount;
        $taxNet = $subtotal > 0 ? intdiv($taxGross * $net, $subtotal) : 0;

        return [$discount, $taxNet, $net + $taxNet];
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
     * توليد رقم فاتورة تسلسلي: INV-2025-00001
     */
    protected function nextNumber(string $date): string
    {
        $year  = substr($date, 0, 4);
        $count = Invoice::whereYear('invoice_date', $year)->count() + 1;

        return sprintf('INV-%s-%05d', $year, $count);
    }
}
