<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\Invoice;
use App\Models\InvoiceLine;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Models\Product;
use App\Support\Settings;
use App\Services\PrintTemplates\PrintTemplateService;
use App\Tenancy\BranchScope;
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
    private const ACC_SHIPPING    = '4130'; // إيرادات الشحن
    private const ACC_ADJUSTMENT  = '5170'; // فروق التقريب والتسويات
    private const ACC_VAT_OUTPUT  = '2120'; // ضريبة المخرجات
    private const VAT_RATE        = 15;     // نسبة ضريبة القيمة المضافة للشحن

    /**
     * أدوات السداد الفوري كما يراها البائع ⇒ طريقة السند (ثنائية: نقد أو بنك).
     * التحويل والبطاقة كلاهما يصبّ في البنك — نفس تعيين `PosService` حرفياً.
     */
    private const PAYMENT_METHODS = ['cash' => 'cash', 'transfer' => 'bank', 'card' => 'bank'];

    public function __construct(
        protected LedgerService $ledger,
        protected InventoryService $inventory,
        protected ZatcaService $zatca,
        protected UnitConversion $units,
        protected PaymentService $payments,
        protected PrintTemplateService $printTemplates
    ) {}

    /**
     * إنشاء فاتورة مبيعات بحالة draft مع حساب الإجماليات من السطور.
     *
     * @param  array  $data   ['partner_id'=>uuid, 'payment_type'=>'cash|credit', 'invoice_date'=>?, 'due_date'=>?, 'notes'=>?, 'number'=>?,
     *                         'is_paid'=>?bool, 'payment_method'=>'cash|transfer|card', 'payment_reference'=>?, 'cash_account_id'=>?]
     * @param  array  $items  [['product_id'=>?, 'description'=>?, 'quantity'=>int, 'unit_price'=>int, 'tax_rate'=>?int], ...]
     */
    public function create(array $data, array $items): Invoice
    {
        if (empty($items)) {
            throw new RuntimeException('الفاتورة يجب أن تحتوي على سطر واحد على الأقل.');
        }

        return DB::transaction(function () use ($data, $items) {
            $date   = $data['invoice_date'] ?? now()->toDateString();
            $isPaid = (bool) ($data['is_paid'] ?? false);

            $invoice = Invoice::create([
                'number'            => $data['number'] ?? $this->nextNumber($date),
                'partner_id'        => $data['partner_id'],
                // فرع صريح (كالتوليد من فاتورة دورية)؛ وإن غاب يوسمه BelongsToBranch بالفرع النشط.
                'branch_id'         => $data['branch_id'] ?? null,
                'type'              => 'sale',
                'payment_type'      => $this->paymentType($data['payment_type'] ?? Settings::get('sales', 'default_payment_type'), $isPaid),
                'is_paid'           => $isPaid,
                'payment_method'    => $this->paymentMethod($data['payment_method'] ?? null),
                'payment_reference' => $data['payment_reference'] ?? null,
                'cash_account_id'   => $data['cash_account_id'] ?? null,
                'invoice_date'      => $date,
                'due_date'          => $data['due_date'] ?? null,
                'cost_center_id'    => $data['cost_center_id'] ?? null,
                'salesperson_id'    => $data['salesperson_id'] ?? null,
                'shipping'          => max(0, (int) ($data['shipping'] ?? 0)),
                'adjustment'        => (int) ($data['adjustment'] ?? 0),
                'tax_inclusive'     => (bool) ($data['tax_inclusive'] ?? false),
                'status'            => 'draft',
                'notes'             => $data['notes'] ?? null,
                'created_by'        => $data['created_by'] ?? null,
            ]);

            $this->applyItemsAndTotals($invoice, $items, $data);

            return $invoice->load('lines');
        });
    }

    /**
     * تعديل فاتورة مسوّدة (draft فقط) — تُبنى سطورها وإجمالياتها من جديد.
     * المرحّلة immutable (تُصحَّح بإشعار دائن/عكس)، فتُرفَض هنا.
     */
    public function update(Invoice $invoice, array $data, array $items): Invoice
    {
        if (empty($items)) {
            throw new RuntimeException('الفاتورة يجب أن تحتوي على سطر واحد على الأقل.');
        }

        return DB::transaction(function () use ($invoice, $data, $items) {
            $invoice = Invoice::lockForUpdate()->findOrFail($invoice->id);
            if (! $invoice->isDraft()) {
                throw new RuntimeException('لا يمكن تعديل فاتورة مرحّلة.');
            }

            // مسوّدة: لا قيد ولا حركة مخزون، فحذف السطور وإعادة بنائها آمن.
            $invoice->lines()->delete();

            // ═══════════════════════════════════════════════════════════
            //  في التعديل: **الغائب يبقى، والمُرسَل فارغاً يُمحى**
            // ═══════════════════════════════════════════════════════════
            //  `??` لا يفرّق بين الاثنين، فكان الغياب محواً:
            //   • `tax_inclusive` يعود `false` ⇒ تعديل ملاحظةٍ يقلب وضع الضريبة
            //     **ويغيّر الإجمالي** ١١٥٠ ← ١٣٢٢٫٥٠ في فاتورة لم يُمسّ مبلغُها.
            //   • `cost_center_id` يُمحى ⇒ سطر الإيراد يفقد وسمه فيسقط من
            //     تقرير ربحية مراكز التكلفة صامتاً.
            //   • `due_date` يُمحى ⇒ الفاتورة تتغيّر خانتها في أعمار الديون.
            //
            //  `array_key_exists` يفصل «لم يُرسَل» عن «أُرسل فارغاً» — نفس
            //  علاج `branch_id` في `LedgerService` (#152).
            $keep = fn (string $key, $current) => array_key_exists($key, $data) ? $data[$key] : $current;

            // «مدفوع بالفعل» نيّةٌ على المسوّدة: الغياب يُبقيها كما هي، فتعديلُ
            // سطرٍ لا يُلغي سداداً أعلنه المستخدم في حفظٍ سابق.
            $isPaid = (bool) ($keep('is_paid', $invoice->is_paid) ?? false);

            $invoice->update([
                'partner_id'        => $data['partner_id'],
                'payment_type'      => $this->paymentType($keep('payment_type', $invoice->payment_type) ?? $invoice->payment_type, $isPaid),
                'is_paid'           => $isPaid,
                'payment_method'    => $this->paymentMethod($keep('payment_method', $invoice->payment_method)),
                'payment_reference' => $keep('payment_reference', $invoice->payment_reference),
                'cash_account_id'   => $keep('cash_account_id', $invoice->cash_account_id),
                'invoice_date'      => $keep('invoice_date', $invoice->invoice_date) ?? $invoice->invoice_date,
                'due_date'          => $keep('due_date', $invoice->due_date),
                'cost_center_id'    => $keep('cost_center_id', $invoice->cost_center_id),
                'salesperson_id'    => $keep('salesperson_id', $invoice->salesperson_id),
                'tax_inclusive'     => (bool) ($keep('tax_inclusive', $invoice->tax_inclusive) ?? $invoice->tax_inclusive),
                'notes'             => $keep('notes', $invoice->notes),
            ]);

            $this->applyItemsAndTotals($invoice, $items, $data);

            return $invoice->fresh('lines');
        });
    }

    /**
     * ═══════════════════════════════════════════════════════════════
     *  «مدفوع بالفعل» يفرض الفاتورة **آجلة** — لا استثناء
     * ═══════════════════════════════════════════════════════════════
     *  فاتورةٌ نقدية تمدِّن 1110 داخل قيدها، فلو رافقها سندُ قبض لأُدخِل النقد
     *  مرّتين وصار على العميل رصيدٌ دائن وهمي على 1130 لم يُقيَّد مدينُه قط.
     *  المسار الصحيح واحد: الفاتورة على 1130، والسند يقفلها.
     */
    protected function paymentType(?string $requested, bool $isPaid): string
    {
        return $isPaid ? 'credit' : ($requested ?: 'credit');
    }

    /** أداة السداد المعروضة على البائع؛ المجهول يعود إلى النقد. */
    protected function paymentMethod(?string $method): string
    {
        return isset(self::PAYMENT_METHODS[$method]) ? $method : 'cash';
    }

    /**
     * حذف فاتورة مسوّدة (draft فقط). المرحّلة لا تُحذف إطلاقاً (سلامة الأثر المحاسبي).
     */
    public function deleteDraft(Invoice $invoice): void
    {
        DB::transaction(function () use ($invoice) {
            $invoice = Invoice::lockForUpdate()->findOrFail($invoice->id);
            if (! $invoice->isDraft()) {
                throw new RuntimeException('لا يمكن حذف فاتورة مرحّلة.');
            }
            $invoice->lines()->delete();
            $invoice->delete();
        });
    }

    /**
     * بناء سطور الفاتورة وحساب إجمالياتها من السطور (مصدر الحقيقة) — للإنشاء والتعديل.
     * يفترض أن السطور القديمة (إن وُجدت) حُذفت مسبقاً. لا يمسّ رأس المستند غير الإجماليات.
     */
    private function applyItemsAndTotals(Invoice $invoice, array $items, array $data): void
    {
        // وضع الاحتساب: هل أسعار السطور متضمّنة الضريبة (تُستخرَج) أم لا (تُضاف فوقها).
        $inclusive = (bool) ($data['tax_inclusive'] ?? $invoice->tax_inclusive ?? false);
        $subtotal = $taxTotal = 0;

        foreach ($items as $item) {
            $qty       = (int) ($item['quantity'] ?? 1);
            $unitPrice = (int) ($item['unit_price'] ?? 0);
            $rate      = (int) ($item['tax_rate'] ?? (int) Settings::get('sales', 'default_tax_rate'));
            $lineDisc  = (int) ($item['discount'] ?? 0);

            $product = ! empty($item['product_id']) ? Product::find($item['product_id']) : null;

            // الوحدة تُحلّ وتُنسَخ على السطر لقطةً — لا تُحوَّل النقود، الكمية وحدها.
            [$unitName, $unitFactor] = $this->units->resolve($product, $item['unit'] ?? null);

            // والوصف يُنسَخ من اسم المنتج عند غيابه — لقطةً كالوحدة تماماً،
            // فتغيير اسم المنتج لاحقاً لا يعيد تفسير فاتورةٍ صدرت للعميل.
            //
            // بدونه يخرج المستند المطبوع بسطرٍ عنوانه «—»: بلا هوية للعميل ولا
            // للمراجع، ولا لشاشة المرتجع التي تسحب سطور الفاتورة. والشاشة
            // تملؤه، لكن الحقل `nullable` في العقد فلعميل الـ API أن يتركه.
            // (نظيرُه في `PurchaseService` منذ #190 — وهذا يُغلق التناظر.)
            $description = $item['description'] ?? $product?->name;

            if ($qty <= 0 || $unitPrice < 0) {
                throw new RuntimeException('الكمية يجب أن تكون موجبة والسعر غير سالب.');
            }

            $lineGross = $qty * $unitPrice;                    // إجمالي السطر قبل خصمه (متضمِّن أو غير متضمِّن حسب الوضع)
            if ($lineDisc < 0 || $lineDisc > $lineGross) {
                throw new RuntimeException('خصم السطر لا يمكن أن يتجاوز إجمالي السطر.');
            }
            $discounted = $lineGross - $lineDisc;

            if ($inclusive) {
                // السعر متضمِّن الضريبة: نستخرج الضريبة من المبلغ بعد الخصم.
                // نخزّن الصافي (قبل الضريبة) في line_subtotal/line_discount حتى يبقى
                // (line_subtotal − line_discount) = الأساس الخاضع الصافي، فيعمل post() دون تغيير.
                $lineTax  = $this->extractTax($discounted, $rate);
                $lineNet  = $discounted - $lineTax;            // الأساس الخاضع بعد الخصم
                $discNet  = $lineDisc - $this->extractTax($lineDisc, $rate); // الجزء الصافي من الخصم
                $storedSubtotal = $lineNet + $discNet;         // صافي الإجمالي قبل الخصم
                $storedDiscount = $discNet;
                $lineTotal = $lineNet + $lineTax;              // = المبلغ المتضمِّن بعد الخصم
            } else {
                // السعر غير متضمِّن: الضريبة تُضاف فوق الصافي (السلوك الافتراضي).
                $lineNet  = $discounted;                       // الأساس الخاضع بعد الخصم
                $lineTax  = $this->calcTax($lineNet, $rate);
                $storedSubtotal = $lineGross;
                $storedDiscount = $lineDisc;
                $lineTotal = $lineNet + $lineTax;
            }

            InvoiceLine::create([
                'invoice_id'    => $invoice->id,
                'product_id'    => $item['product_id'] ?? null,
                'description'   => $description,
                'quantity'      => $qty,
                'unit_name'     => $unitName,
                'unit_factor'   => $unitFactor,
                'unit_price'    => $unitPrice,
                'tax_rate'      => $rate,
                'line_subtotal' => $storedSubtotal,
                'line_discount' => $storedDiscount,
                'line_tax'      => $lineTax,
                'line_total'    => $lineTotal,
            ]);

            $subtotal += $lineNet;                             // إجمالي الفاتورة = مجموع صافي السطور
            $taxTotal += $lineTax;
        }

        // ═══════════════════════════════════════════════════════════════
        //  حقول المال الثلاثة: الغائب **يبقى**، والمُرسَل يحلّ محلّه
        // ═══════════════════════════════════════════════════════════════
        //  كانت `?? 0` تصفّرها عند الغياب، وهذه الدالة تخدم الإنشاء والتعديل
        //  معاً — فتعديلُ ملاحظةٍ يمحو الشحن والخصم والتسوية ويهبط بالإجمالي
        //  ١٦٠٥ ← ١١٥٠. عند الإنشاء لا فرق: الرأس يحمل القيم المُرسَلة ذاتها.
        $money = fn (string $key, $current) => (int) (array_key_exists($key, $data) ? $data[$key] : $current);

        // خصم على مستوى الفاتورة (net method): يخفّض الإيراد والضريبة تناسبياً.
        [$discount, $goodsVat] = $this->applyDiscount($subtotal, $taxTotal, $money('discount', $invoice->discount));

        // الشحن: إيراد خاضع للضريبة يُضاف فوق السلع.
        $shipping    = max(0, $money('shipping', $invoice->shipping));
        $shippingVat = $shipping > 0 ? $this->calcTax($shipping, self::VAT_RATE) : 0;
        $taxAmount   = $goodsVat + $shippingVat;

        // التسوية/التقريب (+/−، غير خاضعة للضريبة) تُعدّل الإجمالي النهائي.
        $adjustment  = $money('adjustment', $invoice->adjustment);
        $total       = ($subtotal - $discount) + $shipping + $taxAmount + $adjustment;
        if ($total < 0) {
            throw new RuntimeException('التسوية تجعل إجمالي الفاتورة سالباً.');
        }

        $invoice->update([
            'subtotal'   => $subtotal,
            'discount'   => $discount,
            'shipping'   => $shipping,
            'adjustment' => $adjustment,
            'tax_amount' => $taxAmount,
            'total'      => $total,
        ]);
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
            // قفل الصف وإعادة فحص الحالة داخل المعاملة — يمنع الترحيل المزدوج المتزامن
            // (طلبان متوازيان يريان draft معاً ⇒ قيدان وخصم مخزون مرتان).
            $invoice = Invoice::lockForUpdate()->findOrFail($invoice->id);
            if (! $invoice->isDraft()) {
                throw new RuntimeException('لا يمكن ترحيل فاتورة غير مسوّدة (draft).');
            }

            // إعادة احتساب الإجماليات من السطور (مصدر الحقيقة) قبل توليد القيد.
            // يضمن أن القيد = السطور دائماً، ويوفّق رأس الفاتورة معها،
            // فلا يمكن أن يتعارض total مع subtotal + tax_amount مهما عُبث بالرأس.
            $invoice->loadMissing('lines.product');
            // إجمالي الفاتورة = مجموع صافي السطور (بعد خصم كل سطر).
            $subtotal  = (int) $invoice->lines->sum(fn ($l) => (int) $l->line_subtotal - (int) $l->line_discount);
            $taxGross  = (int) $invoice->lines->sum('line_tax');

            // تطبيق خصم الفاتورة على الأساس المشتقّ من السطور (net method).
            [$discount, $goodsVat] = $this->applyDiscount($subtotal, $taxGross, (int) $invoice->discount);
            $netSales = $subtotal - $discount;

            // الشحن: إيراد خاضع للضريبة يُضاف فوق السلع.
            $shipping    = max(0, (int) $invoice->shipping);
            $shippingVat = $shipping > 0 ? $this->calcTax($shipping, self::VAT_RATE) : 0;
            $taxAmount   = $goodsVat + $shippingVat;

            // التسوية/التقريب (+/−، غير خاضعة للضريبة).
            $adjustment  = (int) $invoice->adjustment;
            $total       = $netSales + $shipping + $taxAmount + $adjustment;
            if ($total < 0) {
                throw new RuntimeException('التسوية تجعل إجمالي الفاتورة سالباً.');
            }

            // حراسة الحد الائتماني: فاتورة آجلة لا يجوز أن تدفع رصيد العميل فوق حدّه.
            $this->assertWithinCreditLimit($invoice, $total);

            $debitCode = $invoice->payment_type === 'cash'
                ? self::ACC_CASH
                : self::ACC_RECEIVABLE;

            $lines = [[
                'account_id'   => $this->accountId($debitCode),
                'debit'        => $total,
                'partner_type' => Partner::class,
                'partner_id'   => $invoice->partner_id,
            ]];

            // تقسيم الإيراد الصافي حسب حساب مبيعات كل منتج (افتراضياً 4110)، مع بقايا التقريب على الافتراضي.
            $defaultSales = $this->accountId(self::ACC_SALES);
            $revByAccount = [];
            $allocated    = 0;
            foreach ($invoice->lines as $line) {
                $lineNet = (int) $line->line_subtotal - (int) $line->line_discount;
                $rev     = $subtotal > 0 ? intdiv($lineNet * $netSales, $subtotal) : 0;
                $acct    = $line->product?->sales_account_id ?: $defaultSales;
                $revByAccount[$acct] = ($revByAccount[$acct] ?? 0) + $rev;
                $allocated += $rev;
            }
            $remainder = $netSales - $allocated; // ≥ 0 (intdiv يقرّب لأسفل) — يُسنَد للحساب الافتراضي
            if ($remainder !== 0) {
                $revByAccount[$defaultSales] = ($revByAccount[$defaultSales] ?? 0) + $remainder;
            }
            foreach ($revByAccount as $acct => $amount) {
                if ($amount === 0) {
                    continue;
                }
                $lines[] = [
                    'account_id'     => $acct,
                    'credit'         => $amount,
                    'cost_center_id' => $invoice->cost_center_id, // وسم الإيراد بمركز التكلفة
                ];
            }

            if ($shipping > 0) {
                $lines[] = [
                    'account_id'     => $this->accountId(self::ACC_SHIPPING),
                    'credit'         => $shipping,
                    'cost_center_id' => $invoice->cost_center_id,
                ];
            }

            if ($taxAmount > 0) {
                $lines[] = [
                    'account_id' => $this->accountId(self::ACC_VAT_OUTPUT),
                    'credit'     => $taxAmount,
                ];
            }

            // فرق التسوية يوازن القيد: موجب = ربح (دائن)، سالب = خسارة (مدين) على 5170.
            if ($adjustment !== 0) {
                $lines[] = [
                    'account_id' => $this->accountId(self::ACC_ADJUSTMENT),
                    'debit'      => $adjustment < 0 ? -$adjustment : 0,
                    'credit'     => $adjustment > 0 ? $adjustment : 0,
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

            // تُحل المراجعة داخل معاملة الترحيل وتُخزَّن لقطةً؛ لا تغيّر
            // تعيينات الفرع أو القالب لاحقاً إعادة طباعة فاتورة صدرت بالفعل.
            $printAssignment = $this->printTemplates->resolve('tax_invoice', 'print', $invoice->branch_id);

            $invoice->update([
                'status'              => 'posted',
                'print_template_revision_id' => $printAssignment?->print_template_revision_id,
                'subtotal'            => $subtotal,
                'discount'            => $discount,
                'shipping'            => $shipping,
                'adjustment'          => $adjustment,
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

            $this->settle($invoice, $total);

            return $invoice->fresh('lines');
        });
    }

    /**
     * ═══════════════════════════════════════════════════════════════
     *  السداد الفوري — سند قبض مرحَّل، لا اختصار داخل قيد الفاتورة
     * ═══════════════════════════════════════════════════════════════
     *  نظير `PurchaseService::settle` في جانب المبيعات: «مدفوع بالفعل» يعني
     *  تحصيل الإجمالي كاملاً لحظة الترحيل (مدين الخزينة · دائن 1130).
     *
     *  والمرور بـ`PaymentService` مقصود: هو من يحدّث `paid_amount` و
     *  `payment_status`، ويتحقق أن المبلغ لا يتجاوز المتبقي، ويولّد رقم السند.
     *  تكرارُ ذلك هنا كان سيُنشئ نسخةً ثانية من قاعدة السداد تنحرف عن الأولى.
     *
     *  والمبلغ يُقرأ من الإجمالي المُعاد احتسابه من السطور لا من رأس الفاتورة،
     *  فمسوّدةٌ تغيّرت سطورُها بعد التأشير تُسدَّد بقيمتها الحقيقية لا بقيمة
     *  قديمة محفوظة.
     */
    protected function settle(Invoice $invoice, int $total): void
    {
        if (! $invoice->is_paid || $total <= 0) {
            return;
        }

        $payment = $this->payments->create([
            'partner_id'      => $invoice->partner_id,
            'amount'          => $total,
            'direction'       => 'received',
            'method'          => self::PAYMENT_METHODS[$invoice->payment_method] ?? 'cash',
            'reference'       => $invoice->payment_reference,
            'cash_account_id' => $invoice->cash_account_id,
            'payment_date'    => $invoice->invoice_date->toDateString(),
            'notes'           => "تحصيل فاتورة المبيعات {$invoice->number}",
            'created_by'      => $invoice->created_by,
        ], [['invoice_id' => $invoice->id, 'amount' => $total]]);

        $this->payments->post($payment);
    }

    /**
     * حراسة الحد الائتماني للعميل قبل ترحيل فاتورة آجلة.
     * الحد = 0/غياب ⇒ بلا سقف (توافق رجعي كامل: لا يتأثر أي سلوك قائم).
     * السقف يُقاس على رصيد العملاء (1130) المربوط بالطرف: (مدين − دائن) + إجمالي هذه الفاتورة.
     */
    protected function assertWithinCreditLimit(Invoice $invoice, int $total): void
    {
        if ($invoice->payment_type !== 'credit') {
            return; // البيع النقدي لا يُنشئ ذمّة
        }

        // «مدفوع بالفعل» يقفلها سندُ قبض في المعاملة نفسها، فأثرها الصافي على
        // 1130 صفر. حجبُها بالحدّ الائتماني كان سيمنع **بيعاً مسدَّداً نقداً**
        // لعميلٍ بلغ حدّه — وهو بالضبط العميل الذي لا يُباع له إلا نقداً.
        if ($invoice->is_paid) {
            return;
        }

        // قفل صف العميل يسلسل فواتيره الآجلة المتزامنة، فلا تعبر فاتورتان الحد معاً.
        // خارج عزل الفرع: عميلٌ لا يراه الفرع النشط كان سيُقرأ null فيسقط الحدّ الائتماني صامتاً.
        $partner = BranchScope::reference(Partner::class)->lockForUpdate()->find($invoice->partner_id);
        $limit   = (int) ($partner?->credit_limit ?? 0);
        if ($limit <= 0) {
            return; // بلا حد محدَّد
        }

        $receivableId = $this->accountId(self::ACC_RECEIVABLE);
        $lines = JournalLine::query()
            ->join('journal_entries as e', 'e.id', '=', 'journal_lines.journal_entry_id')
            ->whereIn('e.status', ['posted', 'reversed']) // المعكوس يبقى في الدفاتر
            ->where('journal_lines.account_id', $receivableId)
            ->where('journal_lines.partner_type', Partner::class)
            ->where('journal_lines.partner_id', $invoice->partner_id);

        $outstanding = (int) $lines->sum('journal_lines.debit') - (int) $lines->sum('journal_lines.credit');

        if ($outstanding + $total > $limit) {
            throw new RuntimeException(sprintf(
                'ترحيل الفاتورة يتجاوز الحد الائتماني للعميل (الرصيد %s + الفاتورة %s > الحد %s هللة).',
                $outstanding,
                $total,
                $limit,
            ));
        }
    }

    /**
     * حساب الضريبة كعدد صحيح (تقريب نصفي لأعلى) — بلا float.
     */
    protected function calcTax(int $base, int $rate): int
    {
        return intdiv($base * $rate + 50, 100);
    }

    /**
     * استخراج الضريبة من مبلغ متضمِّن لها = المبلغ × (النسبة ÷ (100 + النسبة))،
     * بتقريب نصفي لأعلى وبلا float. (متضمِّن 115 عند 15% ⇒ ضريبة 15، صافي 100.)
     */
    protected function extractTax(int $inclusive, int $rate): int
    {
        if ($rate <= 0 || $inclusive <= 0) {
            return 0;
        }
        $denom = 100 + $rate;

        return intdiv(2 * $inclusive * $rate + $denom, 2 * $denom); // round(inclusive×rate ÷ denom)
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
        $prefix = (string) Settings::get('sales', 'invoice_prefix');

        return Invoice::nextDocumentNumber($prefix ?: 'INV', $date);
    }
}
