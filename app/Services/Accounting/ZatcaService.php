<?php

namespace App\Services\Accounting;

use App\Models\Invoice;
use App\Models\Tenant;
use Illuminate\Support\Str;

/**
 * ═══════════════════════════════════════════════════════════════
 *  ZatcaService — الفاتورة الإلكترونية (هيئة الزكاة والضريبة)
 * ═══════════════════════════════════════════════════════════════
 *  المرحلة 1 (التوليد): رمز QR بصيغة TLV/Base64 بالحقول الخمسة.
 *  المرحلة 2 (الربط):   UUID + عدّاد ICV + سلسلة الهاش (PIH) + مستند UBL 2.1
 *                       + هاش المستند SHA-256.
 *
 *  المؤجَّل (يتطلب شهادات ZATCA وربطاً حياً): التوقيع التشفيري (secp256k1)،
 *  CSID/CSR، توسعة QR للوسوم 6–9، وإرسال Clearance/Reporting.
 *
 *  المبالغ تُحوَّل من الهللات إلى نص عشري بلا float.
 */
class ZatcaService
{
    /**
     * بناء كامل بيانات الفاتورة الإلكترونية عند الترحيل.
     *
     * @return array{uuid:string, icv:int, prev:string, xml:string, hash:string, qr:string}
     */
    public function buildFor(Invoice $invoice): array
    {
        $invoice->loadMissing('lines', 'partner');
        $tenant = Tenant::find($invoice->tenant_id);

        $uuid = (string) Str::uuid();

        // سلسلة الهاش: آخر فاتورة مُرحَّلة (بهاش) تحدّد العدّاد والهاش السابق.
        $last = Invoice::whereNotNull('zatca_hash')
            ->orderByDesc('zatca_icv')
            ->first();

        $icv  = ($last->zatca_icv ?? 0) + 1;
        $prev = $last->zatca_hash ?? $this->genesisHash();

        $xml  = $this->buildXml($invoice, $tenant, $uuid, $icv, $prev);
        $hash = base64_encode(hash('sha256', $xml, true));
        $qr   = $this->qrFor($invoice, $tenant);

        return compact('uuid', 'icv', 'prev', 'xml', 'hash', 'qr');
    }

    /**
     * رمز QR للمرحلة 1: Base64 لحقول TLV الخمسة الإلزامية.
     */
    public function qrFor(Invoice $invoice, ?Tenant $tenant = null): string
    {
        $tenant ??= Tenant::find($invoice->tenant_id);

        $payload =
            $this->tlv(1, $tenant?->name ?? '') .
            $this->tlv(2, $tenant?->vat_number ?? '') .
            $this->tlv(3, ($invoice->created_at ?? now())->toIso8601String()) .
            $this->tlv(4, $this->formatAmount($invoice->total)) .
            $this->tlv(5, $this->formatAmount($invoice->tax_amount));

        return base64_encode($payload);
    }

    /**
     * الهاش الابتدائي لسلسلة PIH = Base64 لـ SHA-256 للنص "0".
     */
    public function genesisHash(): string
    {
        return base64_encode(hash('sha256', '0', true));
    }

    /**
     * بناء حقل TLV واحد: [وسم 1 بايت][طول البايتات 1 بايت][القيمة].
     */
    public function tlv(int $tag, string $value): string
    {
        return chr($tag) . chr(strlen($value)) . $value;
    }

    /**
     * تحويل المبلغ من الهللات إلى نص عشري — بلا float. 115000 → "1150.00"
     */
    public function formatAmount(int $minor): string
    {
        $sign  = $minor < 0 ? '-' : '';
        $minor = abs($minor);

        return sprintf('%s%d.%02d', $sign, intdiv($minor, 100), $minor % 100);
    }

    /**
     * بناء مستند UBL 2.1 مبسّط للفاتورة (تمثيل بنيوي — غير مُتحقَّق مقابل XSD ZATCA).
     */
    protected function buildXml(Invoice $invoice, ?Tenant $tenant, string $uuid, int $icv, string $prev): string
    {
        $e = fn ($v) => htmlspecialchars((string) $v, ENT_XML1 | ENT_QUOTES, 'UTF-8');
        $amt = fn (int $m) => $this->formatAmount($m);

        $linesXml = '';
        foreach ($invoice->lines as $i => $line) {
            $linesXml .= <<<LINE
  <cac:InvoiceLine>
    <cbc:ID>{$e($i + 1)}</cbc:ID>
    <cbc:InvoicedQuantity>{$e($line->quantity)}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="SAR">{$e($amt($line->line_subtotal))}</cbc:LineExtensionAmount>
    <cac:Item><cbc:Name>{$e($line->description ?? '-')}</cbc:Name></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="SAR">{$e($amt($line->unit_price))}</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>

LINE;
        }

        $issue = ($invoice->created_at ?? now());

        return <<<XML
<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
  <cbc:ID>{$e($invoice->number)}</cbc:ID>
  <cbc:UUID>{$e($uuid)}</cbc:UUID>
  <cbc:IssueDate>{$e($issue->format('Y-m-d'))}</cbc:IssueDate>
  <cbc:IssueTime>{$e($issue->format('H:i:s'))}</cbc:IssueTime>
  <cbc:InvoiceTypeCode name="0100000">388</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode>
  <cac:AdditionalDocumentReference>
    <cbc:ID>ICV</cbc:ID>
    <cbc:UUID>{$e($icv)}</cbc:UUID>
  </cac:AdditionalDocumentReference>
  <cac:AdditionalDocumentReference>
    <cbc:ID>PIH</cbc:ID>
    <cac:Attachment>
      <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">{$e($prev)}</cbc:EmbeddedDocumentBinaryObject>
    </cac:Attachment>
  </cac:AdditionalDocumentReference>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyTaxScheme><cbc:CompanyID>{$e($tenant?->vat_number ?? '')}</cbc:CompanyID></cac:PartyTaxScheme>
      <cac:PartyLegalEntity><cbc:RegistrationName>{$e($tenant?->name ?? '')}</cbc:RegistrationName></cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyLegalEntity><cbc:RegistrationName>{$e($invoice->partner?->name ?? '')}</cbc:RegistrationName></cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="SAR">{$e($amt($invoice->tax_amount))}</cbc:TaxAmount>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:TaxExclusiveAmount currencyID="SAR">{$e($amt($invoice->subtotal))}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="SAR">{$e($amt($invoice->total))}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="SAR">{$e($amt($invoice->total))}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
{$linesXml}</Invoice>
XML;
    }
}
