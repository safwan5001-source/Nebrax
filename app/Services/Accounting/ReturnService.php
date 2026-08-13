<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\Invoice;
use App\Models\Partner;
use App\Models\Purchase;
use App\Models\ReturnDocument;
use App\Models\ReturnLine;
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
 *    مدين 2110/1110 (الإجمالي) │ دائن 1140 المخزون + دائن 5150 + دائن 1150 ضريبة المدخلات
 *    وللبضاعة المتابَعة: إخراج من المخزون.
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
    private const ACC_DAMAGE      = '5180'; // فروق الجرد والتلف

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
                'payment_type'  => $data['payment_type'] ?? 'credit',
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

                $lineSubtotal = $qty * $unitPrice;
                $lineTax      = $this->calcTax($lineSubtotal, $rate);

                ReturnLine::create([
                    'return_id'      => $return->id,
                    'product_id'     => $item['product_id'] ?? null,
                    'source_line_id' => $item['source_line_id'] ?? null,
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

        // ═══════════════════════════════════════════════════════════════
        //  هل تعود البضاعة إلى المخزون القابل للبيع؟
        // ═══════════════════════════════════════════════════════════════
        //  المستند يعلو على السياسة: قيمةٌ صريحة عليه تُحترَم، و`null` تعني
        //  «اتبع سياسة المستأجر». والقيمة تُخزَّن عند الترحيل فيصير المستند
        //  المرحَّل شارحاً لنفسه لا مرهوناً بإعدادٍ قد يتغيّر بعده.
        $restock = $return->restock ?? (bool) Settings::get('inventory', 'restock_sales_returns');

        $costTotal = 0;
        foreach ($return->lines as $line) {
            $product = $line->product;
            if (! $product || ! $product->track_inventory || $line->quantity <= 0) {
                continue;
            }

            // التكلفة بمتوسط اليوم في الحالتين — هو الأساس الذي خرجت به.
            $unitCost = $product->avg_cost;

            if ($restock) {
                $this->inventory->applyReceipt($product, $line->quantity, $unitCost, [
                    'source_type' => ReturnDocument::class,
                    'source_id'   => $return->id,
                    'date'        => $return->return_date->toDateString(),
                    'notes'       => "إرجاع عبر المرتجع {$return->number}",
                ]);
            }
            // بلا إرجاع: **لا حركة مخزون إطلاقاً**. إدخالُ بضاعةٍ تالفة بكميةٍ
            // وتكلفةٍ لا وجود لهما على الرفّ يُفسد المتوسط المتحرك، فتخرج كل
            // تكلفة بضاعة مباعة لاحقة خاطئة وينكسر الثابت 1140 = Σ(كمية × متوسط).

            $costTotal += $line->quantity * $unitCost;
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
                // إرجاع للمورّد إخراجٌ من المخزون كالبيع — فيخضع لسياسة
                // «البيع بلا رصيد» نفسها: لا يُرَدّ ما ليس موجوداً.
                $this->inventory->assertStockAvailable($product, $line->quantity);

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
