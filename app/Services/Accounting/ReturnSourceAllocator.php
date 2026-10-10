<?php

namespace App\Services\Accounting;

use App\Models\Invoice;
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
     * ما رُدَّ سابقاً على كل سطر مصدر — من المرتجعات **المرحَّلة** وحدها.
     *
     * @param  array<int, string>  $sourceLineIds
     * @return array<string, array{quantity:int, subtotal:int, discount:int, net:int, tax:int}>
     */
    public function returned(array $sourceLineIds, ?string $exceptReturnId = null): array
    {
        if ($sourceLineIds === []) {
            return [];
        }

        $rows = ReturnLine::query()
            ->whereIn('source_line_id', $sourceLineIds)
            ->whereHas('return', function ($q) use ($exceptReturnId) {
                $q->where('status', 'posted');
                if ($exceptReturnId) {
                    $q->where('id', '!=', $exceptReturnId);
                }
            })
            ->groupBy('source_line_id')
            ->selectRaw(
                'source_line_id, SUM(quantity) as qty, SUM(line_subtotal) as subtotal, '
                . 'SUM(line_discount) as discount, SUM(line_tax) as tax'
            )
            ->get();

        $out = [];
        foreach ($rows as $row) {
            $out[$row->source_line_id] = [
                'quantity' => (int) $row->qty,
                'subtotal' => (int) $row->subtotal,
                'discount' => (int) $row->discount,
                'net'      => (int) $row->subtotal - (int) $row->discount,
                'tax'      => (int) $row->tax,
            ];
        }

        return $out;
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
     * @param  array{quantity:int, unit_price:int, subtotal:int, discount:int, net:int, tax:int}  $charged
     * @param  array{quantity?:int, subtotal?:int, discount?:int, net?:int, tax?:int}  $returned
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
        if ($sourcePrice > 0 && $unitPrice < $sourcePrice) {
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
