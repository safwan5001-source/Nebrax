<?php

namespace App\Support;

use App\Models\Invoice;
use App\Models\InvoiceLine;

/**
 * المبالغ وسطور الفاتورة في UBL لـ ZATCA — REM-16 (الشريحة الآمنة: XML فقط).
 *
 * دالة نقيّة: **تعرض المبالغ المخزَّنة كما هي** (`invoices.*` و`invoice_lines.*` كما كتبها `InvoiceService::post()`)
 * في عناصر UBL الصحيحة. لا تعيد حساب ضريبة ولا تقريباً ولا توزيع خصم، ولا تُصلح في XML تناقضاً قائماً في المصدر؛
 * أي تناقض (مثل تقريب السطر مقابل المستند) يبقى ظاهراً في SDK وفي الاختبارات.
 *
 * مبادئ (قرارات المالك لـ REM-16):
 *  • التصنيف **S** فقط لسطرٍ معدّله موجب ويساوي معدل القيمة المضافة القياسي المعتمد (15 — BR-KSA-84، وهو معدل الشحن
 *    الثابت في `InvoiceService`). لا استنتاج لـ S/Z/E/O من معدل صفري ولا من أي معدل آخر (5٪ وغيره: G-I3 غير محسوم).
 *    غير المصنَّف يُترك بلا `ClassifiedTaxCategory` — فجوة مطابقة صريحة لا افتراضاً.
 *  • ملخّص الضريبة `TaxSubtotal` يُكتب فقط حين تكون **كل** الأسطر من فئة S/15 (فئة واحدة): لا توزيع خصم مستند
 *    على فئات، ولا تقسيم لضريبة مخزَّنة لا يُخزَّن تقسيمها.
 *  • `adjustment` (تسوية تجارية غير محدودة) **لا** يُعيَّن إلى `PayableRoundingAmount` (G-B5): يبقى فرقاً ظاهراً بين
 *    `TaxInclusiveAmount` (= BT-109 + BT-110) و`PayableAmount` (= الإجمالي المخزَّن).
 *  • رسم الشحن يُكتب شحناً بنصٍّ فقط؛ **لا رمز سبب** لأن لا رمز في UNCL 7161 يطابق حقل «رسوم الشحن» حرفياً
 *    (SAA = «شحن ومناولة»، DL = «توصيل»، FC = «خدمة شحن بضائع») — فجوة BR-KSA-19 صريحة.
 *  • لا `unitCode` (الوحدة نصّ حرّ في `unit_name` وBT-130 اختياري)، ولا تاريخ توريد (REM-29)، ولا `PaymentMeans`.
 *
 * ترتيب العناصر مطابق لـ XSD كما يتحقّق منه SDK (انظر REM-16-IMPLEMENTATION-REPORT.md).
 */
final class ZatcaMonetaryXml
{
    /** معدل القيمة المضافة القياسي المعتمد (BR-KSA-84؛ نفس ثابت الشحن في InvoiceService::VAT_RATE). */
    public const STANDARD_RATE = 15;

    /** تسمية خصم (نصّ سبب مطلوب EN16931 BR-33/BR-42؛ لا يخزّن AWJ سبباً للخصم). */
    private const DISCOUNT_REASON = 'خصم | Discount';

    /** تسمية رسم الشحن (BR-KSA-21)؛ بلا رمز سبب — انظر رأس الصنف. */
    private const SHIPPING_REASON = 'رسوم الشحن | Shipping';

    /** سطر مصنَّف S/15؟ (المعدل وحده لا يكفي لغير 15، ولا يُستنتج شيء من الصفر.) */
    public static function isStandardRated(InvoiceLine $line): bool
    {
        return (int) $line->tax_rate === self::STANDARD_RATE;
    }

    /** كل الأسطر S/15 (فئة واحدة معروفة) — شرط ملخّص الضريبة وفئة خصم المستند. */
    public static function allStandardRated(Invoice $invoice): bool
    {
        $lines = $invoice->lines;

        return $lines->isNotEmpty() && $lines->every(fn (InvoiceLine $l) => self::isStandardRated($l));
    }

    /**
     * خصم/رسم المستند + TaxTotal×2 + LegalMonetaryTotal (بهذا الترتيب).
     * يُدرج بعد كتل الأطراف وقبل الأسطر.
     */
    public static function documentBlock(Invoice $invoice): string
    {
        // قيم post() المشتقة: الخصم والشحن لا يقلّان عن صفر، والتسوية كما هي.
        $subtotal = (int) $invoice->subtotal;
        $discount = max(0, (int) $invoice->discount);
        $shipping = max(0, (int) $invoice->shipping);
        $tax = (int) $invoice->tax_amount;
        $total = (int) $invoice->total;

        $taxExclusive = $subtotal - $discount + $shipping;     // BT-109
        $taxInclusive = $taxExclusive + $tax;                  // BT-112 = BT-109 + BT-110

        $standard = self::allStandardRated($invoice);
        $out = '';

        if ($discount > 0) {
            $out .= self::documentAllowanceCharge(false, $discount, self::DISCOUNT_REASON, $standard);
        }
        if ($shipping > 0) {
            // ضريبة الشحن تُحسب دائماً بـ 15٪ في InvoiceService ⇒ فئته S/15 بصرف النظر عن فئات السلع.
            $out .= self::documentAllowanceCharge(true, $shipping, self::SHIPPING_REASON, true);
        }

        $out .= "  <cac:TaxTotal>\n    <cbc:TaxAmount currencyID=\"SAR\">" . Money::toRiyal($tax) . "</cbc:TaxAmount>\n  </cac:TaxTotal>\n";
        $out .= "  <cac:TaxTotal>\n    <cbc:TaxAmount currencyID=\"SAR\">" . Money::toRiyal($tax) . "</cbc:TaxAmount>\n";
        if ($standard) {
            $out .= "    <cac:TaxSubtotal>\n"
                . "      <cbc:TaxableAmount currencyID=\"SAR\">" . Money::toRiyal($taxExclusive) . "</cbc:TaxableAmount>\n"
                . "      <cbc:TaxAmount currencyID=\"SAR\">" . Money::toRiyal($tax) . "</cbc:TaxAmount>\n"
                . '      ' . self::taxCategory('TaxCategory', 6) . "\n"
                . "    </cac:TaxSubtotal>\n";
        }
        $out .= "  </cac:TaxTotal>\n";

        $out .= "  <cac:LegalMonetaryTotal>\n"
            . '    <cbc:LineExtensionAmount currencyID="SAR">' . Money::toRiyal($subtotal) . "</cbc:LineExtensionAmount>\n"
            . '    <cbc:TaxExclusiveAmount currencyID="SAR">' . Money::toRiyal($taxExclusive) . "</cbc:TaxExclusiveAmount>\n"
            . '    <cbc:TaxInclusiveAmount currencyID="SAR">' . Money::toRiyal($taxInclusive) . "</cbc:TaxInclusiveAmount>\n"
            . '    <cbc:AllowanceTotalAmount currencyID="SAR">' . Money::toRiyal($discount) . "</cbc:AllowanceTotalAmount>\n"
            . ($shipping > 0 ? '    <cbc:ChargeTotalAmount currencyID="SAR">' . Money::toRiyal($shipping) . "</cbc:ChargeTotalAmount>\n" : '')
            . "    <cbc:PrepaidAmount currencyID=\"SAR\">0.00</cbc:PrepaidAmount>\n"
            . '    <cbc:PayableAmount currencyID="SAR">' . Money::toRiyal($total) . "</cbc:PayableAmount>\n"
            . "  </cac:LegalMonetaryTotal>\n";

        return $out;
    }

    /**
     * سطر فاتورة. `$quantity` نصّ الكمية الجاهز (ZatcaService::lineQuantity) كي لا يتكرّر منطق الكسور.
     */
    public static function line(Invoice $invoice, InvoiceLine $line, int $position, string $quantity): string
    {
        $net = (int) $line->line_subtotal - (int) $line->line_discount;       // BT-131
        $discount = (int) $line->line_discount;
        $tax = (int) $line->line_tax;                                          // KSA-11
        $withVat = (int) $line->line_total;                                    // KSA-12 (= BT-131 + KSA-11 كما خزّنه post)

        $xml = "  <cac:InvoiceLine>\n"
            . '    <cbc:ID>' . self::e((string) $position) . "</cbc:ID>\n"
            . '    <cbc:InvoicedQuantity>' . self::e($quantity) . "</cbc:InvoicedQuantity>\n"
            . '    <cbc:LineExtensionAmount currencyID="SAR">' . Money::toRiyal($net) . "</cbc:LineExtensionAmount>\n";

        if ($discount > 0) {
            $xml .= "    <cac:AllowanceCharge>\n"
                . "      <cbc:ChargeIndicator>false</cbc:ChargeIndicator>\n"
                . '      <cbc:AllowanceChargeReason>' . self::e(self::DISCOUNT_REASON) . "</cbc:AllowanceChargeReason>\n"
                . '      <cbc:Amount currencyID="SAR">' . Money::toRiyal($discount) . "</cbc:Amount>\n"
                . "    </cac:AllowanceCharge>\n";
        }

        $xml .= "    <cac:TaxTotal>\n"
            . '      <cbc:TaxAmount currencyID="SAR">' . Money::toRiyal($tax) . "</cbc:TaxAmount>\n"
            . '      <cbc:RoundingAmount currencyID="SAR">' . Money::toRiyal($withVat) . "</cbc:RoundingAmount>\n"
            . "    </cac:TaxTotal>\n"
            . "    <cac:Item>\n"
            . '      <cbc:Name>' . self::e($line->description ?? '-') . "</cbc:Name>\n";

        if (self::isStandardRated($line)) {
            $xml .= '      ' . self::taxCategory('ClassifiedTaxCategory', 6) . "\n";
        }
        $xml .= "    </cac:Item>\n";

        $price = self::unitPrice($invoice, $line);
        if ($price !== null) {
            $xml .= '    <cac:Price><cbc:PriceAmount currencyID="SAR">' . Money::toRiyal($price) . "</cbc:PriceAmount></cac:Price>\n";
        }

        return $xml . "  </cac:InvoiceLine>\n";
    }

    /**
     * سعر الوحدة الصافي (BT-146) قبل خصم السطر: غير الشامل ⇒ `unit_price`؛ الشامل للضريبة ⇒ اللقطة المخزَّنة
     * `unit_price_before_tax` (لا استخراج ضريبة هنا). شامل بلا لقطة ⇒ لا `Price` (فجوة ظاهرة، لا اختلاق).
     */
    private static function unitPrice(Invoice $invoice, InvoiceLine $line): ?int
    {
        if (! $invoice->tax_inclusive) {
            return (int) $line->unit_price;
        }

        return $line->unit_price_before_tax === null ? null : (int) $line->unit_price_before_tax;
    }

    private static function documentAllowanceCharge(bool $charge, int $amount, string $reason, bool $withCategory): string
    {
        return "  <cac:AllowanceCharge>\n"
            . '    <cbc:ChargeIndicator>' . ($charge ? 'true' : 'false') . "</cbc:ChargeIndicator>\n"
            . '    <cbc:AllowanceChargeReason>' . self::e($reason) . "</cbc:AllowanceChargeReason>\n"
            . '    <cbc:Amount currencyID="SAR">' . Money::toRiyal($amount) . "</cbc:Amount>\n"
            . ($withCategory ? '    ' . self::taxCategory('TaxCategory', 4) . "\n" : '')
            . "  </cac:AllowanceCharge>\n";
    }

    /** فئة S بمعدل 15.00 تحت نظام VAT. `$element` TaxCategory | ClassifiedTaxCategory. */
    private static function taxCategory(string $element, int $indent): string
    {
        $pad = str_repeat(' ', $indent);

        return "<cac:{$element}>\n"
            . "{$pad}  <cbc:ID>S</cbc:ID>\n"
            . "{$pad}  <cbc:Percent>" . self::STANDARD_RATE . ".00</cbc:Percent>\n"
            . "{$pad}  <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>\n"
            . "{$pad}</cac:{$element}>";
    }

    private static function e(string $value): string
    {
        return htmlspecialchars($value, ENT_XML1 | ENT_QUOTES, 'UTF-8');
    }
}
