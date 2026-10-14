<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\CreditNote;
use App\Models\CreditNoteLine;
use App\Models\Invoice;
use App\Models\InvoiceLine;
use App\Models\Partner;
use App\Models\Product;
use App\Services\PrintTemplates\PrintTemplateService;
use App\Support\DocumentLineVariantResolver;
use App\Support\Money;
use App\Support\Settings;
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
 *    مدين  `tax_output` ضريبة المخرجات (افتراضياً 2120)      15000
 *    دائن  1130 العملاء            115000
 *  (للاسترداد النقدي يُستبدل 1130 بـ 1110 الصندوق)
 *
 *  ── AWJ-TAX-REM-02 (VAT-02, ACC-06) — إشعار المبيعات المرتبط بفاتورة
 *
 *  الإشعار الذي يشير إلى فاتورة مرحَّلة **لا يُعيد احتساب الضريبة** من سعر
 *  العميل ولا من 15% مفروضة: كل سطر يرتبط بسطره في الفاتورة (`source_line_id`)
 *  ويرث منه — عبر `ReturnSourceAllocator` نفسه الذي تستعمله المرتجعات (REM-01) —
 *  الأساس الصافي بعد خصم السطر وحصته من خصم الرأس، والضريبة المحصَّلة فعلاً،
 *  في وضع الفاتورة (شاملة/غير شاملة)، موزَّعةً بالكمية بحيث يساوي مجموع أي
 *  تجزئة متكررة المحصَّل بالهللة. والسقف **تراكمي مع المرتجعات**: الكمية والأساس
 *  والضريبة المستهلكة بإشعارات ومرتجعات مرحَّلة تُخصم من المتاح.
 *
 *  الإشعار **المستقل** (بلا فاتورة) مسموح فقط حيث تُجيزه
 *  `sales.allow_standalone_credit_notes` (ADR-E، الافتراض `false` للمستأجر
 *  الجديد)، وهو بلا سقف ويأخذ معدل الضريبة من `default_tax_rate` لا 15 ثابتة.
 *  إشعار المدين (المشتريات) خارج هذا التغيير عدا المعدل الافتراضي.
 *
 *  مالي صرف — لا حركة مخزون. لا كتابة مباشرة في journal_lines.
 */
class CreditNoteService
{
    private const ACC_CASH       = '1110';
    private const ACC_RECEIVABLE = '1130';
    private const ACC_SALES      = '4110';
    private const ACC_PAYABLE    = '2110'; // الموردون — جانب الإشعار المدين
    private const ACC_ALLOWANCE  = '5115'; // مردودات ومسموحات المشتريات (مصروف مقابل)

    public function __construct(
        protected LedgerService $ledger,
        protected PrintTemplateService $printTemplates,
        protected CreditNoteOwnershipResolver $ownership,
        protected AccountRoleResolver $accountRoles,
    ) {}

    /**
     * @param  array  $data   ['partner_id'=>uuid, 'refund_type'=>'credit|cash', 'note_date'=>?, 'reason'=>?, 'original_invoice_id'=>?, 'number'=>?]
     * @param  array  $items  مع فاتورة مصدر: [['source_line_id'=>?uuid, 'product_id'=>?, 'quantity'=>int, 'unit_price'=>?int], ...]
     *                        بدونها: [['product_id'=>?, 'description'=>?, 'quantity'=>int, 'unit_price'=>int, 'tax_rate'=>?int], ...]
     */
    public function create(array $data, array $items): CreditNote
    {
        if (empty($items)) {
            throw new RuntimeException('الإشعار الدائن يجب أن يحتوي على سطر واحد على الأقل.');
        }

        return DB::transaction(function () use ($data, $items) {
            $date = $data['note_date'] ?? now()->toDateString();
            $type = $this->ownership->forData($data);

            // المصدر يُحلّ ويُتحقَّق منه قبل أي كتابة: إشعارٌ يعلن مرجعاً لا يخصّ
            // عميله أو غير مرحَّل لا يُنشأ أصلاً. (المسودة لا تحجز كميةً — السقف
            // يُحسب من المرحَّل ويُعاد فحصه عند الترحيل تحت القفل.)
            $invoice = $type === CreditNoteOwnershipResolver::SALES && ! empty($data['original_invoice_id'])
                ? $this->resolveInvoice($data['original_invoice_id'], $data['partner_id'])
                : null;

            if ($type === CreditNoteOwnershipResolver::SALES && $invoice === null) {
                $this->assertStandaloneAllowed();
            }

            $note = CreditNote::create([
                'number'              => $data['number'] ?? $this->nextNumber($date, $type),
                'partner_id'          => $data['partner_id'],
                'type'                => $type,
                'refund_type'         => $data['refund_type'] ?? 'credit',
                'note_date'           => $date,
                'status'              => 'draft',
                'reason'              => $data['reason'] ?? null,
                'original_invoice_id'  => $data['original_invoice_id'] ?? null,
                'original_purchase_id' => $data['original_purchase_id'] ?? null,
                'created_by'          => $data['created_by'] ?? null,
            ]);

            $built = $invoice !== null
                ? $this->deriveFromInvoice($invoice, $items)
                : $this->standaloneLines($note, $items);

            foreach ($built as $attrs) {
                unset($attrs['line_id']);
                CreditNoteLine::create($attrs + ['credit_note_id' => $note->id]);
            }

            $this->refreshTotals($note, $built);

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

        // هذه نقطة ثقة مستقلة عن الإنشاء: صف محفوظ متناقض لا يُصلح بصمت
        // ولا يصل إلى القيد أو القالب أو تغيير الحالة.
        $type = $this->ownership->forNote($note);

        return DB::transaction(function () use ($note, $type) {
            // قفل الصف وإعادة فحص الحالة — يمنع الترحيل المزدوج المتزامن.
            $note = CreditNote::lockForUpdate()->findOrFail($note->id);
            if (! $note->isDraft()) {
                throw new RuntimeException('لا يمكن ترحيل إشعار غير مسوّد (draft).');
            }

            $note->load('lines');

            // REM-02: إشعار المبيعات المرتبط بفاتورة يُعاد اشتقاقه **تحت قفل
            // الفاتورة** من المرحَّل فعلاً. مسوّدتان أُنشئتا معاً لا تعرف
            // إحداهما الأخرى، فالسقف التراكمي لا يُحسَم إلا هنا. ترتيب الأقفال:
            // الإشعار ← الفاتورة ← مِرساة ترقيم القيد في المحرك — كمسار المرتجعات،
            // وتقفل الفاتورة نفسَها فتتسلسل مع ترحيل المرتجعات عليها.
            if ($type === CreditNoteOwnershipResolver::SALES && $note->original_invoice_id) {
                $invoice = $this->resolveInvoice($note->original_invoice_id, $note->partner_id, lock: true);
                $this->rederiveLines($note, $invoice);
                $note->load('lines');
            }

            // إعادة احتساب الإجماليات من السطور (مصدر الحقيقة) قبل توليد القيد.
            $subtotal  = (int) $note->lines->sum(fn (CreditNoteLine $l) => (int) $l->line_subtotal - (int) $l->line_discount);
            $taxAmount = (int) $note->lines->sum('line_tax');
            $total     = $subtotal + $taxAmount;

            $isPurchase = $type === CreditNoteOwnershipResolver::PURCHASE;
            $lines = $isPurchase
                ? $this->purchaseLines($note, $subtotal, $taxAmount, $total)
                : $this->salesLines($note, $subtotal, $taxAmount, $total);

            $label = $isPurchase ? 'إشعار مدين' : 'إشعار دائن';

            $entry = $this->ledger->post($lines, [
                'entry_date'  => $note->note_date->toDateString(),
                'description' => "{$label} {$note->number}",
                'source_type' => CreditNote::class,
                'source_id'   => $note->id,
                'created_by'  => $note->created_by,
            ]);

            // يُختار القالب بحسب الجهة داخل معاملة الترحيل ثم يُثبت على
            // المستند؛ لا يعدّل نشر مراجعة أحدث لاحقاً هيئة إشعار صدر بالفعل.
            $documentType = $isPurchase ? 'debit_note' : 'credit_note';
            $printAssignment = $this->printTemplates->resolve($documentType, 'print', $note->branch_id);
            $pdfAssignment = $this->printTemplates->resolve($documentType, 'pdf', $note->branch_id);
            $thermalAssignment = $this->printTemplates->resolve($documentType, 'thermal', $note->branch_id);

            $note->update([
                'status'           => 'posted',
                'print_template_revision_id' => $printAssignment?->print_template_revision_id,
                'pdf_template_revision_id' => $pdfAssignment?->print_template_revision_id,
                'thermal_template_revision_id' => $thermalAssignment?->print_template_revision_id,
                'subtotal'         => $subtotal,
                'tax_amount'       => $taxAmount,
                'total'            => $total,
                'journal_entry_id' => $entry->id,
            ]);

            return $note->fresh('lines');
        });
    }

    /**
     * ═══════════════════════════════════════════════════════════════
     *  ADR-E — الإشعار الدائن المستقل سياسةٌ تُضبط
     * ═══════════════════════════════════════════════════════════════
     *  بلا فاتورة مصدر لا سقف ولا وراثة أساس: لذا يتطلب إعداداً صريحاً.
     */
    protected function assertStandaloneAllowed(): void
    {
        if (! Settings::get('sales', 'allow_standalone_credit_notes')) {
            throw new RuntimeException(
                'إعدادات المبيعات تُلزِم ربط الإشعار الدائن بفاتورة مرحَّلة. '
                . 'فعّل «السماح بإشعار دائن مستقل» في إعدادات المبيعات لإصدار إشعار بلا فاتورة.'
            );
        }
    }

    /**
     * الفاتورة المصدر: تُحلّ تحت عزل المستأجر (معرّف مستأجر آخر ⇒ غير موجود)،
     * ويُشترط أن تكون مرحَّلة وأن تخصّ عميل الإشعار نفسه. `$lock` عند الترحيل.
     */
    protected function resolveInvoice(string $id, string $partnerId, bool $lock = false): Invoice
    {
        $query = Invoice::query();
        $invoice = ($lock ? $query->lockForUpdate() : $query)->find($id);

        if (! $invoice) {
            throw new RuntimeException('الفاتورة المصدر غير موجودة.');
        }
        if (! $invoice->isPosted()) {
            throw new RuntimeException('لا يُصدَر إشعار دائن على فاتورة غير مرحّلة.');
        }
        if ($invoice->partner_id !== $partnerId) {
            throw new RuntimeException('الفاتورة المصدر لا تخصّ عميل الإشعار.');
        }

        return $invoice;
    }

    /**
     * ═══════════════════════════════════════════════════════════════
     *  اشتقاق سطور الإشعار من سطور الفاتورة المصدر
     * ═══════════════════════════════════════════════════════════════
     *  لكل بند: سطره في الفاتورة (صريحاً بـ`source_line_id`، أو بالمنتج إن لم
     *  يتكرر في الفاتورة)، ثم الأساس والخصم والضريبة من المحصَّل على السطر موزَّعةً
     *  بالكمية ومقيَّدةً بالمتبقي تراكمياً. معدل الضريبة وسعر الوحدة المُرسَلان
     *  لا يدخلان الحساب: السعر يخفّض ولا يرفع (استردادٌ جزئي مشروع) كالمرتجع.
     *
     *  البنود في الطلب نفسه تُعدّ تراكمياً بالترتيب، فتحمل الأخيرة بقايا الهللات.
     *
     * @param  array<int, array<string, mixed>>  $items  قد يحمل البند `line_id` (سطر مسودة قائم يُعاد اشتقاقه)
     * @return array<int, array<string, mixed>>  سمات `CreditNoteLine` بالترتيب نفسه (بلا credit_note_id)
     */
    protected function deriveFromInvoice(Invoice $invoice, array $items, ?string $exceptNoteId = null): array
    {
        $allocator   = app(ReturnSourceAllocator::class);
        // إشعارات تاريخية مرحَّلة غير قابلة للربط بسطر ⇒ لا عكس إضافي حتى مراجعة المالية.
        $allocator->assertNoUnresolvedLegacyCredits($invoice);
        $sourceLines = $invoice->lines()->orderBy('id')->get()->keyBy('id');
        $charged     = $allocator->charged($invoice);
        $running     = $allocator->returned(array_keys($charged), null, $exceptNoteId);

        $out = [];
        foreach ($items as $item) {
            $lineId = $this->resolveSourceLineId($item, $sourceLines);
            $source = $sourceLines->get($lineId);

            $productId = $item['product_id'] ?? null;
            if ($productId !== null && $productId !== $source->product_id) {
                throw new RuntimeException('منتج بند الإشعار لا يطابق منتج سطر الفاتورة المصدر.');
            }
            $variantId = $item['product_variant_id'] ?? null;
            if ($variantId !== null && $variantId !== $source->product_variant_id) {
                throw new RuntimeException('متغيّر بند الإشعار لا يطابق متغيّر سطر الفاتورة المصدر.');
            }

            $qty = (int) ($item['quantity'] ?? 0);
            if ($qty <= 0) {
                throw new RuntimeException('الكمية يجب أن تكون موجبة.');
            }

            $price = isset($item['unit_price']) ? (int) $item['unit_price'] : (int) $source->unit_price;
            if ($price < 0) {
                throw new RuntimeException('السعر لا يكون سالباً.');
            }
            if ($price > (int) $source->unit_price) {
                throw new RuntimeException(
                    'سعر الإشعار لا يتجاوز سعر البيع في الفاتورة (' . Money::toRiyal($source->unit_price) . ').'
                );
            }

            $prior = $running[$lineId] ?? ['quantity' => 0, 'subtotal' => 0, 'discount' => 0, 'net' => 0, 'tax' => 0];
            $remaining = $charged[$lineId]['quantity'] - $prior['quantity'];
            if ($qty > $remaining) {
                throw new RuntimeException(
                    "الكمية ({$qty}) تتجاوز المتبقي ({$remaining}) من سطر الفاتورة بعد المرتجعات والإشعارات السابقة."
                );
            }

            $alloc = $allocator->allocate($charged[$lineId], $prior, $qty, $price);

            $running[$lineId] = [
                'quantity'  => $prior['quantity'] + $qty,
                'subtotal'  => $prior['subtotal'] + $alloc['subtotal'],
                'discount'  => $prior['discount'] + $alloc['discount'],
                'net'       => $prior['net'] + $alloc['net'],
                'tax'       => $prior['tax'] + $alloc['tax'],
                'min_price' => isset($prior['min_price']) ? min($prior['min_price'], $price) : $price,
            ];

            $out[] = [
                'line_id'        => $item['line_id'] ?? null,
                'product_id'     => $source->product_id,
                'source_line_id' => $lineId,
                'product_variant_id' => $source->product_variant_id,
                'variant_descriptor_snapshot' => $source->variant_descriptor_snapshot,
                'description'    => $item['description'] ?? $source->description,
                'quantity'       => $qty,
                'unit_price'     => $price,
                'unit_price_before_tax' => $allocator->unitPriceBeforeTaxAt($source, (bool) $invoice->tax_inclusive, $price),
                'tax_rate'       => $charged[$lineId]['tax_rate'],
                'line_subtotal'  => $alloc['subtotal'],
                'line_discount'  => $alloc['discount'],
                'line_tax'       => $alloc['tax'],
                'line_total'     => $alloc['net'] + $alloc['tax'],
            ];
        }

        $total = array_sum(array_map(fn (array $l) => $l['line_total'], $out));
        if ($total <= 0) {
            throw new RuntimeException('لا قيمة متبقية للاعتماد على بنود الفاتورة المحدَّدة.');
        }

        return $out;
    }

    /**
     * سطر الفاتورة المقصود: `source_line_id` الصريح أولاً (ويجب أن يخصّ هذه
     * الفاتورة)، وإلا فبالمنتج (والمتغيّر إن حُدِّد) بشرط ألّا يلتبس بسطر آخر.
     * هذا التوافق مع طلبات سابقة كانت تذكر الفاتورة والمنتج فقط؛ الالتباس
     * يُرفض ولا يُخمَّن.
     *
     * @param  \Illuminate\Support\Collection<string, InvoiceLine>  $sourceLines
     */
    protected function resolveSourceLineId(array $item, $sourceLines): string
    {
        $explicit = $item['source_line_id'] ?? null;
        if ($explicit !== null) {
            if (! $sourceLines->has($explicit)) {
                throw new RuntimeException('البند المحدَّد لا يخصّ الفاتورة المصدر.');
            }

            return $explicit;
        }

        $productId = $item['product_id'] ?? null;
        if ($productId === null) {
            throw new RuntimeException('كل بند في إشعار مرتبط بفاتورة يحتاج سطره في الفاتورة (source_line_id).');
        }

        $variantId = $item['product_variant_id'] ?? null;
        $matches = $sourceLines->filter(
            fn (InvoiceLine $l) => $l->product_id === $productId
                && ($variantId === null || $l->product_variant_id === $variantId)
        );

        if ($matches->isEmpty()) {
            throw new RuntimeException('المنتج المحدَّد لا يخصّ الفاتورة المصدر.');
        }
        if ($matches->count() > 1) {
            throw new RuntimeException('المنتج يتكرر في الفاتورة المصدر؛ حدّد سطره بـ source_line_id.');
        }

        return (string) $matches->first()->id;
    }

    /**
     * يعيد اشتقاق سطور مسودة مرتبطة بفاتورة عند الترحيل (داخل المعاملة وتحت قفل
     * الفاتورة) ويحدّث سطورها إن اختلفت — ومنها مسوّدات سبقت REM-02 بلا
     * `source_line_id` (تُربط بالمنتج إن لم يلتبس، وإلا يُرفض الترحيل بوضوح).
     */
    protected function rederiveLines(CreditNote $note, Invoice $invoice): void
    {
        $lines = $note->lines->sortBy('id')->values();

        $built = $this->deriveFromInvoice($invoice, $lines->map(fn (CreditNoteLine $l) => [
            'line_id'            => $l->id,
            'source_line_id'     => $l->source_line_id,
            'product_id'         => $l->product_id,
            'product_variant_id' => $l->product_variant_id,
            'description'        => $l->description,
            'quantity'           => $l->quantity,
            'unit_price'         => $l->unit_price,
        ])->all(), $note->id);

        foreach ($built as $attrs) {
            $lineId = $attrs['line_id'];
            unset($attrs['line_id']);
            CreditNoteLine::findOrFail($lineId)->update($attrs);
        }
    }

    /**
     * الإشعار المستقل (وإشعار المدين): الحساب كما كان — المبلغ × الكمية والمعدل
     * المُرسَل — مع فرق واحد: غياب المعدل يعني `default_tax_rate` للمستأجر لا 15 ثابتة.
     *
     * @return array<int, array<string, mixed>>
     */
    protected function standaloneLines(CreditNote $note, array $items): array
    {
        $defaultRate = $this->defaultRate($note->type);

        $out = [];
        foreach ($items as $item) {
            $qty       = (int) ($item['quantity'] ?? 1);
            $unitPrice = (int) ($item['unit_price'] ?? 0);
            $rate      = isset($item['tax_rate']) ? (int) $item['tax_rate'] : $defaultRate;

            if ($qty <= 0 || $unitPrice < 0) {
                throw new RuntimeException('الكمية يجب أن تكون موجبة والسعر غير سالب.');
            }

            $lineSubtotal = $qty * $unitPrice;
            $lineTax      = $this->calcTax($lineSubtotal, $rate);

            $product = ! empty($item['product_id']) ? Product::find($item['product_id']) : null;
            // VAR-DOC-1: منتجٌ متعدد الخيارات يلزمه متغيّرٌ فعلي. Fail closed.
            $variant = $product !== null
                ? DocumentLineVariantResolver::resolve($product, $item['product_variant_id'] ?? null, $note->tenant_id)
                : null;

            $out[] = [
                'product_id'     => $item['product_id'] ?? null,
                'product_variant_id' => $variant?->id,
                'variant_descriptor_snapshot' => $variant !== null ? DocumentLineVariantResolver::descriptor($variant) : null,
                'description'    => $item['description'] ?? null,
                'quantity'       => $qty,
                'unit_price'     => $unitPrice,
                'unit_price_before_tax' => $unitPrice, // المستقل غير شامل للضريبة
                'tax_rate'       => $rate,
                'line_subtotal'  => $lineSubtotal,
                'line_discount'  => 0,
                'line_tax'       => $lineTax,
                'line_total'     => $lineSubtotal + $lineTax,
            ];
        }

        return $out;
    }

    /** @param array<int, array<string, mixed>> $built */
    protected function refreshTotals(CreditNote $note, array $built): void
    {
        $subtotal = array_sum(array_map(fn (array $l) => $l['line_subtotal'] - $l['line_discount'], $built));
        $taxTotal = array_sum(array_map(fn (array $l) => $l['line_tax'], $built));

        $note->update([
            'subtotal'   => $subtotal,
            'tax_amount' => $taxTotal,
            'total'      => $subtotal + $taxTotal,
        ]);
    }

    /** معدل الضريبة الافتراضي للمستأجر حسب جهة الإشعار — لا 15 ثابتة. */
    protected function defaultRate(string $type): int
    {
        return (int) Settings::get($type === CreditNoteOwnershipResolver::PURCHASE ? 'purchases' : 'sales', 'default_tax_rate');
    }

    /** حساب الضريبة كعدد صحيح (تقريب نصفي لأعلى) — بلا float. */
    protected function calcTax(int $base, int $rate): int
    {
        return intdiv($base * $rate + 50, 100);
    }

    /**
     * إشعار دائن (للعميل): عكس الإيراد وضريبة المخرجات مقابل الذمّة أو النقد.
     *   مدين 4110 المبيعات + مدين `tax_output` ضريبة المخرجات (افتراضياً 2120) / دائن 1130 أو 1110
     *   REM-06 (R6-1): الدور الحالي وقت الترحيل، لا حساب الفاتورة الأصلية؛ تعيين مفقود/فاسد = فشل مغلق.
     */
    protected function salesLines(CreditNote $note, int $subtotal, int $taxAmount, int $total): array
    {
        $lines = [['account_id' => $this->accountId(self::ACC_SALES), 'debit' => $subtotal]];

        if ($taxAmount > 0) {
            $lines[] = ['account_id' => $this->accountRoles->resolve('tax_output')->id, 'debit' => $taxAmount];
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
     *   دائن 5115 مردودات ومسموحات المشتريات + دائن `tax_input` ضريبة المدخلات (افتراضياً 1150)
     *   REM-06 (R6-2): الدور الحالي وقت الترحيل.
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
            $lines[] = ['account_id' => $this->accountRoles->resolve('tax_input')->id, 'credit' => $taxAmount];
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

    /** تسلسل مستقلّ لكل نوع ولكل فرع: CN للإشعار الدائن، DN للمدين. */
    protected function nextNumber(string $date, string $type = 'sales'): string
    {
        return CreditNote::nextDocumentNumber($type === 'purchase' ? 'DN' : 'CN', $date);
    }
}
