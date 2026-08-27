<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\CostCenter;
use App\Models\Invoice;
use App\Models\Partner;
use App\Models\InvoiceLine;
use App\Models\InvoiceLineCostCenterAllocation;
use App\Models\JournalLine;
use App\Models\Product;
use App\Models\User;
use App\Support\Settings;
use App\Services\PrintTemplates\PrintTemplateService;
use App\Services\ClassificationService;
use App\Tenancy\BranchContext;
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
        protected PrintTemplateService $printTemplates,
        protected ClassificationService $classifications,
        protected InvoiceLinePrecision $linePrecision,
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
            // الاختيار الصريح، ولو كان null، يتقدم على اقتراح العميل. نقرأ
            // الافتراضي هنا لا في المتحكم وحده حتى يستفيد كل منشئ للمسودة.
            $priceListId = $this->defaultPriceListId($data);

            // يجب تثبيت الفرع قبل الترقيم: BelongsToBranch يحقنه عند creating،
            // لكن توليد الرقم يسبق ذلك. وإلا وُلّد رقم السلسلة بلا فرع ثم حُفظ
            // في فرع نشط، فيتصادم أول رقم بين فرعين رغم أن نطاق الترقيم فرعي.
            $branchId = $data['branch_id'] ?? app(BranchContext::class)->id();

            $invoice = Invoice::create([
                'number'            => $data['number'] ?? $this->nextNumber($date, $branchId),
                'partner_id'        => $data['partner_id'],
                'branch_id'         => $branchId,
                'warehouse_id'      => $data['warehouse_id'] ?? null,
                'price_list_id'     => $priceListId,
                'pos_session_id'    => $data['pos_session_id'] ?? null,
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
            if (array_key_exists('classification_id', $data)) {
                $this->classifications->updateDocumentClassification($invoice, $data['classification_id'], 'sales_invoice');
            }

            return $invoice->fresh('lines.costCenterAllocations.costCenter');
        });
    }

    /**
     * يرجع قائمة العميل النشطة إن لم يرسل المنشئ اختياراً يدوياً. لا تقترح
     * القائمة على فاتورة تعدّل لاحقاً، ولا تعيد حساب أي مبلغ أو سطر محفوظ.
     */
    private function defaultPriceListId(array $data): ?string
    {
        if (array_key_exists('price_list_id', $data)) {
            return $data['price_list_id'];
        }

        $partner = Partner::with('defaultPriceList')->find($data['partner_id']);
        $priceList = $partner?->defaultPriceList;

        return $priceList?->is_active ? $priceList->id : null;
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
            $this->assertDeliveryNoteSourcedDraftMutable($invoice, 'تعديل سطور');

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
                'warehouse_id'      => $keep('warehouse_id', $invoice->warehouse_id),
                'price_list_id'     => $keep('price_list_id', $invoice->price_list_id),
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
            if (array_key_exists('classification_id', $data) && $data['classification_id'] !== $invoice->classification_id) {
                $this->classifications->updateDocumentClassification($invoice, $data['classification_id'], 'sales_invoice');
            }

            return $invoice->fresh('lines.costCenterAllocations.costCenter');
        });
    }

    /**
     * ينسخ بيانات فاتورة سابقة إلى مسودة مستقلة قابلة للتعديل.
     *
     * لا يُستنسخ أي أثر مرحّل: لا سندات قبض أو تخصيصات سداد أو قيود أو حركات
     * مخزون أو بيانات ZATCA أو مراجعات طباعة مثبّتة. يمر النسخ عمداً عبر
     * create() كي يعيد بناء الإجماليات والرقم من السطور الحية نفسها.
     */
    public function duplicate(Invoice $invoice, ?string $createdBy = null): Invoice
    {
        $invoice->loadMissing('lines.costCenterAllocations');
        $this->assertDeliveryNoteSourcedDraftMutable($invoice, 'نسخ');
        $date = now()->toDateString();

        $data = [
            'partner_id'      => $invoice->partner_id,
            'warehouse_id'    => $invoice->warehouse_id,
            'price_list_id'   => $invoice->price_list_id,
            'payment_type'    => $invoice->payment_type,
            'is_paid'         => false,
            'payment_method'  => $invoice->payment_method,
            'cash_account_id' => $invoice->cash_account_id,
            'invoice_date'    => $date,
            'due_date'        => $invoice->due_date?->toDateString(),
            'cost_center_id'  => $invoice->cost_center_id,
            'classification_id' => $invoice->classification_id,
            'salesperson_id'  => $invoice->salesperson_id,
            'discount'        => $invoice->discount,
            'shipping'        => $invoice->shipping,
            'adjustment'      => $invoice->adjustment,
            'tax_inclusive'   => $invoice->tax_inclusive,
            'notes'           => $invoice->notes,
            'created_by'      => $createdBy,
        ];

        // نحافظ على نطاق سلسلة المصدر. الوثائق القديمة بلا فرع تتجه إلى الفرع
        // النشط عند الإنشاء، لكن رقمها التالي يُشتق صراحةً من سلسلتها القديمة.
        if ($invoice->branch_id !== null) {
            $data['branch_id'] = $invoice->branch_id;
        } else {
            $data['number'] = $this->nextNumber($date, null);
        }

        $items = $invoice->lines->map(function (InvoiceLine $line) use ($invoice): array {
            // عند الأسعار المتضمّنة تُخزَّن line_discount صافيةً؛ نستعيد الخصم
            // الإجمالي من إجمالي السطر كي تعيد create() حساب الضريبة نفسها.
            // السطر النسبي لا يستخدم quantity القديمة (تبقى 1 للتوافق)، بل gross
            // المقرب الرسمي المحفوظ، وإلا تكرر فاتورة وقود بقيمة لتر واحد فقط.
            $lineGross = $line->quantity_numerator !== null
                ? (int) $line->rounded_gross_minor
                : (int) $line->quantity * (int) $line->unit_price;
            $discount = $invoice->tax_inclusive
                ? $lineGross - (int) $line->line_total
                : (int) $line->line_discount;

            $item = [
                'product_id' => $line->product_id,
                'description' => $line->description,
                'quantity' => $line->quantity,
                'unit' => $line->unit_name,
                'unit_price' => $line->unit_price,
                'tax_rate' => $line->tax_rate,
                'discount' => $discount,
                'cost_center_allocations' => $line->costCenterAllocations
                    ->sortBy('position')
                    ->map(fn (InvoiceLineCostCenterAllocation $allocation) => [
                        'cost_center_id' => $allocation->cost_center_id,
                        'mode' => $allocation->mode,
                        'value' => $allocation->mode === 'percent'
                            ? $allocation->basis_points
                            : $allocation->amount,
                    ])
                    ->values()
                    ->all(),
            ];
            if ($line->quantity_numerator !== null) {
                $item['quantity_numerator'] = $line->quantity_numerator;
                $item['quantity_denominator'] = $line->quantity_denominator;
            }

            return $item;
        })->all();

        return $this->create($data, $items);
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
            $this->assertDeliveryNoteSourcedDraftMutable($invoice, 'حذف');
            $invoice->lines()->delete();
            $invoice->delete();
        });
    }

    /**
     * مسودة مبنية من سندات تسليم تحمل روابط تخصيص غير قابلة للتحرير؛ إعادة بناء
     * السطور أو حذفها أو نسخها كفاتورة بلا روابط ستفك أصل الفوترة أو تسمح بتكرارها.
     * لا يغيّر هذا الحارس قدرة `post()` على ترحيل المصدر بالطريقة القائمة.
     */
    private function assertDeliveryNoteSourcedDraftMutable(Invoice $invoice, string $action): void
    {
        if ($invoice->deliveryNoteAllocations()->exists()) {
            throw new RuntimeException("لا يمكن {$action} مسودة فاتورة مرتبطة بسندات تسليم. استخدم مسار تصحيح موثقاً لاحقاً.");
        }
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
            $unitPrice = (int) ($item['unit_price'] ?? 0);
            $rate      = (int) ($item['tax_rate'] ?? (int) Settings::get('sales', 'default_tax_rate'));
            $lineDisc  = (int) ($item['discount'] ?? 0);

            $product = ! empty($item['product_id']) ? Product::find($item['product_id']) : null;
            $precision = $this->linePrecision->fromItem($item, $unitPrice);

            // السطر النسبي يحفظ مقدار العرض في البسط/المقام؛ تبقى quantity القديمة
            // متوافقة مع السجلات القائمة ولا تُستعمل لحساب المال أو كمية ZATCA الجديدة.
            if ($precision !== null) {
                $qty = 1;
                $requestedUnit = $item['unit'] ?? null;
                if (! is_string($requestedUnit) || trim($requestedUnit) === '') {
                    throw new RuntimeException('السطر النسبي يحتاج اسم وحدة عرض صريحاً.');
                }
                // السطر النسبي الجديد الذي يملك قالب وحدات يجب أن يحتفظ بعامل
                // الوحدة الحقيقي؛ افتراض 1 لوحدة بديلة يخفض حد السعر الأدنى.
                // الفواتير النسبية التاريخية بلا قالب لها عقد أقدم منفصل موضح أدناه.
                $baseUnit = is_string($product?->unit) ? trim($product->unit) : null;
                if (! $product?->unitTemplate) {
                    // فواتير الوقود/ZATCA التاريخية سبقت قوالب الوحدات وتخزن وحدة
                    // العرض الصريحة (`L` مثلاً) مع كسر الكمية؛ لا يمكن إعادة تفسير
                    // معامل قديم من دون قالب. هذا التوافق لا يفتح PR-10: الباني
                    // يتحقق من UnitConversion قبل استدعاء create().
                    [$resolvedUnit, $unitFactor] = [trim($requestedUnit), 1];
                } else {
                    [$resolvedUnit, $unitFactor] = $this->units->resolve($product, trim($requestedUnit));
                }
                $unitName = $resolvedUnit ?? $baseUnit ?? trim($requestedUnit);
            } else {
                $qty = (int) ($item['quantity'] ?? 1);
                // الوحدة تُحلّ وتُنسَخ على السطر لقطةً — لا تُحوَّل النقود، الكمية وحدها.
                [$unitName, $unitFactor] = $this->units->resolve($product, $item['unit'] ?? null);
            }

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

            // لقطة سعر الوحدة الصافي تُحسب من سعر الوحدة نفسه قبل خصم السطر،
            // فتظل مستقلة عن كمية السطر ولا تُشتق في طبقة العرض.
            $unitPriceBeforeTax = $inclusive
                ? $unitPrice - $this->extractTax($unitPrice, $rate)
                : $unitPrice;
            $lineGross = $precision !== null
                ? $precision['rounded_gross_minor']
                : $qty * $unitPrice;                    // إجمالي السطر قبل خصمه (متضمِّن أو غير متضمِّن حسب الوضع)
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

            [$minimumPrice, $overrideReason, $overrideUserId] = $this->minimumPriceDecision(
                product: $product,
                lineNet: $lineNet,
                quantity: $qty,
                unitFactor: $unitFactor,
                precision: $precision,
                reason: $item['minimum_price_override_reason'] ?? null,
                actorId: $data['minimum_price_override_actor_id'] ?? null,
                tenantId: $invoice->tenant_id,
            );

            $line = InvoiceLine::create([
                'invoice_id'               => $invoice->id,
                'product_id'               => $item['product_id'] ?? null,
                'product_name_snapshot'    => $product?->name ?? $description,
                'product_sku_snapshot'     => $product?->sku,
                'product_barcode_snapshot' => $product?->barcode,
                'description'              => $description,
                'quantity'                 => $qty,
                'unit_name'                => $unitName,
                'unit_factor'              => $unitFactor,
                'unit_price'               => $unitPrice,
                'unit_price_before_tax'    => $unitPriceBeforeTax,
                'min_sale_price_snapshot'  => $minimumPrice,
                'min_sale_price_override_reason' => $overrideReason,
                'min_sale_price_overridden_by' => $overrideUserId,
                'tax_rate'                 => $rate,
                'quantity_numerator' => $precision['quantity_numerator'] ?? null,
                'quantity_denominator' => $precision['quantity_denominator'] ?? null,
                'pricing_numerator' => $precision['pricing_numerator'] ?? null,
                'pricing_denominator' => $precision['pricing_denominator'] ?? null,
                'rounded_gross_minor' => $precision['rounded_gross_minor'] ?? null,
                'rounding_remainder_numerator' => $precision['rounding_remainder_numerator'] ?? null,
                'rounding_remainder_denominator' => $precision['rounding_remainder_denominator'] ?? null,
                'rounding_policy' => $precision['rounding_policy'] ?? null,
                'line_subtotal' => $storedSubtotal,
                'line_discount' => $storedDiscount,
                'line_tax'      => $lineTax,
                'line_total'    => $lineTotal,
            ]);
            $this->storeLineCostCenterAllocations(
                $invoice,
                $line,
                $item['cost_center_allocations'] ?? [],
                $lineNet
            );

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
     * حارس الحد الأدنى في خدمة الفاتورة لا في المتحكم: نقطة القرار هذه تخدم
     * الفاتورة ونقطة البيع معاً، وتعيد لقطة الحد أو الاستثناء فقط؛ لا تعدّل
     * سعراً ولا ضريبة ولا قيداً.
     *
     * `lineNet` صافي السطر بعد خصمه وقبل ضريبته، و`unitFactor` يحول الحد من
     * وحدة أساس المنتج إلى الوحدة المختارة في السطر.
     *
     * @return array{0: ?int, 1: ?string, 2: ?string}
     */
    private function minimumPriceDecision(
        ?Product $product,
        int $lineNet,
        int $quantity,
        int $unitFactor,
        ?array $precision,
        mixed $reason,
        ?string $actorId,
        string $tenantId,
    ): array {
        if ($product === null || ! Settings::get('sales', 'enforce_min_sale_price')) {
            return [null, null, null];
        }

        $minimum = (int) ($product->min_sale_price ?? 0);
        if ($minimum <= 0) {
            return [null, null, null];
        }

        if ($precision === null) {
            $minimumLineNet = $minimum * $quantity * $unitFactor;
            if ($lineNet >= $minimumLineNet) {
                return [$minimum, null, null];
            }
        } else {
            $numerator = (int) $precision['quantity_numerator'];
            $denominator = (int) $precision['quantity_denominator'];
            // lineNet / (numerator × factor / denominator) >= minimum
            // ⇔ lineNet × denominator >= minimum × numerator × factor.
            // المقارنة تبقى كاملة الدقة ولا تحوّل الكمية أو المال إلى float.
            if ($lineNet <= intdiv(PHP_INT_MAX, $denominator)
                && $numerator <= intdiv(PHP_INT_MAX, max(1, $minimum))
                && ($minimum * $numerator) <= intdiv(PHP_INT_MAX, max(1, $unitFactor))
                && ($lineNet * $denominator) >= ($minimum * $numerator * $unitFactor)) {
                return [$minimum, null, null];
            }
        }

        $reason = is_string($reason) ? trim($reason) : '';
        if ($reason === '') {
            throw new RuntimeException("سعر «{$product->name}» الصافي أقل من الحد الأدنى. اكتب سبب الاستثناء وأرسله لاعتماد مدير أو مالك.");
        }

        // يحقن المتحكم الفاعل من المستخدم المصادق عليه حصراً؛ لا يأتي من حمولة
        // العميل. ويضاف القيد لصلاحيات الأدوار المخصصة كي لا يتحول
        // اسم «مدير» إلى شرط ثابت غير قابل للإدارة.
        $actor = $actorId === null
            ? null
            : User::where('tenant_id', $tenantId)->whereKey($actorId)->first();
        if (! $actor?->hasPermission('sales.minimum_price_override')) {
            throw new RuntimeException('السعر الأقل من الحد الأدنى يتطلب اعتماد مالك أو مدير مخوّل.');
        }

        return [$minimum, $reason, $actor->id];
    }

    /**
     * يحوّل إدخال النسبة أو المبلغ إلى لقطة موحّدة: هللات + نقاط أساس.
     * لا يترك أي جزء من سطر «موزع» خارج المراكز، ولا يقبل خلط طريقتي الإدخال.
     */
    private function storeLineCostCenterAllocations(Invoice $invoice, InvoiceLine $line, array $raw, int $lineNet): void
    {
        if ($raw === []) {
            return;
        }
        if ($lineNet <= 0) {
            throw new RuntimeException('لا يمكن توزيع مركز تكلفة على سطر صافيّه صفر.');
        }

        $modes = array_values(array_unique(array_map(fn (array $row) => $row['mode'] ?? null, $raw)));
        if (count($modes) !== 1 || ! in_array($modes[0], ['percent', 'amount'], true)) {
            throw new RuntimeException('يجب اختيار طريقة توزيع واحدة: نسبة أو مبلغ.');
        }
        $mode = $modes[0];
        $centerIds = array_map(fn (array $row) => (string) $row['cost_center_id'], $raw);
        if (count($centerIds) !== count(array_unique($centerIds))) {
            throw new RuntimeException('لا يمكن تكرار مركز تكلفة داخل السطر نفسه.');
        }

        $centers = CostCenter::query()
            ->whereIn('id', $centerIds)
            ->where('is_active', true)
            ->get()
            ->keyBy('id');
        if ($centers->count() !== count($centerIds)) {
            throw new RuntimeException('يجب أن تكون مراكز التكلفة نشطة ومرئية في الفرع الحالي.');
        }

        $values = array_map(fn (array $row) => (int) $row['value'], $raw);
        $sum = array_sum($values);
        if (($mode === 'percent' && $sum !== 10000) || ($mode === 'amount' && $sum !== $lineNet)) {
            throw new RuntimeException($mode === 'percent'
                ? 'يجب أن يساوي مجموع نسب مراكز التكلفة 100.00%. '
                : 'يجب أن يساوي مجموع مبالغ مراكز التكلفة صافي السطر بعد الخصم.');
        }

        $amounts = [];
        $basisPoints = [];
        if ($mode === 'percent') {
            $allocated = 0;
            foreach ($values as $position => $basis) {
                $amount = $position === array_key_last($values)
                    ? $lineNet - $allocated
                    : intdiv($lineNet * $basis, 10000);
                $amounts[$position] = $amount;
                $basisPoints[$position] = $basis;
                $allocated += $amount;
            }
        } else {
            $allocatedBasis = 0;
            foreach ($values as $position => $amount) {
                $basis = $position === array_key_last($values)
                    ? 10000 - $allocatedBasis
                    : intdiv($amount * 10000, $lineNet);
                $amounts[$position] = $amount;
                $basisPoints[$position] = $basis;
                $allocatedBasis += $basis;
            }
        }

        foreach ($raw as $position => $allocation) {
            InvoiceLineCostCenterAllocation::create([
                'tenant_id'       => $invoice->tenant_id,
                'branch_id'       => $invoice->branch_id,
                'invoice_line_id' => $line->id,
                'cost_center_id'  => $centers[(string) $allocation['cost_center_id']]->id,
                'mode'            => $mode,
                'position'        => $position,
                'basis_points'    => $basisPoints[$position],
                'amount'          => $amounts[$position],
            ]);
        }
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
    /** @param (callable(Invoice): ?\App\Models\JournalEntry)|null $cogsResolver */
    public function post(Invoice $invoice, ?callable $cogsResolver = null): Invoice
    {
        if (! $invoice->isDraft()) {
            throw new RuntimeException('لا يمكن ترحيل فاتورة غير مسوّدة (draft).');
        }

        return DB::transaction(function () use ($invoice, $cogsResolver) {
            // قفل الصف وإعادة فحص الحالة داخل المعاملة — يمنع الترحيل المزدوج المتزامن
            // (طلبان متوازيان يريان draft معاً ⇒ قيدان وخصم مخزون مرتان).
            $invoice = Invoice::lockForUpdate()->findOrFail($invoice->id);
            if (! $invoice->isDraft()) {
                throw new RuntimeException('لا يمكن ترحيل فاتورة غير مسوّدة (draft).');
            }

            // إعادة احتساب الإجماليات من السطور (مصدر الحقيقة) قبل توليد القيد.
            // يضمن أن القيد = السطور دائماً، ويوفّق رأس الفاتورة معها،
            // فلا يمكن أن يتعارض total مع subtotal + tax_amount مهما عُبث بالرأس.
            $invoice->loadMissing('lines.product', 'lines.costCenterAllocations');
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

            // كل بند يحسب حصته من خصم الفاتورة أولاً، ثم يوزعها بين مراكزه المخزنة.
            // آخر بند يحمل بقايا التقريب، فلا يظهر هلل «مفقود» في تقرير الربحية أو القيد.
            $defaultSales = $this->accountId(self::ACC_SALES);
            $revByAccountAndCenter = [];
            $lineRevenueAllocated = 0;
            foreach ($invoice->lines->values() as $position => $line) {
                $lineNet = (int) $line->line_subtotal - (int) $line->line_discount;
                $revenue = $position === $invoice->lines->count() - 1
                    ? $netSales - $lineRevenueAllocated
                    : ($subtotal > 0 ? intdiv($lineNet * $netSales, $subtotal) : 0);
                $lineRevenueAllocated += $revenue;
                $acct = $line->product?->sales_account_id ?: $defaultSales;
                foreach ($this->splitAllocatedAmount($revenue, $line->costCenterAllocations, $invoice->cost_center_id) as $allocation) {
                    $costCenterId = $allocation['cost_center_id'];
                    $amount = $allocation['amount'];
                    if ($amount === 0) {
                        continue;
                    }
                    $key = $acct.'|'.($costCenterId ?? 'none');
                    $revByAccountAndCenter[$key] = [
                        'account_id' => $acct,
                        'cost_center_id' => $costCenterId,
                        'amount' => ($revByAccountAndCenter[$key]['amount'] ?? 0) + $amount,
                    ];
                }
            }
            foreach ($revByAccountAndCenter as $row) {
                $lines[] = [
                    'account_id'     => $row['account_id'],
                    'credit'         => $row['amount'],
                    'cost_center_id' => $row['cost_center_id'],
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

            // المسار التقليدي يستعمل المتوسط العام. عمليات متخصصة كبيع الوقود
            // تمرر resolver دقيقاً لكنها تبقى داخل معاملة الفاتورة ومحركها الرسمي.
            $cogsEntry = $cogsResolver !== null
                ? $cogsResolver($invoice)
                : $this->inventory->recordSaleCogs($invoice);

            // توليد بيانات ZATCA (المرحلة 1+2) من الإجماليات النهائية المشتقة من السطور
            $invoice->subtotal   = $subtotal;
            $invoice->tax_amount = $taxAmount;
            $invoice->total      = $total;
            $zatca = $this->zatca->buildFor($invoice);

            // تُحل المراجعة داخل معاملة الترحيل وتُخزَّن لقطةً؛ لا تغيّر
            // تعيينات الفرع أو القالب لاحقاً إعادة طباعة فاتورة صدرت بالفعل.
            $printAssignment = $this->printTemplates->resolve('tax_invoice', 'print', $invoice->branch_id);
            $pdfAssignment = $this->printTemplates->resolve('tax_invoice', 'pdf', $invoice->branch_id);
            $thermalAssignment = $this->printTemplates->resolve('tax_invoice', 'thermal', $invoice->branch_id);

            $invoice->update([
                'status'              => 'posted',
                'print_template_revision_id' => $printAssignment?->print_template_revision_id,
                'pdf_template_revision_id' => $pdfAssignment?->print_template_revision_id,
                'thermal_template_revision_id' => $thermalAssignment?->print_template_revision_id,
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

            return $invoice->fresh('lines.costCenterAllocations.costCenter');
        });
    }

    /**
     * يفرع مبلغاً نهائياً على تخصيصات السطر المحفوظة. غياب التوزيع يبقي توافق
     * وسم الرأس القديم، ولا يوسم شيئاً إن لم يكن هناك مركز مفرد أصلاً.
     *
     * @return array<int, array{cost_center_id: ?string, amount: int}>
     */
    public function splitAllocatedAmount(int $amount, $allocations, ?string $fallbackCostCenterId): array
    {
        if ($allocations->isEmpty()) {
            return [['cost_center_id' => $fallbackCostCenterId, 'amount' => $amount]];
        }
        $allocationTotal = (int) $allocations->sum('amount');
        if ($allocationTotal <= 0) {
            throw new RuntimeException('تخصيصات مركز التكلفة يجب أن تملك مبلغاً موجباً.');
        }
        $result = [];
        $allocated = 0;
        foreach ($allocations->sortBy('position')->values() as $position => $allocation) {
            $part = $position === $allocations->count() - 1
                ? $amount - $allocated
                : intdiv($amount * (int) $allocation->amount, $allocationTotal);
            $result[] = ['cost_center_id' => $allocation->cost_center_id, 'amount' => $part];
            $allocated += $part;
        }

        return $result;
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
    protected function nextNumber(string $date, string|null|false $branchId = false): string
    {
        $prefix = (string) Settings::get('sales', 'invoice_prefix');

        return Invoice::nextDocumentNumber($prefix ?: 'INV', $date, $branchId);
    }
}
