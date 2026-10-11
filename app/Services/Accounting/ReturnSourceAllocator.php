<?php

namespace App\Services\Accounting;

use App\Models\CreditNoteLegacyReview;
use App\Models\CreditNoteLine;
use App\Models\Invoice;
use App\Models\InvoiceLine;
use App\Models\Purchase;
use App\Models\ReturnLine;
use App\Tenancy\BranchScope;

/**
 * ═══════════════════════════════════════════════════════════════
 *  REM-01 — ما حُصِّل فعلاً على سطر المصدر، وما يُرَدّ منه
 * ═══════════════════════════════════════════════════════════════
 *  المرتجع المرتبط بمستندٍ مصدر لا يُعيد احتساب الضريبة من السعر الذي يرسله
 *  العميل؛ يرث من **سطر المصدر المرحَّل** أساسه الخاضع الصافي وضريبته، بعد
 *  خصم السطر وحصة السطر من خصم الرأس، ثم يوزّعهما بالكمية:
 *
 *    نصيب مرتجعٍ يبدأ بعد `c` وحدة سبق ردّها ويردّ `q`:  F(c+q) − F(c)،
 *    حيث F(n) = floor(المحصَّل × n ÷ المباع) وF(المباع) = المحصَّل. المجموع
 *    متداخلٌ تلسكوبياً، فمهما قُسِّمت الكمية وبأي ترتيب: Σ الأنصبة = المحصَّل
 *    بالضبط (7 × 0.10 → 0.11 لا 0.14)، وبقايا الهللات تسقط على آخر وحدة.
 *    ولأن النصيب دالّة كميات لا مبالغ، فاسترداد سابق بسعر مخفَّض لا يعيد
 *    «الفرق المحتجَز» إلى المرتجع الأخير.
 *
 *  والمصدر لا يُعدَّل أبداً: كل ما هنا قراءةٌ للأسطر المثبتة وإعادة اشتقاق
 *  حتمية لحصة خصم الرأس، بالخوارزمية نفسها التي يشتق بها `post()` إجمالياته.
 *
 *  **النطاق:** سطور البضاعة/الخدمة فقط. شحن المستند وتسويته ليسا سطوراً فلا
 *  يُرَدّان بسطر (وضريبة الشحن لا تدخل سقف الأسطر — تحفّظٌ لا يُفرط في الردّ).
 *
 *  كل المبالغ أعدادٌ صحيحة بالهللات، بلا float.
 */
class ReturnSourceAllocator
{
    use ComputesLineTax;

    /**
     * ما حُصِّل فعلاً على كل سطر مصدر.
     *
     * - `subtotal`: الأساس قبل خصم الرأس (بعد خصم السطر) — بالصافي دوماً.
     * - `discount`: كل ما خُفِّض عن `subtotal` ليبلغ `net` (خصم السطر + حصة الرأس
     *   للفاتورة؛ حصة الرأس وحدها للمشتريات التي يُخزَّن سطرها صافياً بعد خصمه).
     * - `net`: الأساس الخاضع الصافي المحصَّل = ما أُقفل في الإيراد/المخزون.
     * - `tax`: ضريبة السطر المحصَّلة بعد خصم الرأس. Σ الأسطر = ضريبة البضاعة
     *   المرحَّلة للمستند (بلا ضريبة الشحن).
     *
     * @return array<string, array{quantity:int, unit_price:int, tax_rate:int, subtotal:int, discount:int, net:int, tax:int}>
     */
    public function charged(Invoice|Purchase $source): array
    {
        $lines = $source->lines()->orderBy('id')->get();

        $isInvoice = $source instanceof Invoice;
        $subtotals = [];
        foreach ($lines as $line) {
            // الفاتورة تُخزّن line_subtotal قبل خصم السطر، والمشتريات بعده.
            $subtotals[$line->id] = $isInvoice
                ? max(0, (int) $line->line_subtotal - (int) $line->line_discount)
                : max(0, (int) $line->line_subtotal);
        }

        $sumSubtotal = array_sum($subtotals);
        $headerDiscount = min(max(0, (int) $source->discount), $sumSubtotal);
        $shares = $this->apportion($headerDiscount, $subtotals);

        $sumTax = (int) $lines->sum(fn ($line) => (int) $line->line_tax);
        $netSales = $sumSubtotal - $headerDiscount;
        // نفس معادلة `InvoiceService::applyDiscount` و`PurchaseService::applyHeadAdjustments`
        // (بلا شحن): ضريبة البضاعة الصافية بعد خصم الرأس.
        $goodsTax = $sumSubtotal > 0 ? $this->mulDiv($sumTax, $netSales, $sumSubtotal)[0] : 0;
        $taxes = $this->apportion(
            $goodsTax,
            $lines->mapWithKeys(fn ($line) => [$line->id => max(0, (int) $line->line_tax)])->all()
        );

        $out = [];
        foreach ($lines as $line) {
            $net = $subtotals[$line->id] - ($shares[$line->id] ?? 0);
            $storedGross = (int) $line->line_subtotal;
            $out[$line->id] = [
                'quantity'   => (int) $line->quantity,
                'unit_price' => (int) $line->unit_price,
                'tax_rate'   => (int) $line->tax_rate,
                'subtotal'   => $storedGross,
                'discount'   => $isInvoice
                    ? (int) $line->line_discount + ($shares[$line->id] ?? 0)
                    : ($shares[$line->id] ?? 0),
                'net'        => $net,
                'tax'        => min($taxes[$line->id] ?? 0, (int) $line->line_tax),
            ];
        }

        return $out;
    }

    /**
     * ما رُدَّ أو خُصم سابقاً على كل سطر مصدر — من المستندات **المرحَّلة** وحدها:
     * المرتجعات، **والإشعارات الدائنة المربوطة بسطر** (AWJ-TAX-REM-02). الاثنان
     * يستهلكان الكمية والأساس والضريبة المحصَّلة نفسها، فيُجمعان في سقفٍ واحد؛
     * وإلا ردّ مرتجعٌ ما خصمه إشعار (أو العكس) فتجاوز مجموعهما ما حُصِّل.
     *
     * @param  array<int, string>  $sourceLineIds
     * @param  string|null  $exceptReturnId  مرتجعٌ يُستثنى (يُعاد اشتقاقه الآن)
     * @param  string|null  $exceptCreditNoteId  إشعارٌ يُستثنى (يُعاد اشتقاقه الآن)
     * @return array<string, array{quantity:int, subtotal:int, discount:int, net:int, tax:int, min_price:int}>
     */
    public function returned(array $sourceLineIds, ?string $exceptReturnId = null, ?string $exceptCreditNoteId = null): array
    {
        if ($sourceLineIds === []) {
            return [];
        }

        $select = 'source_line_id, SUM(quantity) as qty, SUM(line_subtotal) as subtotal, '
            . 'SUM(line_discount) as discount, SUM(line_tax) as tax, MIN(unit_price) as min_price';

        $rows = ReturnLine::query()
            ->whereIn('source_line_id', $sourceLineIds)
            ->whereHas('return', function ($q) use ($exceptReturnId) {
                $q->where('status', 'posted');
                if ($exceptReturnId) {
                    $q->where('id', '!=', $exceptReturnId);
                }
            })
            ->groupBy('source_line_id')
            ->selectRaw($select)
            ->get();

        $noteRows = CreditNoteLine::query()
            ->whereIn('source_line_id', $sourceLineIds)
            ->whereHas('creditNote', function ($q) use ($exceptCreditNoteId) {
                $q->where('status', 'posted');
                if ($exceptCreditNoteId) {
                    $q->where('id', '!=', $exceptCreditNoteId);
                }
            })
            ->groupBy('source_line_id')
            ->selectRaw($select)
            ->get();

        $out = [];
        foreach ($rows->concat($noteRows)->concat($this->legacyCreditRows($sourceLineIds)) as $row) {
            $prior = $out[$row->source_line_id] ?? null;
            $subtotal = (int) $row->subtotal + ($prior['subtotal'] ?? 0);
            $discount = (int) $row->discount + ($prior['discount'] ?? 0);
            $out[$row->source_line_id] = [
                'quantity' => (int) $row->qty + ($prior['quantity'] ?? 0),
                'subtotal' => $subtotal,
                'discount' => $discount,
                'net'      => $subtotal - $discount,
                'tax'      => (int) $row->tax + ($prior['tax'] ?? 0),
                // أدنى سعر ردٍّ سابق على السطر — يكشف الاسترداد بسعر مخفَّض.
                'min_price' => isset($prior['min_price']) ? min($prior['min_price'], (int) $row->min_price) : (int) $row->min_price,
            ];
        }

        return $out;
    }

    /**
     * إشعارات دائنة **مرحَّلة سبقت REM-02** وأسطرها بلا `source_line_id` — تُستهلك في
     * السقف التراكمي دون تعديل أي صف مرحَّل. التصنيف في {@see legacyCreditLines()}.
     *
     * @param  array<int, string>  $sourceLineIds
     * @return \Illuminate\Support\Collection<int, object>  صفوف بشكل صفوف التجميع في `returned()`
     */
    private function legacyCreditRows(array $sourceLineIds): \Illuminate\Support\Collection
    {
        $invoiceIds = InvoiceLine::query()->whereIn('id', $sourceLineIds)->pluck('invoice_id')->unique()->values()->all();

        $acc = [];
        foreach ($this->legacyCreditLines($invoiceIds) as $item) {
            if ($item['status'] !== 'attributed' || ! in_array($item['target'], $sourceLineIds, true)) {
                continue;
            }

            $line = $item['line'];
            $target = (string) $item['target'];
            $acc[$target] ??= (object) [
                'source_line_id' => $target, 'qty' => 0, 'subtotal' => 0, 'discount' => 0, 'tax' => 0,
                'min_price' => (int) $line->unit_price,
            ];
            $acc[$target]->qty += (int) $line->quantity;
            $acc[$target]->subtotal += (int) $line->line_subtotal;
            $acc[$target]->discount += (int) $line->line_discount;
            $acc[$target]->tax += (int) $line->line_tax;
            $acc[$target]->min_price = min($acc[$target]->min_price, (int) $line->unit_price);
        }

        return collect(array_values($acc));
    }

    /**
     * ═══════════════════════════════════════════════════════════════
     *  تصنيف أسطر الإشعارات التاريخية (مرحَّلة، بلا `source_line_id`) على فواتير
     * ═══════════════════════════════════════════════════════════════
     *  لكل سطر قرارٌ واحد من ثلاثة، بهذا الترتيب:
     *   1. **قرار مراجعة المالية** (`CreditNoteLegacyReview`) إن وُجد: `attributed` ⇒ يُنسب
     *      إلى السطر الذي حدّدته المالية (يُشترط أن يكون من الفاتورة نفسها)، و
     *      `not_applicable` ⇒ `ignored` (لا يستهلك سطراً).
     *   2. **نسب آلي** إن كان للسطر منتج وسطر الفاتورة الحامل له (والمتغيّر إن حُدِّد)
     *      وحيداً، وطرف الإشعار هو مالك الفاتورة ⇒ `attributed`.
     *   3. غير ذلك (بلا منتج، أو منتجه يتكرر، أو طرف الإشعار غير مالك الفاتورة) ⇒ `unresolved`: لا يُخمَّن، وتُحظر العمليات
     *      المتأثرة على الفاتورة حتى تراجعه المالية ({@see assertNoUnresolvedLegacyCredits()}).
     *
     * @param  array<int, string>  $invoiceIds
     * @return list<array{line: CreditNoteLine, invoice_id: string, status: string, target: ?string}>
     */
    public function legacyCreditLines(array $invoiceIds): array
    {
        $invoiceIds = array_values(array_unique(array_filter($invoiceIds)));
        if ($invoiceIds === []) {
            return [];
        }

        $legacy = CreditNoteLine::query()
            ->whereNull('source_line_id')
            ->whereHas('creditNote', fn ($q) => $q->where('status', 'posted')->whereIn('original_invoice_id', $invoiceIds))
            ->with('creditNote:id,number,original_invoice_id,partner_id')
            ->get();
        if ($legacy->isEmpty()) {
            return [];
        }

        // مالك كل فاتورة: إشعارٌ تاريخي مربوطٌ بفاتورة طرفٍ آخر (شذوذٌ تسمح به وتسجّله
        // ترحيلة التقييد، `other_customer`) لا يُنسب آلياً إلى تلك الفاتورة فيستهلك سقف
        // عميلها الحقيقي — يُصنَّف غير محسوم لتراجعه المالية.
        $invoiceOwners = BranchScope::reference(Invoice::class)->whereIn('id', $invoiceIds)->pluck('partner_id', 'id');

        $invoiceLines = InvoiceLine::query()->whereIn('invoice_id', $invoiceIds)
            ->get(['id', 'invoice_id', 'product_id', 'product_variant_id']);
        $reviews = CreditNoteLegacyReview::query()->whereIn('credit_note_line_id', $legacy->pluck('id'))->get()
            ->keyBy('credit_note_line_id');

        $out = [];
        foreach ($legacy as $line) {
            $invoiceId = (string) $line->creditNote->original_invoice_id;
            $review = $reviews->get($line->id);

            if ($review !== null) {
                $valid = $review->outcome === CreditNoteLegacyReview::ATTRIBUTED
                    && $invoiceLines->contains(fn ($l) => $l->id === $review->source_line_id && $l->invoice_id === $invoiceId);
                $status = $review->outcome === CreditNoteLegacyReview::NOT_APPLICABLE
                    ? 'ignored'
                    : ($valid ? 'attributed' : 'unresolved');
                $out[] = ['line' => $line, 'invoice_id' => $invoiceId, 'status' => $status,
                    'target' => $valid ? (string) $review->source_line_id : null];

                continue;
            }

            $foreignOwner = $line->creditNote->partner_id !== null
                && $invoiceOwners->get($invoiceId) !== null
                && (string) $line->creditNote->partner_id !== (string) $invoiceOwners->get($invoiceId);

            $matches = ($line->product_id === null || $foreignOwner) ? collect() : $invoiceLines->filter(
                fn ($l) => $l->invoice_id === $invoiceId
                    && $l->product_id === $line->product_id
                    && ($line->product_variant_id === null || $l->product_variant_id === $line->product_variant_id)
            );
            $out[] = $matches->count() === 1
                ? ['line' => $line, 'invoice_id' => $invoiceId, 'status' => 'attributed', 'target' => (string) $matches->first()->id]
                : ['line' => $line, 'invoice_id' => $invoiceId, 'status' => 'unresolved', 'target' => null];
        }

        return $out;
    }

    /**
     * عدد الأسطر غير المحسومة لكل فاتورة (الفواتير الخالية منها لا تظهر في الناتج).
     *
     * @param  array<int, string>  $invoiceIds
     * @return array<string, int>
     */
    public function unresolvedLegacyCounts(array $invoiceIds): array
    {
        $counts = [];
        foreach ($this->legacyCreditLines($invoiceIds) as $item) {
            if ($item['status'] === 'unresolved') {
                $counts[$item['invoice_id']] = ($counts[$item['invoice_id']] ?? 0) + 1;
            }
        }

        return $counts;
    }

    /**
     * حظرٌ محدّد: فاتورةٌ عليها إشعارات دائنة مرحَّلة قديمة غير قابلة للربط بسطر بلا تخمين
     * لا تقبل عكساً إضافياً (إشعاراً أو مرتجعاً أو مرتجع POS) حتى تراجعها المالية. المصدر
     * الشراء لا يتأثر. لا يُعدَّل أي مستند مرحَّل؛ مسار المراجعة: `credit-notes:legacy-review`.
     */
    public function assertNoUnresolvedLegacyCredits(Invoice|Purchase $source): void
    {
        if (! $source instanceof Invoice) {
            return;
        }

        $count = $this->unresolvedLegacyCounts([(string) $source->id])[(string) $source->id] ?? 0;
        if ($count > 0) {
            throw new \RuntimeException(
                "على الفاتورة {$source->number} {$count} سطر/أسطر إشعارٍ دائن مرحَّل قديم لا يُنسب إلى سطر بعينه في الفاتورة؛ "
                . 'لا يُسمح بإشعار دائن أو مرتجع إضافي عليها حتى تراجعها المالية (credit-notes:legacy-review).'
            );
        }
    }

    /**
     * يشتق مبالغ ردّ `$quantity` من سطر مصدر.
     *
     * `$returned` هو ما رُدَّ فعلاً (مرحَّلاً، وما سبق في الطلب نفسه): كميته تحدّد
     * موضع هذا الجزء في التوزيع، ومبالغه تقيّد السقف. النتيجة لا تتجاوز المتبقي
     * من الأساس أو الضريبة المحصَّلين مهما كان `$returned` — بما فيه مرتجعات
     * تاريخية سبقت هذا الإصلاح.
     *
     * `$unitPrice` سقفُ سعرٍ لا مدخل حساب: الردّ بأقلّ من سعر البيع استردادٌ
     * جزئي مشروع، فيُخفَّض المشتقّ تناسبياً؛ والمساوي (أو الأعلى، ويرفضه
     * الحارس) يأخذ الاشتقاق الكامل.
     *
     * **الجزء الأخير:** المرتجع الذي يستنفد الكمية المتبقية بسعر كامل يأخذ
     * **المتبقي الفعلي** (`المحصَّل − المرتَدّ`) لا نصيب التوزيع، فتُغلق أي هللات
     * خلّفتها مرتجعات سابقة بقاعدة توزيع أخرى (مرتجعات POS تقرّب كل جزء لأسفل
     * بمعزل عن سابقه). ويُستثنى حين سبق على السطر ردٌّ بسعر مخفَّض: الفرق
     * المحتجَز عندئذ (رسوم إعادة تخزين مثلاً) قرارٌ تجاري لا يُردّ مع الجزء الأخير.
     *
     * @param  array{quantity:int, unit_price:int, subtotal:int, discount:int, net:int, tax:int}  $charged
     * @param  array{quantity?:int, subtotal?:int, discount?:int, net?:int, tax?:int, min_price?:int}  $returned
     * @return array{subtotal:int, discount:int, net:int, tax:int}
     */
    public function allocate(array $charged, array $returned, int $quantity, int $unitPrice): array
    {
        $sold = max(1, $charged['quantity']);
        $before = (int) ($returned['quantity'] ?? 0);

        $part = fn (string $field): int => $this->cumulative($charged[$field], $sold, $before + $quantity)
            - $this->cumulative($charged[$field], $sold, $before);

        $net = $part('net');
        $tax = $part('tax');
        $discount = $part('discount');

        $sourcePrice = $charged['unit_price'];
        $isFinal = $before + $quantity >= $sold;
        $reducedBefore = $sourcePrice > 0
            && isset($returned['min_price'])
            && (int) $returned['min_price'] < $sourcePrice;

        if ($isFinal && ! $reducedBefore && ($sourcePrice <= 0 || $unitPrice >= $sourcePrice)) {
            // المتبقي الفعلي — غير سالب أبداً، فمرتجعٌ سابق زائد (تاريخي) يترك صفراً.
            $net = max(0, $charged['net'] - (int) ($returned['net'] ?? 0));
            $tax = max(0, $charged['tax'] - (int) ($returned['tax'] ?? 0));
            $discount = max(0, $charged['discount'] - (int) ($returned['discount'] ?? 0));
        } elseif ($sourcePrice > 0 && $unitPrice < $sourcePrice) {
            $unitPrice = max(0, $unitPrice);
            $net = $this->mulDiv($net, $unitPrice, $sourcePrice)[0];
            $tax = $this->mulDiv($tax, $unitPrice, $sourcePrice)[0];
            $discount = $this->mulDiv($discount, $unitPrice, $sourcePrice)[0];
        }

        // الحدّ التراكمي صراحةً لا اتكالاً على الاشتقاق وحده: مرتجعاتٌ تاريخية
        // (سبقت هذا الإصلاح) أو مختلطة قد تكون استهلكت أكثر من نصيبها.
        $net = min($net, max(0, $charged['net'] - (int) ($returned['net'] ?? 0)));
        $tax = min($tax, max(0, $charged['tax'] - (int) ($returned['tax'] ?? 0)));

        return [
            'subtotal' => $net + $discount,
            'discount' => $discount,
            'net'      => $net,
            'tax'      => $tax,
        ];
    }

    /**
     * سعر الوحدة قبل الضريبة لسطر مصدر — يُعرض للواجهة، ولا يدخل الحساب.
     */
    public function unitPriceBeforeTax(object $sourceLine, bool $inclusive): int
    {
        $stored = $sourceLine->unit_price_before_tax ?? null;
        if ($stored !== null) {
            return (int) $stored;
        }

        $price = (int) $sourceLine->unit_price;

        return $inclusive ? $price - $this->extractTax($price, (int) $sourceLine->tax_rate) : $price;
    }

    /**
     * سعر الوحدة قبل الضريبة عند سعر ردٍّ `$price`: سعر المصدر قبل الضريبة، مخفَّضاً
     * تناسبياً إن كان `$price` أقل من سعر السطر (استردادٌ جزئي). للعرض والطباعة فقط.
     */
    public function unitPriceBeforeTaxAt(object $sourceLine, bool $inclusive, int $price): int
    {
        $base = $this->unitPriceBeforeTax($sourceLine, $inclusive);
        $source = (int) $sourceLine->unit_price;

        return $source > 0 && $price < $source ? $this->mulDiv($base, max(0, $price), $source)[0] : $base;
    }

    /** F(n): نصيب أول n وحدة من `$amount` المباع منه `$sold` — والمباع كلّه يأخذ المبلغ كاملاً. */
    private function cumulative(int $amount, int $sold, int $units): int
    {
        if ($units >= $sold) {
            return $amount;
        }

        return $this->mulDiv($amount, max(0, $units), $sold)[0];
    }

    /**
     * توزيع `$total` على `$weights` بطريقة «أكبر البقايا»: كل حصة تبعد أقلّ من
     * هللة عن نصيبها النسبي، ومجموعها = `$total` تماماً، والتعادل يُحسم بترتيب
     * الإدخال. الأوزان غير الموجبة لا تأخذ شيئاً.
     *
     * @param  array<string, int>  $weights
     * @return array<string, int>
     */
    private function apportion(int $total, array $weights): array
    {
        $shares = array_fill_keys(array_keys($weights), 0);
        $sum = array_sum($weights);
        if ($total <= 0 || $sum <= 0) {
            return $shares;
        }

        $remainders = [];
        $allocated = 0;
        foreach ($weights as $key => $weight) {
            [$shares[$key], $remainders[$key]] = $this->mulDiv($total, $weight, $sum);
            $allocated += $shares[$key];
        }

        $leftover = $total - $allocated;
        if ($leftover > 0) {
            arsort($remainders);
            foreach (array_keys($remainders) as $key) {
                if ($leftover <= 0) {
                    break;
                }
                if ($weights[$key] > 0) {
                    $shares[$key]++;
                    $leftover--;
                }
            }
        }

        return $shares;
    }

    /**
     * `[floor(a×b÷c), (a×b) mod c]` بأعدادٍ صحيحة. حاصل الضرب الذي يتجاوز نطاق
     * `int` يتحوّل في PHP صامتاً إلى float فيُفسد الهللات؛ فيُفكَّك أولاً، وإن
     * تعذّر التفكيك يُرفض صراحةً — لا يُقرَّب مالٌ بصمت.
     *
     * @return array{0:int, 1:int}
     */
    private function mulDiv(int $a, int $b, int $c): array
    {
        if ($a === 0 || $b === 0) {
            return [0, 0];
        }
        if ($a <= intdiv(PHP_INT_MAX, $b)) {
            $product = $a * $b;

            return [intdiv($product, $c), $product % $c];
        }

        // a = q×c + r  ⇒  a×b÷c = q×b + (r×b)÷c، وr < c.
        $q = intdiv($a, $c);
        $r = $a % $c;
        if ($r !== 0 && $r > intdiv(PHP_INT_MAX, $b)) {
            throw new \RuntimeException('مبلغ المستند المصدر أكبر من أن يُوزَّع بدقة الهللة.');
        }
        $tail = $r * $b;

        return [$q * $b + intdiv($tail, $c), $tail % $c];
    }
}
