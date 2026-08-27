<?php

namespace App\Models\Concerns;

use LogicException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  تحويل كمية السطر إلى وحدة المخزون
 * ═══════════════════════════════════════════════════════════════
 *  السطر يحفظ الكمية **بالوحدة المُدخَلة** وسعرها بها، فيبقى
 *  `line_subtotal = quantity × unit_price` صحيحاً بلا كسر. والمخزون لا يعرف
 *  إلا وحدة الأساس، فيُضرب هنا وهنا فقط.
 *
 *  **لا يُحوَّل أي مبلغ.** تحويل السعر إلى وحدة الأساس كان يقسم على المعامل
 *  فيضيع الباقي: ١٠٠ ريال ÷ ٣ = ٣٣٣٣٫٣٣ هللة. الكمية عدد صحيح والضرب فيها
 *  آمن دائماً؛ القسمة على النقود ليست كذلك.
 */
trait HasUnitConversion
{
    /**
     * الكمية بوحدة المخزون. المعامل الغائب أو الصفري يُقرأ ١ — سطرٌ قديم أو
     * سطرٌ بلا وحدة يبقى كما كان بالضبط. السطر النسبي يحوّل أولاً بالبسط
     * والمقام، فلا يصبح نصف عبوة بمعامل 10 عشر وحدات عند ترحيل المخزون.
     */
    public function baseQuantity(): int
    {
        $factor = max(1, (int) ($this->unit_factor ?? 1));
        $hasNumerator = $this->quantity_numerator !== null;
        $hasDenominator = $this->quantity_denominator !== null;
        if (! $hasNumerator && ! $hasDenominator) {
            return (int) $this->quantity * $factor;
        }
        if (! $hasNumerator || ! $hasDenominator) {
            throw new LogicException('الكمية النسبية تحتاج بسطاً ومقاماً معاً لتحويلها إلى وحدة المخزون.');
        }

        $numerator = (int) $this->quantity_numerator;
        $denominator = (int) $this->quantity_denominator;
        if ($numerator <= 0 || $denominator <= 0 || $numerator > intdiv(PHP_INT_MAX, $factor)) {
            throw new LogicException('الكمية النسبية لا يمكن تحويلها بأمان إلى وحدة المخزون.');
        }

        $baseNumerator = $numerator * $factor;
        if ($baseNumerator % $denominator !== 0) {
            throw new LogicException('الكمية النسبية لا تمثل عدداً صحيحاً من وحدات المخزون.');
        }

        return intdiv($baseNumerator, $denominator);
    }
}
