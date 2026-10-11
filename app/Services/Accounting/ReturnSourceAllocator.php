<?php

namespace App\Services\Accounting;

use App\Models\CreditNoteLine;
use App\Models\Invoice;
use App\Models\InvoiceLine;
use App\Models\Purchase;
use App\Models\ReturnLine;

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
     * إشعارات دائنة **مرحَّلة سبقت REM-02** وأسطرها بلا `source_line_id`: تُنسب عند
     * القراءة إلى سطر الفاتورة الوحيد الذي يحمل منتجها (والمتغيّر إن وُجد) — دون أي
     * تعديل على صف مرحَّل. سطرٌ لا يُحسم نسبُه (بلا منتج، أو منتجه يتكرر في
     * الفاتورة) لا يُحسب هنا لأن توزيعه تخمين؛ ويُسجَّل عدّه عند هجرة التقييد
     * لمراجعة المالية. بلا هذا النسب كان إشعارٌ تاريخي كامل يُخفي استهلاكه فيُردّ
     * الشيء نفسه مرةً ثانية.
     *
     * @param  array<int, string>  $sourceLineIds
     * @return \Illuminate\Support\Collection<int, object>  صفوف بشكل صفوف التجميع في `returned()`
     */
    private function legacyCreditRows(array $sourceLineIds): \Illuminate\Support\Collection
    {
        $invoiceIds = InvoiceLine::query()->whereIn('id', $sourceLineIds)->pluck('invoice_id')->unique()->values();
        if ($invoiceIds->isEmpty()) {
            return collect();
        }

        $invoiceLines = InvoiceLine::query()->whereIn('invoice_id', $invoiceIds)
            ->get(['id', 'invoice_id', 'product_id', 'product_variant_id']);

        $legacy = CreditNoteLine::query()
            ->whereNull('source_line_id')
            ->whereNotNull('product_id')
            ->whereHas('creditNote', fn ($q) => $q->where('status', 'posted')->whereIn('original_invoice_id', $invoiceIds))
            ->with('creditNote:id,original_invoice_id')
            ->get();

        $acc = [];
        foreach ($legacy as $line) {
            $matches = $invoiceLines->filter(
                fn ($l) => $l->invoice_id === $line->creditNote->original_invoice_id
                    && $l->product_id === $line->product_id
                    && ($line->product_variant_id === null || $l->product_variant_id === $line->product_variant_id)
            );
            if ($matches->count() !== 1) {
                continue;
            }

            $target = (string) $matches->first()->id;
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

        return collect(array_values($acc))->filter(fn ($row) => in_array($row->source_line_id, $sourceLineIds, true));
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
