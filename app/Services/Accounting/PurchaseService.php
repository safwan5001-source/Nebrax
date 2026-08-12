<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\Partner;
use App\Models\Product;
use App\Models\Purchase;
use App\Models\PurchaseLine;
use App\Support\Settings;
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
    use ComputesLineTax;

    private const ACC_INVENTORY  = '1140'; // المخزون
    private const ACC_INPUT_VAT  = '1150'; // ضريبة المدخلات
    private const ACC_EXPENSE    = '5150'; // مصروفات عامة (بنود غير مخزنية)
    private const ACC_PAYABLE    = '2110'; // الموردون
    private const ACC_CASH       = '1110'; // الصندوق

    public function __construct(
        protected LedgerService $ledger,
        protected InventoryService $inventory,
        protected UnitConversion $units
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

            // الغياب يعني «استخدم تفضيل المستأجر»؛ القيمة المرسلة تسبقه دائماً.
            $inclusive = (bool) ($data['tax_inclusive'] ?? Settings::get('purchases', 'default_tax_inclusive'));

            $purchase = Purchase::create([
                'number'              => $data['number'] ?? $this->nextNumber($date),
                'partner_id'          => $data['partner_id'],
                'payment_type'        => $data['payment_type'] ?? Settings::get('purchases', 'default_payment_type'),
                'purchase_date'       => $date,
                'due_date'            => $data['due_date'] ?? null,
                'supplier_invoice_no' => $data['supplier_invoice_no'] ?? null,
                'status'              => 'draft',
                'tax_inclusive'       => $inclusive,
                'notes'               => $data['notes'] ?? null,
                'created_by'          => $data['created_by'] ?? null,
            ]);

            $subtotal = $taxTotal = 0;
            $defaultRate = (int) Settings::get('purchases', 'default_tax_rate');

            foreach ($items as $item) {
                $qty       = (int) ($item['quantity'] ?? 1);
                $unitPrice = (int) ($item['unit_price'] ?? 0);
                $rate      = (int) ($item['tax_rate'] ?? $defaultRate);

                // الوحدة تُحلّ إلى (اسم، معامل) وتُنسَخ على السطر: لقطةٌ لا مرجع،
                // فتعديل القالب لاحقاً لا يعيد تفسير مستندٍ مرحَّل.
                [$unitName, $unitFactor] = $this->units->resolve(
                    ! empty($item['product_id']) ? Product::find($item['product_id']) : null,
                    $item['unit'] ?? null
                );

                if ($qty <= 0 || $unitPrice < 0) {
                    throw new RuntimeException('الكمية يجب أن تكون موجبة والتكلفة غير سالبة.');
                }

                // متضمَّن → تُستخرَج الضريبة فيُخزَّن الصافي (يُقيَّم المخزون به)؛ غير متضمَّن → تُضاف.
                $lineGross = $qty * $unitPrice;
                [$lineNet, $lineTax] = $this->splitLineTax($lineGross, $rate, $inclusive);

                PurchaseLine::create([
                    'purchase_id'   => $purchase->id,
                    'product_id'    => $item['product_id'] ?? null,
                    'description'   => $item['description'] ?? null,
                    'quantity'      => $qty,
                    'unit_name'     => $unitName,
                    'unit_factor'   => $unitFactor,
                    'unit_price'    => $unitPrice,
                    'tax_rate'      => $rate,
                    'line_subtotal' => $lineNet,
                    'line_tax'      => $lineTax,
                    'line_total'    => $lineNet + $lineTax,
                ]);

                $subtotal += $lineNet;
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
            // قفل الصف وإعادة فحص الحالة — يمنع الترحيل المزدوج المتزامن.
            $purchase = Purchase::lockForUpdate()->findOrFail($purchase->id);
            if (! $purchase->isDraft()) {
                throw new RuntimeException('لا يمكن ترحيل فاتورة مشتريات غير مسوّدة (draft).');
            }

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
                    // يُقيَّم المخزون بالصافي الدقيق (line_subtotal) فيتطابق مع مدين 1140
                    // في كلا الوضعين — وفي «المتضمَّن» الصافي = التكلفة بلا الضريبة المستخرَجة.
                    // الكمية بوحدة المخزون (طبلية = ٥٠ كيساً)، **والقيمة كما هي**:
                    // `line_subtotal` صافي السطر بالضبط، فتكلفة الوحدة الأساس
                    // تُشتقّ منه بالقسمة داخل `applyReceipt` بلا تحويل نقدي هنا.
                    $baseQuantity = $line->baseQuantity();
                    $this->inventory->applyReceipt($product, $baseQuantity, intdiv($line->unit_price, max(1, (int) $line->unit_factor)), [
                        'source_type' => Purchase::class,
                        'source_id'   => $purchase->id,
                        'date'        => $purchase->purchase_date->toDateString(),
                        'notes'       => "شراء عبر الفاتورة {$purchase->number}",
                    ], $line->line_subtotal);
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
    /**
     * البادئة من إعدادات المشتريات (`BILL` افتراضاً — سلوك ما قبل الإعداد).
     * تغييرها لا يصطدم بالأرقام القائمة: العدّاد يواصل التصاعد فيبقى
     * `unique(tenant_id, number)` مصوناً.
     */
    protected function nextNumber(string $date): string
    {
        $year   = substr($date, 0, 4);
        $prefix = (string) Settings::get('purchases', 'purchase_prefix');
        $count  = Purchase::whereYear('purchase_date', $year)->count() + 1;

        return sprintf('%s-%s-%05d', $prefix ?: 'BILL', $year, $count);
    }
}
