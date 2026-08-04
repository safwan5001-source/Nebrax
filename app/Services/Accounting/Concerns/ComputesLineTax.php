<?php

namespace App\Services\Accounting\Concerns;

/**
 * احتساب ضريبة السطر — أعداد صحيحة بالهللات، بلا float. مصدر واحد يعيد استخدامه
 * كل مستند يحسب الضريبة (عرض سعر/مشتريات…). الصيغ تطابق `InvoiceService` حرفياً
 * فتتّسق الإجماليات عبر المنظومة.
 */
trait ComputesLineTax
{
    /** ضريبة مضافة فوق مبلغ غير متضمّن — round(base × rate ÷ 100). */
    protected function addTax(int $base, int $rate): int
    {
        if ($rate <= 0 || $base <= 0) {
            return 0;
        }

        return intdiv($base * $rate + 50, 100);
    }

    /** ضريبة مستخرَجة من مبلغ متضمّن — round(inclusive × rate ÷ (100+rate)). */
    protected function extractTax(int $inclusive, int $rate): int
    {
        if ($rate <= 0 || $inclusive <= 0) {
            return 0;
        }

        $denom = 100 + $rate;

        return intdiv(2 * $inclusive * $rate + $denom, 2 * $denom);
    }

    /**
     * يحسب (الأساس الخاضع الصافي، الضريبة) لسطر من مبلغه الإجمالي حسب الوضع:
     * متضمّن → يُستخرَج؛ غير متضمّن → يُضاف.
     *
     * @return array{0:int,1:int}  [net, tax]
     */
    protected function splitLineTax(int $lineGross, int $rate, bool $inclusive): array
    {
        if ($inclusive) {
            $tax = $this->extractTax($lineGross, $rate);
            return [$lineGross - $tax, $tax];
        }

        return [$lineGross, $this->addTax($lineGross, $rate)];
    }
}
