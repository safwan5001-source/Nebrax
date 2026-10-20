<?php

namespace App\Support;

use InvalidArgumentException;
use RuntimeException;

/**
 * بانيّ XML إشعار الدائن لمبيعات المنشأة (نوع 381) — REM-18a. **دالة نقيّة**: مدخلها `ZatcaCreditNoteInput` المتحقَّق
 * منه وحده؛ لا نموذج ولا قاعدة بيانات ولا ساعة ولا إعدادات ولا كتابة، ولا يُستدعى من أي مسار ترحيل بعد (CreditNoteService
 * لم يتغيّر). يُنتج مستنداً غير موقَّع بنفس غلاف فاتورة REM-16/17 (ICV وPIH وعنصر QR بعلامة بديلة وحاوية `cac:Signature`)
 * فيمرّ في خط التوقيع نفسه (`ZatcaSignedInvoiceFinalizer`) بلا أي تعديل.
 *
 * ═══ الجذر: `Invoice` لا `CreditNote` (محسوم بالمُدقّق، مع تناقضٍ موثَّق في المعيار) ═══
 *  معيار تنفيذ XML §11.2.1 يقول «The UBL Message type is “Invoice” for all document types» لكن عمود جدوله لـ381 يقول
 *  «Credit note». كل عيّنات ZATCA الرسمية للإشعار (381/383) جذرها `Invoice` ونوعها في `cbc:InvoiceTypeCode`، و`xsdPath`
 *  في SDK هو UBL-Invoice-2.1 وحده: جُرِّب جذر `CreditNote` (مع `CreditNoteTypeCode` و`CreditedQuantity`) على عيّنة رسمية
 *  فسقط في XSD وEN. فالمعتمد هنا `Invoice` + 381. سلوك المنصة الحيّة لم يُختبر (لا اتصال) — يبقى بنداً مفتوحاً.
 *
 * ═══ ما يُكتب (كله من مدخل صريح) ═══
 *  `InvoiceTypeCode name=0100000|0200000` من التصنيف · `cac:BillingReference/InvoiceDocumentReference/ID` (BT-25) ·
 *  `cac:PaymentMeans` بـ`PaymentMeansCode 10` و`InstructionNote` (KSA-10، من `ZatcaNoteReason`) · كتلتا الطرفين من اللقطة عبر
 *  `ZatcaPartyXml` · المبالغ والأسطر عبر نواتَي `ZatcaMonetaryXml` المشتركتين مع الفاتورة (المبالغ المخزَّنة كما هي، موجبة
 *  في الإشعار كما في عيّنات ZATCA) · لا خصم/شحن على مستوى المستند (حصة خصم الرأس تحمّلها `line_discount` للسطر).
 *
 * ═══ ما لا يُكتب عمداً ═══
 *  لا فئة ضريبة لغير S/15 (لا استنتاج Z/E/O — REM-12 مفتوح)، لا `Delivery` (REM-29)، لا `PrepaidAmount` غير الصفر، لا
 *  أكثر من فاتورة أصلية، لا سبب ثانٍ، لا رمز دفع لحالة `credit`.
 *
 * `BillingReference` وسبب الإصدار إلزاميان هنا بذاتهما: SDK يعامل غياب الأول **تحذيراً** (BR-KSA-56) مع أنه إلزامي في
 * المواصفة (BR-KSA-56، قاموس البيانات BT-25 «M»، وDTG FAQ «mandatory field»)، ويعامل غياب الثاني **خطأً** (BR-KSA-17).
 */
final class ZatcaCreditNoteXml
{
    /** UNTDID 1001 — إشعار دائن. */
    public const TYPE_CODE = '381';

    /** علامة QR البديلة نفسها التي تستعملها الفاتورة (ZatcaService::attachQr) فيتبعها خط التوقيع كما هو. */
    public const QR_PLACEHOLDER = '__NEBRAX_ZATCA_QR__';

    /** KSA-2: NNPNESB — الموضعان الأولان 01 قياسية / 02 مبسّطة (§11.2.1)، وباقي الأعلام كما في فاتورة AWJ (`ZatcaService`). */
    private const TRANSACTION_CODE = ['standard' => '0100000', 'simplified' => '0200000'];

    public static function build(ZatcaCreditNoteInput $in): string
    {
        $linesXml = '';
        foreach ($in->lines as $index => $line) {
            $linesXml .= ZatcaMonetaryXml::lineFromAmounts(
                $index + 1,
                (string) $line->quantity,
                $line->description,
                $line->net(),
                $line->lineDiscount,
                $line->lineTax,
                $line->lineTotal,
                ZatcaMonetaryXml::isStandardRate($line->taxRate),
                $line->unitPriceNet,
            );
        }
        // خصم/شحن المستند صفر في الإشعار: حصة خصم الرأس مدمجة في خصم السطر كما خزّنها CreditNoteService (REM-02).
        $monetaryXml = ZatcaMonetaryXml::documentBlockFromAmounts(
            $in->subtotal,
            0,
            0,
            $in->taxAmount,
            $in->total,
            $in->allStandardRated(),
        );

        $partiesXml = rtrim(
            ZatcaPartyXml::supplier($in->parties['seller'])
            . ZatcaPartyXml::customer($in->parties['buyer'], $in->classification)
        );

        $e = static fn (string $value): string => htmlspecialchars($value, ENT_XML1 | ENT_QUOTES, 'UTF-8');
        $type = self::TYPE_CODE;
        $transactionCode = self::TRANSACTION_CODE[$in->classification];
        $issueDate = ZatcaIssueTimestamp::xmlDate($in->issuedAt);
        $issueTime = ZatcaIssueTimestamp::xmlTime($in->issuedAt);
        $placeholder = self::QR_PLACEHOLDER;
        $reason = ZatcaNoteReason::instructionNote($in->reasonCode);

        return <<<XML
<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
         xmlns:sig="urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2"
         xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2"
         xmlns:sbc="urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2"
         xmlns:ds="http://www.w3.org/2000/09/xmldsig#"
         xmlns:xades="http://uri.etsi.org/01903/v1.3.2#">
  <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
  <cbc:ID>{$e($in->number)}</cbc:ID>
  <cbc:UUID>{$e($in->uuid)}</cbc:UUID>
  <cbc:IssueDate>{$e($issueDate)}</cbc:IssueDate>
  <cbc:IssueTime>{$e($issueTime)}</cbc:IssueTime>
  <cbc:InvoiceTypeCode name="{$transactionCode}">{$type}</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode>
  <cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode>
  <cac:BillingReference>
    <cac:InvoiceDocumentReference>
      <cbc:ID>{$e($in->originalInvoiceNumber)}</cbc:ID>
    </cac:InvoiceDocumentReference>
  </cac:BillingReference>
  <cac:AdditionalDocumentReference>
    <cbc:ID>ICV</cbc:ID>
    <cbc:UUID>{$e((string) $in->icv)}</cbc:UUID>
  </cac:AdditionalDocumentReference>
  <cac:AdditionalDocumentReference>
    <cbc:ID>PIH</cbc:ID>
    <cac:Attachment>
      <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">{$e($in->previousHash)}</cbc:EmbeddedDocumentBinaryObject>
    </cac:Attachment>
  </cac:AdditionalDocumentReference>
  <cac:AdditionalDocumentReference>
    <cbc:ID>QR</cbc:ID>
    <cac:Attachment>
      <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">{$placeholder}</cbc:EmbeddedDocumentBinaryObject>
    </cac:Attachment>
  </cac:AdditionalDocumentReference>
  <cac:Signature>
    <cbc:ID>urn:oasis:names:specification:ubl:signature:Invoice</cbc:ID>
    <cbc:SignatureMethod>urn:oasis:names:specification:ubl:dsig:enveloped:xades</cbc:SignatureMethod>
  </cac:Signature>
{$partiesXml}
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>{$in->paymentMeansCode}</cbc:PaymentMeansCode>
    <cbc:InstructionNote>{$e($reason)}</cbc:InstructionNote>
  </cac:PaymentMeans>
{$monetaryXml}{$linesXml}</Invoice>
XML;
    }

    /**
     * رمز QR للمرحلة الأولى (وسوم 1–5) للإشعار: اسم البائع ورقمه من لقطة الفاتورة نفسها التي تُبنى منها كتلة البائع في XML،
     * ولحظة الإصدار نفسها، وإجمالي الإشعار وضريبته كما خُزِّنا. مرحلة 2 تستبدله بالـ9 وسوم عبر خط REM-17 (بلا تغيير).
     * صيغة الوسم 3 هي القائمة حرفياً (Q1 مفتوحة — لا تُغيَّر هنا).
     */
    public static function phaseOneQr(ZatcaCreditNoteInput $in): string
    {
        $name = ZatcaPartyXml::text($in->parties['seller']['name'] ?? null);
        $vat = ZatcaPartyXml::text($in->parties['seller']['vat_number'] ?? null);
        if ($name === null || $vat === null) {
            throw new InvalidArgumentException('اسم البائع ورقمه الضريبي مطلوبان في لقطة الطرفين لتوليد QR الإشعار.');
        }

        return base64_encode(
            self::tlv(1, $name)
            . self::tlv(2, $vat)
            . self::tlv(3, ZatcaIssueTimestamp::phase1QrText($in->issuedAt))
            . self::tlv(4, Money::toRiyal($in->total))
            . self::tlv(5, Money::toRiyal($in->taxAmount))
        );
    }

    /** يضع QR مكان العلامة البديلة الوحيدة — بلا إعادة تسلسل لباقي المستند. */
    public static function withQr(string $xml, string $qr): string
    {
        $marker = '<cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">' . self::QR_PLACEHOLDER . '</cbc:EmbeddedDocumentBinaryObject>';
        if ($qr === '' || substr_count($xml, $marker) !== 1) {
            throw new RuntimeException('تعذر تثبيت QR داخل XML إشعار ZATCA.');
        }

        return str_replace(
            $marker,
            '<cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">' . htmlspecialchars($qr, ENT_XML1 | ENT_QUOTES, 'UTF-8') . '</cbc:EmbeddedDocumentBinaryObject>',
            $xml,
        );
    }

    /** [وسم 1 بايت][طول البايتات 1 بايت][القيمة] — قيمة تتجاوز 255 بايت تُرفض ولا تُقتطع (كـ ZatcaService::tlv). */
    private static function tlv(int $tag, string $value): string
    {
        if (strlen($value) > 255) {
            throw new RuntimeException("قيمة وسم QR رقم {$tag} تتجاوز 255 بايت؛ لا تُقتطع بيانات QR.");
        }

        return chr($tag) . chr(strlen($value)) . $value;
    }
}
