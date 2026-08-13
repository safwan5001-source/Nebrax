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
    private const ACC_ADJUSTMENT = '5170'; // فروق التقريب والتسويات

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
                'cost_center_id'      => $data['cost_center_id'] ?? null,
                'payment_type'        => $data['payment_type'] ?? Settings::get('purchases', 'default_payment_type'),
                'purchase_date'       => $date,
                'due_date'            => $data['due_date'] ?? null,
                'supplier_invoice_no' => $data['supplier_invoice_no'] ?? null,
                'status'              => 'draft',
                'tax_inclusive'       => $inclusive,
                'discount'            => max(0, (int) ($data['discount'] ?? 0)),
                'shipping'            => max(0, (int) ($data['shipping'] ?? 0)),
                'adjustment'          => (int) ($data['adjustment'] ?? 0),
                'notes'               => $data['notes'] ?? null,
                'created_by'          => $data['created_by'] ?? null,
            ]);

            $this->writeLines($purchase, $items, $inclusive);

            return $purchase->load('lines');
        });
    }

    /**
     * يكتب السطور ويشتقّ إجماليات الرأس منها — **مصدر الحقيقة هو السطور**.
     *
     * مشتركة بين الإنشاء والتعديل: نسختان كانتا ستنحرفان، فتُحسب الضريبة عند
     * الإنشاء بقاعدة وعند التعديل بأخرى على المستند نفسه.
     */
    protected function writeLines(Purchase $purchase, array $items, bool $inclusive): void
    {
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

            // خصم السطر يخفّض الأساس **قبل** حساب الضريبة: خصمٌ لا يخفّض ضريبته
            // يترك مدخلاتٍ أعلى مما دُفع فعلاً.
            $lineDisc = (int) ($item['discount'] ?? 0);
            $lineGross = $qty * $unitPrice;
            if ($lineDisc < 0 || $lineDisc > $lineGross) {
                throw new RuntimeException('خصم السطر لا يمكن أن يتجاوز إجمالي السطر.');
            }

            // متضمَّن → تُستخرَج الضريبة فيُخزَّن الصافي (يُقيَّم المخزون به)؛ غير متضمَّن → تُضاف.
            [$lineNet, $lineTax] = $this->splitLineTax($lineGross - $lineDisc, $rate, $inclusive);

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
                'line_discount' => $lineDisc,
                'line_tax'      => $lineTax,
                'line_total'    => $lineNet + $lineTax,
            ]);

            $subtotal += $lineNet;
            $taxTotal += $lineTax;
        }

        // الإجمالي = الصافي − الخصم + الشحن + الضريبة + التسوية، على ترتيب
        // الفواتير نفسه. والضريبة تُحسب على (الصافي − الخصم + الشحن): الشحن
        // الوارد خاضعٌ للضريبة كالبضاعة، والخصم يخفّضها.
        $purchase->refresh();
        [$net, $taxNet] = $this->applyHeadAdjustments($subtotal, $taxTotal, $purchase);

        $purchase->update([
            'subtotal'   => $subtotal,
            'tax_amount' => $taxNet,
            'total'      => $net + $taxNet + (int) $purchase->adjustment,
        ]);
    }

    /**
     * ═══════════════════════════════════════════════════════════════
     *  أثر الخصم والشحن على الأساس والضريبة
     * ═══════════════════════════════════════════════════════════════
     *  يُعيد [الأساس الصافي، الضريبة عليه]. الخصم يخفّض الأساس والشحن يرفعه،
     *  والضريبة تُعاد حسابها بالنسبة نفسها — لا تُنقل كما هي، وإلا دفع
     *  المستأجر ضريبةً على مبلغٍ حسم منه.
     */
    protected function applyHeadAdjustments(int $subtotal, int $taxGross, Purchase $purchase): array
    {
        $discount = max(0, (int) $purchase->discount);
        $shipping = max(0, (int) $purchase->shipping);

        if ($discount > $subtotal) {
            throw new RuntimeException('الخصم لا يمكن أن يتجاوز إجمالي السطور.');
        }

        $net    = $subtotal - $discount + $shipping;
        $taxNet = $subtotal > 0 ? intdiv($taxGross * $net, $subtotal) : 0;

        return [$net, $taxNet];
    }

    /**
     * تعديل فاتورة مشتريات **مسوّدة** — تُبنى سطورها وإجمالياتها من جديد.
     *
     * المرحّلة `immutable`: لها قيدٌ في الدفتر وحركةُ مخزون غيّرت المتوسط
     * المتحرك، وتعديلها كان يترك القيد يشهد على مبلغٍ لم يعد موجوداً. تصحيحها
     * بمرتجع مشتريات أو بقيد عكسي، لا بتحرير الحقول.
     */
    public function update(Purchase $purchase, array $data, array $items): Purchase
    {
        if (empty($items)) {
            throw new RuntimeException('فاتورة المشتريات يجب أن تحتوي على سطر واحد على الأقل.');
        }

        return DB::transaction(function () use ($purchase, $data, $items) {
            $purchase = Purchase::lockForUpdate()->findOrFail($purchase->id);
            if (! $purchase->isDraft()) {
                throw new RuntimeException('لا يمكن تعديل فاتورة مشتريات مرحّلة.');
            }

            // مسوّدة: لا قيد ولا حركة مخزون، فحذف السطور وإعادة بنائها آمن.
            $purchase->lines()->delete();

            // **الغائب يبقى، والمُرسَل فارغاً يُمحى.** `??` لا يفرّق بينهما،
            // فكان تعديلُ ملاحظةٍ يقلب `tax_inclusive` إلى `false` **ويغيّر
            // الإجمالي** في فاتورة لم يُمسّ مبلغُها — نفس علّة الفواتير (#166).
            $keep = fn (string $key, $current) => array_key_exists($key, $data) ? $data[$key] : $current;

            $purchase->update([
                'partner_id'          => $data['partner_id'],
                'cost_center_id'      => $keep('cost_center_id', $purchase->cost_center_id),
                'payment_type'        => $keep('payment_type', $purchase->payment_type) ?? $purchase->payment_type,
                'purchase_date'       => $keep('purchase_date', $purchase->purchase_date) ?? $purchase->purchase_date,
                'due_date'            => $keep('due_date', $purchase->due_date),
                'supplier_invoice_no' => $keep('supplier_invoice_no', $purchase->supplier_invoice_no),
                'tax_inclusive'       => (bool) ($keep('tax_inclusive', $purchase->tax_inclusive) ?? $purchase->tax_inclusive),
                'discount'            => max(0, (int) ($keep('discount', $purchase->discount) ?? 0)),
                'shipping'            => max(0, (int) ($keep('shipping', $purchase->shipping) ?? 0)),
                'adjustment'          => (int) ($keep('adjustment', $purchase->adjustment) ?? 0),
                'notes'               => $keep('notes', $purchase->notes),
            ]);

            $this->writeLines($purchase, $items, (bool) $purchase->fresh()->tax_inclusive);

            return $purchase->fresh('lines');
        });
    }

    /** حذف مسوّدة. المرحّلة لا تُحذف إطلاقاً — سلامة الأثر المحاسبي. */
    public function deleteDraft(Purchase $purchase): void
    {
        DB::transaction(function () use ($purchase) {
            $purchase = Purchase::lockForUpdate()->findOrFail($purchase->id);
            if (! $purchase->isDraft()) {
                throw new RuntimeException('لا يمكن حذف فاتورة مشتريات مرحّلة.');
            }
            $purchase->lines()->delete();
            $purchase->delete();
        });
    }

    /**
     * ═══════════════════════════════════════════════════════════════
     *  توزيع مبلغ على وعاءين بنسبة قيمتيهما
     * ═══════════════════════════════════════════════════════════════
     *  يُعيد `[نصيب الأول، نصيب الثاني]` ومجموعهما **يساوي المبلغ بالضبط**:
     *  باقي القسمة يُضاف إلى الوعاء الأكبر، فلا تضيع هللةٌ ولا يختلّ القيد.
     *
     *  والمبلغ قد يكون سالباً (خصم يفوق الشحن) — والقسمة الصحيحة في PHP تقرّب
     *  نحو الصفر، فيبقى الباقي محسوباً بالطرح لا بـ`%`.
     */
    protected function allocate(int $amount, int $first, int $second): array
    {
        $base = $first + $second;
        if ($amount === 0 || $base <= 0) {
            return [$amount, 0];
        }

        $firstShare  = intdiv($amount * $first, $base);
        $secondShare = $amount - $firstShare;

        // الباقي إلى الأكبر: توزيعُه على الأصغر قد يقلب إشارته.
        if ($second > $first) {
            $secondShare = intdiv($amount * $second, $base);
            $firstShare  = $amount - $secondShare;
        }

        return [$firstShare, $secondShare];
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

            // ═══════════════════════════════════════════════════════════════
            //  الخصم والشحن يدخلان **تكلفة البضاعة** لا حساباً مستقلاً
            // ═══════════════════════════════════════════════════════════════
            //  الخصم التجاري جزءٌ من ثمن الشراء لا إيراد؛ ولو رُحِّل إلى حساب
            //  مقابل لدخل المخزون بالمبلغ قبل الخصم فبقي المتوسط المتحرك
            //  مضخّماً. والشحن الوارد من تكلفة الشراء بنصّ IAS 2.
            //
            //  والتوزيع **نسبيّ على وعاءَي المخزون والمصروف**: خصمٌ يُحمَّل كلّه
            //  على المخزون بينما نصف الفاتورة خدمات يُشوّه تكلفة البضاعة. وباقي
            //  القسمة يُضاف إلى الوعاء الأكبر فيبقى المجموع مطابقاً للقرش.
            [$invAdj, $expAdj] = $this->allocate(
                (int) $purchase->shipping - (int) $purchase->discount,
                $inventoryTotal,
                $expenseTotal
            );
            $inventoryTotal += $invAdj;
            $expenseTotal   += $expAdj;

            // الضريبة تُعاد حسابها على الأساس بعد الخصم والشحن — لا تُنقل كما
            // هي، وإلا استُردّت مدخلاتٌ على مبلغ حُسم من الفاتورة.
            $base     = $inventoryTotal + $expenseTotal;
            $taxTotal = $subtotal > 0 ? intdiv($taxTotal * $base, $subtotal) : 0;

            $adjustment = (int) $purchase->adjustment;
            $total      = $base + $taxTotal + $adjustment;

            // بناء سطور القيد (الجانب المدين)
            $lines = [];

            // **وسم التكلفة لا الأصل ولا الضريبة.** مركز التكلفة بُعدٌ في قائمة
            // الدخل: المخزون (1140) أصلٌ يصير تكلفةً حين يُباع فيُوسَم قيد تكلفة
            // البضاعة المباعة لا قيد الشراء؛ وضريبة المدخلات (1150) ذمّةٌ على
            // الدولة لا مصروف مركز. فيُوسَم المصروف وحده.
            if ($inventoryTotal > 0) {
                $lines[] = ['account_id' => $this->accountId(self::ACC_INVENTORY), 'debit' => $inventoryTotal];
            }
            if ($expenseTotal > 0) {
                $lines[] = [
                    'account_id'     => $this->accountId(self::ACC_EXPENSE),
                    'debit'          => $expenseTotal,
                    'cost_center_id' => $purchase->cost_center_id,
                ];
            }
            if ($taxTotal > 0) {
                $lines[] = ['account_id' => $this->accountId(self::ACC_INPUT_VAT), 'debit' => $taxTotal];
            }

            // فرق التسوية يوازن القيد: موجب = تكلفة إضافية (مدين)، سالب = خصم
            // تقريب (دائن) — على 5170 كالفواتير تماماً.
            if ($adjustment !== 0) {
                $lines[] = $adjustment > 0
                    ? ['account_id' => $this->accountId(self::ACC_ADJUSTMENT), 'debit' => $adjustment]
                    : ['account_id' => $this->accountId(self::ACC_ADJUSTMENT), 'credit' => -$adjustment];
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

            // ═══════════════════════════════════════════════════════════════
            //  إدخال البضاعة: **مجموع ما يدخل الدفتر = مدين 1140 بالضبط**
            // ═══════════════════════════════════════════════════════════════
            //  الخصم والشحن مبلغان على مستوى الرأس، فيُنزَّلان على السطور
            //  المخزنية بنسبة قيمها. بدون ذلك يبقى الدفتر على القيمة قبل
            //  التعديل بينما القيد بعده — **فينكسر الثابت `1140 = Σ(كمية ×
            //  متوسط)`** الذي يقوم عليه تقرير المخزون كلّه.
            //
            //  والباقي يُحمَّل على آخر سطر مخزني: الفرق هللةٌ أو اثنتان لا
            //  تُرى في متوسط، لكنّ تركَها يترك الثابت مكسوراً بها.
            $trackedLines = $purchase->lines->filter(
                fn ($l) => $l->product && $l->product->track_inventory && $l->quantity > 0
            )->values();

            $rawInventory = (int) $trackedLines->sum('line_subtotal');
            $remaining    = $inventoryTotal;

            foreach ($trackedLines as $i => $line) {
                $isLast = $i === $trackedLines->count() - 1;

                // نصيب السطر من القيمة المعدَّلة — والأخير يأخذ ما تبقّى.
                $lineValue = $isLast || $rawInventory <= 0
                    ? $remaining
                    : intdiv($inventoryTotal * (int) $line->line_subtotal, $rawInventory);
                $remaining -= $lineValue;

                // الكمية بوحدة المخزون (طبلية = ٥٠ كيساً)، والقيمة هي النصيب
                // المعدَّل: `applyReceipt` يشتقّ منها تكلفة الوحدة بالقسمة.
                $baseQuantity = $line->baseQuantity();
                $this->inventory->applyReceipt(
                    $line->product,
                    $baseQuantity,
                    intdiv(max(0, $lineValue), max(1, $baseQuantity)),
                    [
                        'source_type' => Purchase::class,
                        'source_id'   => $purchase->id,
                        'date'        => $purchase->purchase_date->toDateString(),
                        'notes'       => "شراء عبر الفاتورة {$purchase->number}",
                    ],
                    max(0, $lineValue)
                );
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
