<?php

namespace App\Services\Accounting;

use App\Models\Partner;
use App\Models\Product;
use App\Models\Purchase;
use App\Models\PurchaseLine;
use App\Models\FuelSupplierInvoice;
use App\Models\User;
use App\Services\PrintTemplates\PrintTemplateService;
use App\Support\PrintTemplateContract;
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
 *  فاتورة مشتريات (ACC-4 — الحسابات مُوجَّهة دلالياً عبر `AccountRoleResolver`):
 *    مدين  `inventory_asset`   (افتراضياً 1140 — تكلفة البضاعة المتابَعة)
 *    مدين  `purchase_expense`  (افتراضياً 5150 — تكلفة البنود غير المتابَعة، إن وُجدت)
 *    مدين  `tax_input`         (افتراضياً 1150 — ضريبة المدخلات)
 *    مدين/دائن `document_adjustment` (افتراضياً 5170 — فرق تسوية، إن وُجد)
 *    دائن  `accounts_payable`  (افتراضياً 2110 — الإجمالي، مربوط بالمورد)
 *
 *  والسداد الفوري — نقديةً كانت أو دفعةً جزئية عند الإصدار — **سندُ صرف
 *  مستقلّ** يولّده `PaymentService` (مدين `accounts_payable` / دائن نقد أو بنك
 *  عبر `CashBankAccountService`)، لا اختصارٌ داخل قيد الفاتورة. انظر هجرة 000050.
 *
 *  **تعيين مفقود** يحلّ للحساب القديم بالكود (توافق رجعي)؛ **تعيين صريح غير
 *  صالح** (معطّل/محذوف/تجميعي) يفشل الترحيل بالكامل قبل أي قيد — لا سقوط صامت.
 *  مرتجع المشتريات (`ReturnService::postPurchaseReturn`) يستهلك **نفس** الأدوار
 *  الثلاثة الأولى، فيبقى الاستلام وعكسه متناظرين على تعيين المستأجر نفسه.
 *
 *  لا كتابة مباشرة في journal_lines — القيد عبر المحرك حصراً.
 */
class PurchaseService
{
    use ComputesLineTax;

    // حسابا النقد (1110/1120) لا يُذكران هنا: السداد سندُ صرف يبنيه
    // `PaymentService`، فيبقى اختيار الصندوق أو البنك في موضع واحد.

    public function __construct(
        protected LedgerService $ledger,
        protected InventoryService $inventory,
        protected UnitConversion $units,
        protected PaymentService $payments,
        protected PrintTemplateService $printTemplates,
        protected AccountRoleResolver $accountRoles,
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
            $language = $this->languageAttribute($data);

            $purchase = Purchase::create([
                'number'              => $data['number'] ?? $this->nextNumber($date),
                'partner_id'          => $data['partner_id'],
                'warehouse_id'        => $data['warehouse_id'] ?? null,
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
                'paid_on_post'        => max(0, (int) ($data['paid_on_post'] ?? 0)),
                'payment_method'      => $data['payment_method'] ?? 'cash',
                'received_status'     => $data['received_status'] ?? 'received',
                'received_date'       => $data['received_date'] ?? null,
                'notes'               => $data['notes'] ?? null,
                'created_by'          => $data['created_by'] ?? null,
                'language'            => $language,
            ]);

            $this->writeLines($purchase, $items, $inclusive);

            return $purchase->load('lines');
        });
    }

    /**
     * إنشاء نسخة مسودة: تنسخ البيانات التجارية والسطور فقط، بلا مرفقات أو
     * مدفوعات أو قيود أو حركات، وبـرقم وتاريخ جديدين يصلحان للمراجعة والتعديل.
     */
    public function duplicate(Purchase $source, ?string $createdBy): Purchase
    {
        $source->loadMissing('lines');

        return $this->create([
            'partner_id'          => $source->partner_id,
            'warehouse_id'        => $source->warehouse_id,
            'cost_center_id'      => $source->cost_center_id,
            'payment_type'        => $source->payment_type,
            'purchase_date'       => now()->toDateString(),
            'due_date'            => null,
            'supplier_invoice_no' => null,
            'tax_inclusive'       => $source->tax_inclusive,
            'discount'            => $source->discount,
            'shipping'            => $source->shipping,
            'adjustment'          => $source->adjustment,
            'paid_on_post'        => 0,
            'payment_method'      => $source->payment_method,
            'received_status'     => 'pending',
            'received_date'       => null,
            'notes'               => $source->notes,
            'created_by'          => $createdBy,
        ], $source->lines->map(fn (PurchaseLine $line) => [
            'product_id' => $line->product_id,
            'description' => $line->description,
            'quantity'    => $line->quantity,
            'unit'        => $line->unit_name,
            'unit_price'  => $line->unit_price,
            'discount'    => $line->line_discount,
            'tax_rate'    => $line->tax_rate,
        ])->all());
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

            $product = ! empty($item['product_id']) ? Product::find($item['product_id']) : null;

            // الوحدة تُحلّ إلى (اسم، معامل) وتُنسَخ على السطر: لقطةٌ لا مرجع،
            // فتعديل القالب لاحقاً لا يعيد تفسير مستندٍ مرحَّل.
            [$unitName, $unitFactor] = $this->units->resolve($product, $item['unit'] ?? null);

            // الوصف يُنسَخ من اسم المنتج عند غيابه — لقطةً كالوحدة تماماً.
            // بدونه يخرج المستند المطبوع بسطرٍ عنوانه «—»: بلا هوية للمورّد
            // ولا للمراجع. والشاشة تملأه، لكن عميل الـ API له أن يتركه.
            $description = $item['description'] ?? $product?->name;

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
                'description'   => $description,
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
            $language = $this->languageAttribute($data, $purchase);

            $purchase->update([
                'partner_id'          => $data['partner_id'],
                'warehouse_id'        => $keep('warehouse_id', $purchase->warehouse_id),
                'cost_center_id'      => $keep('cost_center_id', $purchase->cost_center_id),
                'payment_type'        => $keep('payment_type', $purchase->payment_type) ?? $purchase->payment_type,
                'purchase_date'       => $keep('purchase_date', $purchase->purchase_date) ?? $purchase->purchase_date,
                'due_date'            => $keep('due_date', $purchase->due_date),
                'supplier_invoice_no' => $keep('supplier_invoice_no', $purchase->supplier_invoice_no),
                'tax_inclusive'       => (bool) ($keep('tax_inclusive', $purchase->tax_inclusive) ?? $purchase->tax_inclusive),
                'discount'            => max(0, (int) ($keep('discount', $purchase->discount) ?? 0)),
                'shipping'            => max(0, (int) ($keep('shipping', $purchase->shipping) ?? 0)),
                'adjustment'          => (int) ($keep('adjustment', $purchase->adjustment) ?? 0),
                'paid_on_post'        => max(0, (int) ($keep('paid_on_post', $purchase->paid_on_post) ?? 0)),
                'payment_method'      => $keep('payment_method', $purchase->payment_method) ?? $purchase->payment_method,
                'received_status'     => $keep('received_status', $purchase->received_status) ?? $purchase->received_status,
                'received_date'       => $keep('received_date', $purchase->received_date),
                'notes'               => $keep('notes', $purchase->notes),
                'language'            => $language,
            ]);

            $this->writeLines($purchase, $items, (bool) $purchase->fresh()->tax_inclusive);

            return $purchase->fresh('lines');
        });
    }

    /**
     * لغة مستند فاتورة المشتريات — نفس منطق `InvoiceService::languageAttribute()`
     * حرفياً. الغياب يُبقي القيمة عند التعديل، وnull يصفّر الاختيار (يعود لسقوط
     * افتراضي المؤسسة ثم `ar`). القيمة الصريحة تخضع لعقد V1 حصراً
     * (`ar`/`en`/`bilingual`).
     */
    private function languageAttribute(array $data, ?Purchase $existing = null): ?string
    {
        if ($existing === null) {
            return PrintTemplateContract::assertLanguage($data['language'] ?? null);
        }
        if (! array_key_exists('language', $data)) {
            return $existing->language;
        }

        return PrintTemplateContract::assertLanguage($data['language']);
    }

    /**
     * لقطة لغة المستند عند الترحيل: قرار المسودة الحيّ ← افتراضي المؤسسة ← `ar`.
     * كتابة واحدة على `language_frozen` ضمن معاملة الترحيل نفسها — لا مسار
     * يعدّلها بعد ذلك. لا تمسّ الأرقام أو الضرائب أو المخزون — قرار عرض بحت.
     */
    private function freezeLanguage(Purchase $purchase): string
    {
        return PrintTemplateContract::resolveEffectiveLanguage(
            null,
            $purchase->language,
            Settings::get('documents', 'default_language'),
        );
    }

    /** حذف مسوّدة. المرحّلة لا تُحذف إطلاقاً — سلامة الأثر المحاسبي. */
    public function deleteDraft(Purchase $purchase): void
    {
        DB::transaction(function () use ($purchase) {
            $purchase = Purchase::lockForUpdate()->findOrFail($purchase->id);
            if (! $purchase->isDraft()) {
                throw new RuntimeException('لا يمكن حذف فاتورة مشتريات مرحّلة.');
            }
            if ($purchase->documentTransactionLinks()->lockForUpdate()->exists()) {
                throw new RuntimeException('لا يمكن حذف مسودة مشتريات مرتبطة بمستند؛ استخدم الإلغاء أو الأرشفة وفق دورة المشتريات.');
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
     *
     * @param  ?User  $actor  الفاعل المصادَق عليه لمسار HTTP الحقيقي — يصل حتى
     *                        حدّ تخويل الخزينة في `settle()`.
     */
    public function post(Purchase $purchase, ?User $actor = null): Purchase
    {
        if (! $purchase->isDraft()) {
            throw new RuntimeException('لا يمكن ترحيل فاتورة مشتريات غير مسوّدة (draft).');
        }

        return DB::transaction(function () use ($purchase, $actor) {
            // قفل الصف وإعادة فحص الحالة — يمنع الترحيل المزدوج المتزامن.
            $purchase = Purchase::lockForUpdate()->findOrFail($purchase->id);
            if (! $purchase->isDraft()) {
                throw new RuntimeException('لا يمكن ترحيل فاتورة مشتريات غير مسوّدة (draft).');
            }

            // ربط فاتورة شراء بمطالبة وقود يعني أن استلام المحطة سبقها بالفعل
            // عبر Dr Inventory / Cr GRNI. ترحيل PurchaseService سيخلق نفس
            // StockMovement و1140 مرة ثانية، لذا تتولى مطابقة Cycle 3 تسوية
            // GRNI إلى المورد ولا يسمح بهذا المسار العام أن يتجاوزها.
            if (FuelSupplierInvoice::where('purchase_id', $purchase->id)->exists()) {
                throw new RuntimeException('فاتورة الشراء مرتبطة باستلام وقود وGRNI؛ لا يجوز ترحيلها عبر محرك المشتريات لأنه سيكرر المخزون.');
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
            // الدخل: المخزون أصلٌ يصير تكلفةً حين يُباع فيُوسَم قيد تكلفة
            // البضاعة المباعة لا قيد الشراء؛ وضريبة المدخلات ذمّةٌ على الدولة
            // لا مصروف مركز. فيُوسَم المصروف وحده.
            //
            // ACC-4: كل حساب هنا مُوجَّهٌ عبر `AccountRoleResolver` — تعيينٌ
            // مفقود يحلّ للحساب القديم بالكود، وتعيينٌ صريح غير صالح يفشل
            // الترحيل بالكامل (`RuntimeException` قبل أي قيد).
            if ($inventoryTotal > 0) {
                $lines[] = ['account_id' => $this->accountRoles->resolve('inventory_asset')->id, 'debit' => $inventoryTotal];
            }
            if ($expenseTotal > 0) {
                $lines[] = [
                    'account_id'     => $this->accountRoles->resolve('purchase_expense')->id,
                    'debit'          => $expenseTotal,
                    'cost_center_id' => $purchase->cost_center_id,
                ];
            }
            if ($taxTotal > 0) {
                $lines[] = ['account_id' => $this->accountRoles->resolve('tax_input')->id, 'debit' => $taxTotal];
            }

            // فرق التسوية يوازن القيد: موجب = تكلفة إضافية (مدين)، سالب = خصم
            // تقريب (دائن) — نفس دور `document_adjustment` المشترك مع الفواتير.
            if ($adjustment !== 0) {
                $adjustmentAccountId = $this->accountRoles->resolve('document_adjustment')->id;
                $lines[] = $adjustment > 0
                    ? ['account_id' => $adjustmentAccountId, 'debit' => $adjustment]
                    : ['account_id' => $adjustmentAccountId, 'credit' => -$adjustment];
            }

            // ═══════════════════════════════════════════════════════════════
            //  الجانب الدائن: **الموردون دائماً**
            // ═══════════════════════════════════════════════════════════════
            //  حتى النقدية. اختصارُ الصندوق كان يترك المستند `unpaid` بينما لا
            //  دَين له في الدفتر، فيَعدّه تقرير أعمار الديون الدائنة التزاماً
            //  قائماً. السداد يليه سنداً مستقلاً — انظر `settle` أدناه.
            $lines[] = [
                'account_id'   => $this->accountRoles->resolve('accounts_payable')->id,
                'credit'       => $total,
                'partner_type' => Partner::class,
                'partner_id'   => $purchase->partner_id,
            ];

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
                        'warehouse_id' => $purchase->warehouse_id,
                        'branch_id'   => $purchase->branch_id,
                        'date'        => $purchase->purchase_date->toDateString(),
                        'notes'       => "شراء عبر الفاتورة {$purchase->number}",
                    ],
                    max(0, $lineValue)
                );
            }

            // تحل المراجعة المنشورة داخل معاملة الترحيل وتُثبت على الفاتورة؛
            // تعديل التعيين أو نشر نسخة أحدث لاحقاً لا يغير مستنداً صدر بالفعل.
            $printAssignment = $this->printTemplates->resolve('purchase_invoice', 'print', $purchase->branch_id);
            $pdfAssignment = $this->printTemplates->resolve('purchase_invoice', 'pdf', $purchase->branch_id);
            $thermalAssignment = $this->printTemplates->resolve('purchase_invoice', 'thermal', $purchase->branch_id);
            // لغة المستند تُجمّد بنفس نقطة التزام لقطات القوالب — كتابة أولى
            // وحيدة على `language_frozen`، مستقلة تماماً عن اختيار القالب.
            $language = $this->freezeLanguage($purchase);

            $purchase->update([
                'status'           => 'posted',
                'print_template_revision_id' => $printAssignment?->print_template_revision_id,
                'pdf_template_revision_id' => $pdfAssignment?->print_template_revision_id,
                'thermal_template_revision_id' => $thermalAssignment?->print_template_revision_id,
                'language_frozen'  => $language,
                'subtotal'         => $subtotal,
                'tax_amount'       => $taxTotal,
                'total'            => $total,
                'journal_entry_id' => $entry->id,
                // البضاعة دخلت المخزون للتوّ، فتاريخُ الاستلام تاريخُ الشراء
                // ما لم يُصرّح المستخدم بغيره (وصولٌ متأخّر أو جزئي).
                'received_date'    => $purchase->received_date
                    ?? ($purchase->received_status === 'received' ? $purchase->purchase_date : null),
            ]);

            $this->settle($purchase, $total, $actor);

            return $purchase->fresh('lines');
        });
    }

    /**
     * ═══════════════════════════════════════════════════════════════
     *  السداد الفوري — سند صرف مرحَّل، لا اختصار داخل قيد الفاتورة
     * ═══════════════════════════════════════════════════════════════
     *  «نقدي» = مسدَّدة بالكامل؛ و«آجل» يقبل `paid_on_post` دفعةً مقدَّمة تترك
     *  الفاتورة `partial` والباقي ديناً حقيقياً على 2110.
     *
     *  والمرور بـ`PaymentService` مقصود: هو من يحدّث `paid_amount` و
     *  `payment_status` ويتحقق أن المبلغ لا يتجاوز المتبقي. تكرارُ ذلك هنا
     *  كان سيُنشئ نسخةً ثانية من قاعدة السداد تنحرف عن الأولى.
     */
    protected function settle(Purchase $purchase, int $total, ?User $actor = null): void
    {
        $paid = $purchase->payment_type === 'cash'
            ? $total
            : min(max(0, (int) $purchase->paid_on_post), $total);

        if ($paid <= 0) {
            return;
        }

        $payment = $this->payments->create([
            'partner_id'   => $purchase->partner_id,
            'amount'       => $paid,
            'direction'    => 'paid',
            'method'       => $purchase->payment_method === 'bank' ? 'bank' : 'cash',
            'payment_date' => $purchase->purchase_date->toDateString(),
            'notes'        => "سداد فاتورة المشتريات {$purchase->number}",
            'created_by'   => $purchase->created_by,
        ], [['purchase_id' => $purchase->id, 'amount' => $paid]]);

        // الفاعل المصادَق عليه هو مبدأ التخويل عند حدّ الخزينة — created_by أعلاه
        // مجرد إسناد تدقيقي ولا يُستبدل به.
        $this->payments->post($payment, $actor);
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
        $prefix = (string) Settings::get('purchases', 'purchase_prefix');

        return Purchase::nextDocumentNumber($prefix ?: 'BILL', $date);
    }
}
