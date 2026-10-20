<?php

namespace App\Support;

use InvalidArgumentException;

/**
 * سطر إشعار دائن لـ ZATCA كما خُزِّن — REM-18a. قيمة ثابتة (value object) مدخلاتها صريحة؛ لا نموذج ولا قاعدة بيانات.
 *
 * كل المبالغ هللات صحيحة (لا float). الصنف **لا يحسب شيئاً**: يتحقق فقط أن المبالغ المُسلَّمة متّسقة داخلياً
 * (صافي = إجمالي السطر − الخصم، وإجمالي مع الضريبة = صافي + ضريبة) فيرفض مدخلاً متناقضاً بدل أن يُخرج XML متناقضاً.
 * هذا هو الشكل الذي يكتبه `CreditNoteService` فعلاً (`line_total = alloc.net + alloc.tax`).
 */
final class ZatcaCreditNoteLine
{
    public function __construct(
        public readonly ?string $description,
        public readonly int $quantity,
        /** سعر الوحدة **قبل الضريبة** (BT-146) كما خُزِّن في `unit_price_before_tax`؛ لا يُستخرج هنا من سعر شامل. */
        public readonly int $unitPriceNet,
        public readonly int $taxRate,
        public readonly int $lineSubtotal,
        public readonly int $lineDiscount,
        public readonly int $lineTax,
        public readonly int $lineTotal,
    ) {
        if ($quantity < 1) {
            throw new InvalidArgumentException('كمية سطر الإشعار يجب أن تكون عدداً صحيحاً موجباً.');
        }
        if ($unitPriceNet < 0) {
            throw new InvalidArgumentException('سعر وحدة سطر الإشعار قبل الضريبة لا يكون سالباً.');
        }
        if ($taxRate < 0 || $taxRate > 100) {
            throw new InvalidArgumentException('معدل ضريبة سطر الإشعار خارج 0–100.');
        }
        if ($lineSubtotal < 0 || $lineDiscount < 0 || $lineTax < 0 || $lineTotal < 0) {
            throw new InvalidArgumentException('مبالغ الإشعار الدائن في XML موجبة؛ مبلغ سالب في سطر الإشعار مرفوض.');
        }
        if ($lineDiscount > $lineSubtotal) {
            throw new InvalidArgumentException('خصم سطر الإشعار يتجاوز إجمالي السطر.');
        }
        if ($lineTotal !== $lineSubtotal - $lineDiscount + $lineTax) {
            throw new InvalidArgumentException('مبالغ سطر الإشعار غير متّسقة: الإجمالي ≠ الصافي + الضريبة.');
        }
    }

    /** الصافي بعد خصم السطر (BT-131). */
    public function net(): int
    {
        return $this->lineSubtotal - $this->lineDiscount;
    }
}
