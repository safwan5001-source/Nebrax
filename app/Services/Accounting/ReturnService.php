<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\Invoice;
use App\Models\InvoiceLine;
use App\Models\Partner;
use App\Models\PosSession;
use App\Models\PosSessionEvent;
use App\Models\Purchase;
use App\Models\PurchaseLine;
use App\Models\ReturnDocument;
use App\Models\ReturnLine;
use App\Models\User;
use App\Services\Pos\PosAuditService;
use App\Support\Money;
use App\Support\Settings;
use Carbon\Carbon;
use App\Tenancy\BranchScope;
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
 *    فإن كانت البضاعة **لا تعود للبيع** (سياسة المستأجر أو تصريح المستند):
 *    مدين 5180 فروق الجرد والتلف / دائن 5110 — بلا حركة مخزون.
 *
 *  مرتجع مشتريات (purchase) — عكس الشراء:
 *    مدين 2110/1110 (الإجمالي التجاري الكامل) │ دائن 1140 المخزون (القيمة
 *    الدفترية avg_cost فقط) + دائن 5150 + دائن 1150 ضريبة المدخلات + فرق
 *    التقييم (إن وُجد) على 5116 فروق تقييم مردودات المشتريات — لا 5180.
 *    وللبضاعة المتابَعة: إخراج من المخزون بالكمية الأساسية التاريخية.
 *
 *  ── المستند المصدر
 *
 *  للمرتجع أن يُربط بفاتورةٍ مصدر (`original_*` على الرأس، و`source_line_id`
 *  على كل سطر). والربط حين يوجد **يُلزِم**: لا يُرَدّ أكثر مما بيع، ولا بسعرٍ
 *  أعلى مما قُبض. مستندٌ يعلن مرجعاً ثم يناقضه بياناتٌ خاطئة لا مختلفة.
 *
 *  أمّا **إلزام وجود مصدر أصلاً** فسياسةُ عملٍ لا صحّةٌ تقنية: التجزئة تريد
 *  «لا ردّ بلا إيصال»، والخدمات تُصدر إشعارات دائنة مستقلّة. فهو مفتاحٌ في
 *  إعدادات المبيعات/المشتريات، افتراضه معطّل.
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
    private const ACC_DAMAGE      = '5180'; // فروق الجرد والتلف — تلفٌ/فقدٌ فيزيائي فقط، لا فرق تقييم
    // PURCHASE_RETURN_VALUATION_VARIANCE (المعنى المحاسبي المستقبلي لميزة Account
    // Mapping القادمة): فرقٌ تقييمي بحت — اعتماد المورّد التجاري مقابل القيمة
    // الدفترية الفعلية المُزالة من 1140 — لا فرق جردٍ أو تلفٍ فلا يُستخدم 5180 له.
    private const ACC_PURCHASE_RETURN_VALUATION_VARIANCE = '5116';

    public function __construct(
        protected LedgerService $ledger,
        protected InventoryService $inventory,
        protected PosAuditService $posAudit,
    ) {}

    /**
     * إنشاء مرتجع بحالة draft مع حساب الإجماليات من السطور.
     *
     * @param  array  $data   ['type'=>'sales|purchase', 'partner_id'=>uuid, 'payment_type'=>'credit|cash',
     *                         'return_date'=>?, 'notes'=>?, 'number'=>?, 'original_type'=>?, 'original_id'=>?]
     * @param  array  $items  [['product_id'=>?, 'description'=>?, 'quantity'=>int, 'unit_price'=>int, 'line_discount'=>?int, 'tax_rate'=>?int], ...]
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

        // المصدر يُحلّ ويُتحقَّق منه **قبل** أي كتابة: مستندٌ يعلن مرجعاً لا
        // يخصّه أو غير مرحّل لا يُنشأ أصلاً.
        $source = $this->resolveSource($data, $type);

        return DB::transaction(function () use ($data, $items, $type, $source) {
            $date = $data['return_date'] ?? now()->toDateString();

            if ($source) {
                $this->assertWithinSource($source, $items);
            }

            $return = ReturnDocument::create([
                'number'        => $data['number'] ?? $this->nextNumber($type, $date),
                'type'          => $type,
                'partner_id'    => $data['partner_id'],
                // المصدر يحدد موقع البضاعة افتراضياً؛ الاختيار الصريح يعلو عليه.
                'warehouse_id'  => $data['warehouse_id'] ?? $source?->warehouse_id,
                'pos_session_id' => $data['pos_session_id'] ?? null,
                'payment_type'  => $data['payment_type'] ?? 'credit',
                // لقطة وضع الضريبة تشرح مصدر قيم السطور التاريخي؛ الافتراض false
                // يحافظ على تفسير المرتجعات التي سبقت هذا الحقل.
                'tax_inclusive' => (bool) ($data['tax_inclusive'] ?? false),
                // null = «اتبع سياسة المستأجر» — تُحسَم عند الترحيل لا الآن،
                // فتبقى المسوّدة تابعةً للسياسة ولو تغيّرت قبل ترحيلها.
                'restock'       => array_key_exists('restock', $data) && $data['restock'] !== null
                    ? (bool) $data['restock']
                    : null,
                'return_date'   => $date,
                'status'        => 'draft',
                'notes'         => $data['notes'] ?? null,
                // النوع يُشتقّ من المصدر المحلول لا من المُرسَل: العميل يرسل
                // المعرّف وحده، والنوع يقرّره نوعُ المرتجع فلا يتناقضان.
                'original_type' => $source ? $source::class : null,
                'original_id'   => $source?->id,
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

                // خدمة POS فقط تمرر أساس السطر الموزّع من الوثيقة المصدر؛ أما
                // API العام فيبقى على كمية × سعر الوحدة كما كان. لا يتحكم عميل
                // API في المفتاح لأنه غير موجود في طلبه المتحقق منه.
                $lineSubtotal = array_key_exists('line_subtotal_override', $item)
                    ? (int) $item['line_subtotal_override']
                    : $qty * $unitPrice;
                if ($lineSubtotal < 0) {
                    throw new RuntimeException('أساس سطر المرتجع لا يمكن أن يكون سالباً.');
                }
                $lineDiscount = max(0, (int) ($item['line_discount'] ?? 0));
                if ($lineDiscount > $lineSubtotal) {
                    throw new RuntimeException('خصم سطر المرتجع لا يمكن أن يتجاوز إجمالي السطر.');
                }
                $lineNet = $lineSubtotal - $lineDiscount;
                // لا يرسل عميل API هذا المفتاح (طلب المرتجع العام لا يتحقق منه).
                // تستخدمه خدمة POS فقط بعد اشتقاقه من سطر المصدر المثبت، كي تبقى
                // هللات ضريبة السعر المتضمن مطابقة للفاصل الضريبي الأصلي.
                $lineTax = array_key_exists('line_tax_override', $item)
                    ? (int) $item['line_tax_override']
                    : $this->calcTax($lineNet, $rate);
                if ($lineTax < 0) {
                    throw new RuntimeException('ضريبة سطر المرتجع لا يمكن أن تكون سالبة.');
                }

                ReturnLine::create([
                    'return_id'      => $return->id,
                    'product_id'     => $item['product_id'] ?? null,
                    'source_line_id' => $item['source_line_id'] ?? null,
                    'description'   => $item['description'] ?? null,
                    'quantity'      => $qty,
                    'unit_price'    => $unitPrice,
                    'tax_rate'      => $rate,
                    'line_subtotal' => $lineSubtotal,
                    'line_discount' => $lineDiscount,
                    'line_tax'      => $lineTax,
                    'line_total'    => $lineNet + $lineTax,
                ]);

                $subtotal += $lineNet;
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
     * ═══════════════════════════════════════════════════════════════
     *  المستند المصدر — حلٌّ وتحقّق
     * ═══════════════════════════════════════════════════════════════
     *  يُعيد الفاتورة/المشترى المصدر، أو `null` لمرتجعٍ حرّ. ويرفض:
     *  مصدراً من نوعٍ يخالف نوع المرتجع، أو لا يخصّ طرفه، أو غير مرحّل،
     *  أو غياب المصدر أصلاً حين يُلزِم به إعداد المستأجر.
     */
    protected function resolveSource(array $data, string $type): Invoice|Purchase|null
    {
        $class = $type === 'sales' ? Invoice::class : Purchase::class;
        $id    = $data['original_id'] ?? null;

        if (! $id) {
            // **سياسة لا صحّة:** الإلزام اختيار المستأجر، ومفتاحه في قسم
            // الوحدة (مبيعات/مشتريات) لا مفتاحٌ واحد يحكم الاتجاهين.
            $group = $type === 'sales' ? 'sales' : 'purchases';
            if (Settings::get($group, 'require_return_source')) {
                throw new RuntimeException(
                    $type === 'sales'
                        ? 'إعدادات المبيعات تُلزِم ربط مرتجع المبيعات بفاتورته.'
                        : 'إعدادات المشتريات تُلزِم ربط مرتجع المشتريات بفاتورته.'
                );
            }

            return null;
        }

        // النوع المعلَن على الرأس — إن أُرسل — يجب أن يطابق نوع المرتجع.
        if (! empty($data['original_type']) && $data['original_type'] !== $class) {
            throw new RuntimeException('نوع المستند المصدر لا يطابق نوع المرتجع.');
        }

        // معرّف مخزَّن يُحلّ **خارج عزل الفرع**: المستند المصدر حجّة قائمة لا
        // نتيجة تصفّح، وفرعُ المرتجع قد يخالف فرع الفاتورة.
        $source = BranchScope::reference($class)->find($id);

        if (! $source) {
            throw new RuntimeException('المستند المصدر غير موجود.');
        }
        if (! $source->isPosted()) {
            throw new RuntimeException('لا يُرَدّ على مستند غير مرحّل.');
        }
        if ($source->partner_id !== ($data['partner_id'] ?? null)) {
            throw new RuntimeException('المستند المصدر لا يخصّ طرف المرتجع.');
        }

        $this->assertWithinWindow($source, $data, $type);

        return $source;
    }

    /**
     * ═══════════════════════════════════════════════════════════════
     *  مهلة الردّ — سياسةٌ تُقاس من تاريخ المستند المصدر
     * ═══════════════════════════════════════════════════════════════
     *  **سياسة عمل لا صحّة تقنية:** التجزئة تضع مهلةً معلنة، والمقاولات لا
     *  مهلة فيها. الافتراض `0` = بلا حدّ، وهو سلوك اليوم حرفياً.
     *
     *  ولا تُقاس إلا بوجود مصدر: المرتجع الحرّ بلا مرجعٍ زمني يُقاس عليه.
     */
    protected function assertWithinWindow(Invoice|Purchase $source, array $data, string $type): void
    {
        $group = $type === 'sales' ? 'sales' : 'purchases';
        $days  = (int) Settings::get($group, 'return_window_days');

        if ($days <= 0) {
            return;
        }

        $sourceDate = $type === 'sales' ? $source->invoice_date : $source->purchase_date;
        $returnDate = Carbon::parse($data['return_date'] ?? now()->toDateString());

        // سالبٌ يعني ردّاً بتاريخٍ **قبل** الفاتورة — يُرفض بالقدر نفسه، فهو
        // ليس «داخل المهلة» بل خارج المنطق.
        $elapsed = Carbon::parse($sourceDate)->diffInDays($returnDate, false);

        if ($elapsed < 0) {
            throw new RuntimeException('تاريخ المرتجع يسبق تاريخ المستند المصدر.');
        }
        if ($elapsed > $days) {
            throw new RuntimeException(
                "مهلة الردّ {$days} يوماً من تاريخ المستند، وقد مضى {$elapsed} يوماً."
            );
        }
    }

    /**
     * ═══════════════════════════════════════════════════════════════
     *  لا يُرَدّ أكثر مما بيع، ولا بسعرٍ أعلى مما قُبض
     * ═══════════════════════════════════════════════════════════════
     *  **صحّة تقنية لا سياسة:** مستندٌ يقول «هذا مقابل INV-001» ثم يردّ ١٠ من
     *  صنفٍ باعت INV-001 منه ٥ مستندٌ يناقض مرجعه — بياناتٌ خاطئة لا مختلفة.
     *
     *  والقياس **تراكمي**: يُجمَع ما رُدَّ في كل المرتجعات المرحَّلة على السطر
     *  نفسه، وإلا رُدَّ خمسةٌ ثلاث مرات. والمسوّدات لا تحجز — فلا تُقفل مسوّدةٌ
     *  منسيّة ردّاً مشروعاً؛ الحارس يُعاد تنفيذه عند الترحيل داخل المعاملة.
     */
    protected function assertWithinSource(Invoice|Purchase $source, array $items, ?string $exceptReturnId = null): void
    {
        $sourceLines = $source->lines()->get()->keyBy('id');

        // الكميات المردودة سابقاً لكل سطر مصدر — استعلامٌ واحد لا استعلام لكل سطر.
        $alreadyReturned = ReturnLine::query()
            ->whereIn('source_line_id', $sourceLines->keys())
            ->whereHas('return', function ($q) use ($exceptReturnId) {
                $q->where('status', 'posted');
                if ($exceptReturnId) {
                    $q->where('id', '!=', $exceptReturnId);
                }
            })
            ->groupBy('source_line_id')
            ->selectRaw('source_line_id, SUM(quantity) as qty')
            ->pluck('qty', 'source_line_id');

        // كميات هذا المستند مجموعةً بسطرها — سطران يشيران للسطر نفسه يُجمعان.
        $requested = [];
        foreach ($items as $item) {
            $lineId = $item['source_line_id'] ?? null;
            if (! $lineId) {
                throw new RuntimeException('كل بند في مرتجعٍ مرتبط بفاتورة يحتاج سطره في الفاتورة.');
            }

            $sourceLine = $sourceLines->get($lineId);
            if (! $sourceLine) {
                throw new RuntimeException('البند المحدَّد لا يخصّ المستند المصدر.');
            }

            // السعر يُسقَّف ولا يُثبَّت: الردّ بأقلّ استردادٌ جزئي مشروع، والردّ
            // بأكثر ممّا قُبض يخلق ربحاً وهمياً في القيد العكسي.
            $price = (int) ($item['unit_price'] ?? 0);
            if ($price > (int) $sourceLine->unit_price) {
                throw new RuntimeException(
                    'سعر الردّ لا يتجاوز سعر البيع في الفاتورة ('
                    . Money::toRiyal($sourceLine->unit_price) . ').'
                );
            }

            $requested[$lineId] = ($requested[$lineId] ?? 0) + (int) ($item['quantity'] ?? 0);
        }

        foreach ($requested as $lineId => $qty) {
            $sold      = (int) $sourceLines[$lineId]->quantity;
            $returned  = (int) ($alreadyReturned[$lineId] ?? 0);
            $remaining = $sold - $returned;

            if ($qty > $remaining) {
                throw new RuntimeException(
                    "الكمية المردودة ({$qty}) تتجاوز المتبقي من الفاتورة ({$remaining}) لهذا البند."
                );
            }
        }
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
            // قفل الصف وإعادة فحص الحالة — يمنع الترحيل المزدوج المتزامن.
            $return = ReturnDocument::lockForUpdate()->findOrFail($return->id);
            if (! $return->isDraft()) {
                throw new RuntimeException('لا يمكن ترحيل مرتجع غير مسوّد (draft).');
            }

            // الحارس يُعاد **داخل المعاملة**: مسوّدتان أُنشئتا معاً لا تحجزان
            // كميةً، فالفحص عند الإنشاء وحده يسمح لثانيتهما بتجاوز المتبقي.
            if ($return->original_id) {
                $source = $this->resolveSource([
                    'original_id'   => $return->original_id,
                    'original_type' => $return->original_type,
                    'partner_id'    => $return->partner_id,
                    'return_date'   => $return->return_date->toDateString(),
                ], $return->type);

                if ($source) {
                    $this->assertWithinSource(
                        $source,
                        $return->lines()->get()->map(fn ($l) => [
                            'source_line_id' => $l->source_line_id,
                            'quantity'       => $l->quantity,
                            'unit_price'     => $l->unit_price,
                        ])->all(),
                        $return->id
                    );
                }
            }

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

        $subtotal = (int) $return->lines->sum(fn (ReturnLine $line) => (int) $line->line_subtotal - (int) $line->line_discount);
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

        // ═══════════════════════════════════════════════════════════════
        //  هل تعود البضاعة إلى المخزون القابل للبيع؟
        // ═══════════════════════════════════════════════════════════════
        //  المستند يعلو على السياسة: قيمةٌ صريحة عليه تُحترَم، و`null` تعني
        //  «اتبع سياسة المستأجر». والقيمة تُخزَّن عند الترحيل فيصير المستند
        //  المرحَّل شارحاً لنفسه لا مرهوناً بإعدادٍ قد يتغيّر بعده.
        $restock = $return->restock ?? (bool) Settings::get('inventory', 'restock_sales_returns');

        // مصدر الكمية بوحدة المخزون: عامل التحويل التاريخي **للسطر المصدر
        // نفسه** لا 1 المفترضة (R2). `unit_factor` لقطةٌ على `InvoiceLine` عند
        // البيع — ثابتة حتى لو تغيّر قالب وحدات المنتج أو حُذف لاحقاً، فتبقى
        // صحيحة لمرتجعٍ يصل بعد شهور. استعلامٌ واحد لكل أسطر المستند لا واحد لكل سطر.
        $sourceLineIds = $return->lines->pluck('source_line_id')->filter()->unique()->values();
        $sourceLines = $sourceLineIds->isEmpty()
            ? collect()
            : InvoiceLine::whereIn('id', $sourceLineIds)->get()->keyBy('id');

        $costTotal = 0;
        foreach ($return->lines as $line) {
            $product = $line->product;
            if (! $product || ! $product->track_inventory || $line->quantity <= 0) {
                continue;
            }

            // التكلفة بمتوسط اليوم في الحالتين — هو الأساس الذي خرجت به.
            $unitCost = $product->avg_cost;
            $baseQuantity = $this->returnLineBaseQuantity($line, $sourceLines->get($line->source_line_id));

            if ($restock) {
                $this->inventory->applyReceipt($product, $baseQuantity, $unitCost, [
                    'source_type'  => ReturnDocument::class,
                    'source_id'    => $return->id,
                    'warehouse_id' => $return->warehouse_id,
                    'branch_id'    => $return->branch_id,
                    'date'         => $return->return_date->toDateString(),
                    'notes'        => "إرجاع عبر المرتجع {$return->number}",
                ]);
            }
            // بلا إرجاع: **لا حركة مخزون إطلاقاً**. إدخالُ بضاعةٍ تالفة بكميةٍ
            // وتكلفةٍ لا وجود لهما على الرفّ يُفسد المتوسط المتحرك، فتخرج كل
            // تكلفة بضاعة مباعة لاحقة خاطئة وينكسر الثابت 1140 = Σ(كمية × متوسط).

            $costTotal += $baseQuantity * $unitCost;
        }

        $cogsEntryId = null;
        if ($costTotal > 0) {
            // الطرف المدين وحده هو ما يفترق: البضاعة العائدة أصلٌ يعود إلى
            // 1140، والتالفة **مصروفٌ لا أصل** فمحلّه 5180 فروق الجرد والتلف.
            //
            // ولماذا 5180 لا 5110: البضاعة لم تُبَع. إبقاؤها في تكلفة البضاعة
            // المباعة يُفسد هامش الربح الإجمالي ويجعل مطابقة 5110 بالمبيعات
            // مستحيلة — نفس منطق الأذون المخزنية (هجرة 000042).
            $debitAccount = $restock ? self::ACC_INVENTORY : self::ACC_DAMAGE;
            $label        = $restock ? 'عكس تكلفة مرتجع' : 'إتلاف مردود';

            $cogsEntry = $this->ledger->post([
                ['account_id' => $this->accountId($debitAccount), 'debit' => $costTotal],
                ['account_id' => $this->accountId(self::ACC_COGS), 'credit' => $costTotal],
            ], [
                'entry_date'  => $return->return_date->toDateString(),
                'description' => "{$label} {$return->number}",
                'source_type' => ReturnDocument::class,
                'source_id'   => $return->id,
            ]);
            $cogsEntryId = $cogsEntry->id;
        }

        $return->update([
            'status'           => 'posted',
            'restock'          => $restock,
            'subtotal'         => $subtotal,
            'tax_amount'       => $taxAmount,
            'total'            => $total,
            'journal_entry_id' => $entry->id,
            'cogs_entry_id'    => $cogsEntryId,
        ]);

        $this->recordExternalPosEvidenceIfApplicable($return);

        return $return->fresh('lines');
    }

    /**
     * ═══════════════════════════════════════════════════════════════
     *  R2 — كمية سطر المرتجع بوحدة المخزون
     * ═══════════════════════════════════════════════════════════════
     *  `ReturnLine.quantity` بوحدة **البيع** كما طلبها الكاشير (صندوق واحد
     *  مثلاً)، تماماً كسطر الفاتورة المصدر — لا بوحدة المخزون. المخزون سُجِّل
     *  عند البيع بوحدته عبر `InvoiceLine::baseQuantity()` (١٢ قطعة للصندوق)؛
     *  فردّ الكمية للمخزون يجب أن يستعمل **نفس عامل التحويل التاريخي**، وإلا
     *  أعاد صندوقاً واحداً إلى الرفّ بدل اثني عشر ضعف الرصيد الحقيقي.
     *
     *  المصدر وحده الموثوق: `unit_factor` على `InvoiceLine` لقطة عند البيع لا
     *  تتغيّر لو حُذف قالب الوحدات أو تغيّرت وحدة المنتج لاحقاً — ولا تُشتق من
     *  حالة المنتج الحالية أو من مدخل العميل في طلب المرتجع (العقد أصلاً لا
     *  يقبل وحدة أو معاملاً من الواجهة، انظر رأس `StorePosReturnRequest`).
     */
    private function returnLineBaseQuantity(ReturnLine $line, ?InvoiceLine $source): int
    {
        if ($source === null) {
            // لا سطر فاتورة مرتبط (مرتجع حرّ عبر API العام بلا `source_line_id`)
            // — هذا المسار لا يعرف مفهوم وحدة بيع أصلاً؛ الكمية المدخلة هي
            // كمية المخزون كما كانت دوماً قبل R2، فلا يتغيّر سلوكها.
            return (int) $line->quantity;
        }

        if ($source->quantity_numerator !== null || $source->quantity_denominator !== null) {
            // سطر نسبي (دقة كسرية، كالوقود): `PosReturnService::buildSourceItems`
            // يحسب الكمية المتبقية من `quantity` الثابتة على ١ لهذه السطور، فلا
            // ردّ ممكن غير الكل أو لا شيء — تحويل السطر المصدر بالكامل هو نفسه
            // القيمة الصحيحة الوحيدة الممكنة هنا.
            return $source->baseQuantity();
        }

        $factor = max(1, (int) ($source->unit_factor ?? 1));

        return (int) $line->quantity * $factor;
    }

    /**
     * ═══════════════════════════════════════════════════════════════
     *  PR-INV-2 — كمية سطر مرتجع الشراء بوحدة المخزون
     * ═══════════════════════════════════════════════════════════════
     *  نظير `returnLineBaseQuantity()` أعلاه تماماً، لكن لسطر الشراء المصدر
     *  (`PurchaseLine`) بدل سطر الفاتورة. `PurchaseLine` لا يملك حقلَي الكمية
     *  النسبية (`quantity_numerator`/`denominator`) أصلاً — لا سطور شراء
     *  كسرية اليوم — فلا فرع خاص بها هنا.
     *
     *  `ReturnLine.quantity` بوحدة **الشراء** كما كتبها المستخدم (كرتونٌ واحد
     *  مثلاً)، لا بوحدة المخزون؛ والمخزون استُلم عند الشراء بوحدته عبر
     *  `PurchaseLine::baseQuantity()` (٢٤ قطعة للكرتون). فإخراج الكمية من
     *  المخزون يجب أن يستعمل **نفس عامل التحويل التاريخي لسطر الشراء نفسه** —
     *  لا حالة قالب الوحدات الحالية للمنتج، ولا مدخل الواجهة (العقد لا يقبل
     *  وحدة أو معاملاً من مرتجع الشراء العام أصلاً).
     */
    private function purchaseReturnLineBaseQuantity(ReturnLine $line, ?PurchaseLine $source): int
    {
        if ($source === null) {
            // لا سطر شراء مرتبط (مرتجع حرّ بلا `source_line_id`) — الكمية
            // المدخلة هي كمية المخزون كما كانت دوماً، فلا يتغيّر سلوكها.
            return (int) $line->quantity;
        }

        $factor = max(1, (int) ($source->unit_factor ?? 1));

        return (int) $line->quantity * $factor;
    }

    /**
     * ═══════════════════════════════════════════════════════════════
     *  دليل append-only إضافي — مرتجع بيع POS خارج جلسته الأصلية
     * ═══════════════════════════════════════════════════════════════
     *  المسار المقفل بالجلسة (`PosReturnService`) يسجّل دليله عبر
     *  `PosSessionService::recordReturn` ويمرّر `pos_session_id` صريحاً؛ فلا يدخل
     *  هذا الفرع أصلاً (الشرط الأول أدناه يستبعده). هذا الفرع يخصّ **فقط** شاشة
     *  المرتجعات العامة حين يكون مصدر المرتجع فاتورة POS — أي كاشيرٍ آخر (أو مستخدم
     *  خلفي) يُرجعها خارج أي جلسة نقطة بيع فعلية.
     *
     *  الحدث يُلحَق بجلسة **البيع الأصلي** لا بجلسة القائم بالإرجاع، لأن الأخيرة لا
     *  وجود لها هنا؛ `pos_session_events.pos_session_id` عمود غير قابل للفراغ عمداً
     *  (لا حدث بلا جلسة مرجعية) — إلحاقه بالجلسة الأصلية يحافظ على هذا الثابت
     *  ويُتيح ربط الحدث بسجل تلك الجلسة نفسه. لا قيد جديد ولا رصيد يتغيّر؛ سطر
     *  append-only واحد إضافي فقط، ومصدر أدلة `cross_cashier_refund` (Phase 4).
     */
    protected function recordExternalPosEvidenceIfApplicable(ReturnDocument $return): void
    {
        if ($return->pos_session_id !== null || $return->original_type !== Invoice::class || $return->original_id === null) {
            return;
        }

        $invoice = BranchScope::reference(Invoice::class)->find($return->original_id);
        if (! $invoice || $invoice->pos_session_id === null) {
            return;
        }

        $originalSession = BranchScope::reference(PosSession::class)->find($invoice->pos_session_id);
        if (! $originalSession) {
            return;
        }

        $externalActor = $return->created_by ? User::find($return->created_by) : null;

        $this->posAudit->auditEventForExistingOperation(
            $originalSession,
            PosSessionEvent::TYPE_RETURN_RECORDED_EXTERNAL,
            $externalActor,
            [
                'return_id' => $return->id,
                'return_number' => $return->number,
                'original_id' => $invoice->id,
                'amount' => (int) $return->total,
                'performed_by' => $return->created_by,
                // لا يُطلَق `cross_cashier_refund` أبداً حين يغيب أحد الطرفين — بيانات
                // تاريخية/مفتقدة لا تُنتج نتيجة كاذبة (انظر مصفوفة فجوات Phase 4).
                'original_sale_actor_id' => $invoice->created_by,
                'return_actor_id' => $return->created_by,
            ]
        );
    }

    /**
     * مرتجع مشتريات: عكس المخزون وضريبة المدخلات والذمم الدائنة، وإخراج البضاعة.
     *
     * ═══════════════════════════════════════════════════════════════
     *  PR-INV-2 — الكمية بوحدة الأساس التاريخية + القيمة الدفترية لا التجارية
     * ═══════════════════════════════════════════════════════════════
     *  كان الإخراج يستعمل `line->quantity` مباشرة (بوحدة الشراء كما كتبها
     *  المستخدم — «كرتون» مثلاً) و`line->unit_price` كتكلفةٍ للحركة، فردّ
     *  كرتونٍ بمعامل ٢٤ كان يُخرج قطعة واحدة من المخزون، والقيمة الخارجة من
     *  1140 كانت سعر الاعتماد التجاري لا القيمة الدفترية الفعلية للمنتج.
     *
     *  الإصلاح المزدوج (يجب أن يُشحنا معاً — نفس الخروج المالي):
     *   • الكمية: `purchaseReturnLineBaseQuantity()` تحوّل بعامل `unit_factor`
     *     التاريخي **لسطر الشراء المصدر نفسه** — لا حالة المنتج الحالية ولا
     *     قالب وحدات قد يتغيّر لاحقاً (نظير `returnLineBaseQuantity()` في
     *     مرتجع المبيعات، R2).
     *   • القيمة: 1140 وحركة المخزون تُقيَّمان بـ`avg_cost` الحالي للمنتج —
     *     القيمة الدفترية الفعلية المُزالة من الرفّ والدفتر المساعد — لا بسعر
     *     الشراء/الاعتماد المُدخَل على السطر. الفرق بينهما (إن وُجد) **ليس فرق
     *     جردٍ أو تلفٍ فيزيائي** فلا يُرحَّل إلى 5180: هو فرق تقييمٍ محاسبي
     *     بحت بين اعتماد المورّد التجاري والقيمة الدفترية، فمحلّه حساب مستقل
     *     مخصَّص **5116 فروق تقييم مردودات المشتريات** (`ACC_PURCHASE_RETURN_VALUATION_VARIANCE`،
     *     المعنى المستقبلي لميزة Account Mapping: `PURCHASE_RETURN_VALUATION_VARIANCE`):
     *     دائنٌ حين الاعتماد التجاري أعلى من الدفترية (مكسب)، ومدينٌ حين أقلّ
     *     (خسارة) — يبقى القيد متوازناً دائماً بلا تغيير في
     *     `subtotal`/`tax_amount`/`total` التجارية الظاهرة للمستند (تبقى كما
     *     أُدخلت، تخصّ ذمّة المورّد لا المخزون). 5180 يبقى محصوراً بفروق
     *     الجرد والتلف والأذون المخزنية ومرتجع المبيعات التالف كما كان تماماً.
     */
    protected function postPurchaseReturn(ReturnDocument $return): ReturnDocument
    {
        $return->loadMissing('lines.product');

        // مرجع سطر الشراء المصدر — عامل التحويل الثابت وقت الشراء، لا حالة
        // قالب الوحدات الحالية. استعلامٌ واحد لكل أسطر المستند لا واحد لكل سطر.
        $sourceLineIds = $return->lines->pluck('source_line_id')->filter()->unique()->values();
        $sourcePurchaseLines = $sourceLineIds->isEmpty()
            ? collect()
            : PurchaseLine::whereIn('id', $sourceLineIds)->get()->keyBy('id');

        // القيمة التجارية (سعر الشراء/الاعتماد المُدخَل) تبني ذمّة المورّد
        // والمستند الظاهر؛ القيمة الدفترية هي ما يُزال فعلياً من 1140 والدفتر
        // المساعد. الفرق بينهما — لا أحدهما وحده — هو ما يذهب إلى 5116
        // فروق تقييم مردودات المشتريات (لا 5180: هذا فرق تقييمٍ لا تلفٌ فيزيائي).
        $inventoryCommercialTotal = 0;
        $inventoryCarryingTotal   = 0;
        $expenseTotal             = 0;
        $taxTotal                 = 0;

        foreach ($return->lines as $line) {
            $taxTotal += $line->line_tax;
            $product = $line->product;
            $commercial = (int) $line->line_subtotal - (int) $line->line_discount;

            if ($product && $product->track_inventory) {
                $inventoryCommercialTotal += $commercial;
                $baseQuantity = $this->purchaseReturnLineBaseQuantity($line, $sourcePurchaseLines->get($line->source_line_id));
                $inventoryCarryingTotal += $baseQuantity * (int) $product->avg_cost;
            } else {
                $expenseTotal += $commercial;
            }
        }

        $subtotal = $inventoryCommercialTotal + $expenseTotal;
        $total    = $subtotal + $taxTotal;
        // موجبٌ = اعتماد المورّد التجاري أعلى من القيمة الدفترية (مكسب)،
        // سالبٌ = أقلّ (خسارة). صفرٌ في كل الحالات القائمة قبل هذا الإصلاح.
        $variance = $inventoryCommercialTotal - $inventoryCarryingTotal;

        // قيد عكس الشراء: مدين 2110/1110 / دائن 1140 (بالقيمة الدفترية) +
        // دائن 5150 + دائن 1150 + فرق القيمة (إن وُجد) إلى 5116.
        $debitLine = [
            'account_id' => $this->accountId($return->payment_type === 'cash' ? self::ACC_CASH : self::ACC_PAYABLE),
            'debit'      => $total,
        ];
        if ($return->payment_type === 'credit') {
            $debitLine['partner_type'] = Partner::class;
            $debitLine['partner_id']   = $return->partner_id;
        }
        $lines = [$debitLine];

        if ($inventoryCarryingTotal > 0) {
            $lines[] = ['account_id' => $this->accountId(self::ACC_INVENTORY), 'credit' => $inventoryCarryingTotal];
        }
        if ($expenseTotal > 0) {
            $lines[] = ['account_id' => $this->accountId(self::ACC_EXPENSE), 'credit' => $expenseTotal];
        }
        if ($taxTotal > 0) {
            $lines[] = ['account_id' => $this->accountId(self::ACC_INPUT_VAT), 'credit' => $taxTotal];
        }
        if ($variance > 0) {
            $lines[] = ['account_id' => $this->accountId(self::ACC_PURCHASE_RETURN_VALUATION_VARIANCE), 'credit' => $variance];
        } elseif ($variance < 0) {
            $lines[] = ['account_id' => $this->accountId(self::ACC_PURCHASE_RETURN_VALUATION_VARIANCE), 'debit' => -$variance];
        }

        $entry = $this->ledger->post($lines, [
            'entry_date'  => $return->return_date->toDateString(),
            'description' => "مرتجع مشتريات {$return->number}",
            'source_type' => ReturnDocument::class,
            'source_id'   => $return->id,
            'created_by'  => $return->created_by,
        ]);

        // إخراج البضاعة المتابَعة من المخزون بالكمية الأساسية والقيمة الدفترية
        // (avg_cost الحالي) — لا بوحدة الشراء ولا بسعر الاعتماد التجاري.
        foreach ($return->lines as $line) {
            $product = $line->product;
            if ($product && $product->track_inventory && $line->quantity > 0) {
                $baseQuantity = $this->purchaseReturnLineBaseQuantity($line, $sourcePurchaseLines->get($line->source_line_id));
                // إرجاع للمورّد إخراجٌ من المخزون كالبيع، لكن الرصيد المقارن
                // هو رصيد المخزن المثبت على المرتجع لا إجمالي كل المستودعات.
                $this->inventory->applyIssue($product, $baseQuantity, (int) $product->avg_cost, [
                    'source_type'   => ReturnDocument::class,
                    'source_id'     => $return->id,
                    'warehouse_id'  => $return->warehouse_id,
                    'branch_id'     => $return->branch_id,
                    'enforce_stock' => true,
                    'date'          => $return->return_date->toDateString(),
                    'notes'         => "إرجاع للمورد عبر المرتجع {$return->number}",
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
        return ReturnDocument::nextDocumentNumber($type === 'sales' ? 'SRET' : 'PRET', $date);
    }
}
