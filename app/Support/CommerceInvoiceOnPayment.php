<?php

namespace App\Support;

/**
 * H4-03 / D-13 (خيار A المعتمد): توقيت إصدار فاتورة طلب المتجر الإلكتروني = عند تأكيد الدفع (`ON_PAYMENT_CONFIRMED`)، قابل للضبط لكل مستأجر.
 *
 * **ثلاثة شروط معاً لتفعيل الأثر المحاسبي** (مغلق افتراضياً، لا يتغيّر شيء بنشر الكود):
 *  1) بوابة النشر `payments.commerce_invoice_on_payment` (env `PAYMENTS_COMMERCE_INVOICE_ON_PAYMENT_ENABLED`) **ومعها مرجع الرأي الضريبي EXT-05**
 *     (`PAYMENTS_COMMERCE_INVOICE_TAX_OPINION_REF` غير فارغ) — وإزالة المرجع تعيد الإغلاق فوراً (نفس نمط `fee_tax_opinion_ref`).
 *  2) سياسة المستأجر `sales.commerce_invoice_trigger = on_payment_confirmed` (الافتراضي `none`: لا فاتورة آلية).
 *  3) نمط سعر المتجر `sales.commerce_price_tax_mode = inclusive` (الافتراضي غير محدد ⇒ مغلق): أسعار المتجر وإجمالي الطلب المدفوع شاملة الضريبة.
 *     النمط الحصري (الضريبة تُضاف فوق) غير مدعوم: المبلغ المحصَّل = إجمالي الطلب بلا ضريبة فلا تساوي الفاتورة ما دُفع.
 */
final class CommerceInvoiceOnPayment
{
    public const TRIGGER_NONE = 'none';

    public const TRIGGER_ON_PAYMENT_CONFIRMED = 'on_payment_confirmed';

    public const TRIGGERS = [self::TRIGGER_NONE, self::TRIGGER_ON_PAYMENT_CONFIRMED];

    public const PRICE_MODE_INCLUSIVE = 'inclusive';

    public const PRICE_MODES = [self::PRICE_MODE_INCLUSIVE];

    /** بوابة النشر + مرجع EXT-05. */
    public static function gateOpen(): bool
    {
        return (bool) config('payments.commerce_invoice_on_payment.enabled', false)
            && trim((string) config('payments.commerce_invoice_on_payment.tax_opinion_ref', '')) !== '';
    }

    public static function trigger(): string
    {
        $value = Settings::get('sales', 'commerce_invoice_trigger');

        return is_string($value) && in_array($value, self::TRIGGERS, true) ? $value : self::TRIGGER_NONE;
    }

    public static function priceMode(): ?string
    {
        $value = Settings::get('sales', 'commerce_price_tax_mode');

        return is_string($value) && in_array($value, self::PRICE_MODES, true) ? $value : null;
    }

    /** هل يُرحَّل الالتقاط الجديد لمستأجر السياق الحالي؟ */
    public static function active(): bool
    {
        return self::gateOpen()
            && self::trigger() === self::TRIGGER_ON_PAYMENT_CONFIRMED
            && self::priceMode() === self::PRICE_MODE_INCLUSIVE;
    }
}
