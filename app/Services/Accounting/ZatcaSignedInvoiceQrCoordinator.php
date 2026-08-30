<?php

namespace App\Services\Accounting;

use DateTimeImmutable;
use DateTimeInterface;
use DateTimeZone;
use DOMDocument;
use DOMElement;
use DOMXPath;
use InvalidArgumentException;

/**
 * يوقّع XML ويبني QR للمرحلة الثانية من لقطة اعتماد واحدة.
 *
 * لا يحفظ الناتج ولا يرسل شبكة. حل الاعتماد مرة واحدة يمنع خلط شهادة QR
 * مع مفتاح توقيع من بيئة أخرى إذا تغيّر الإعداد النشط أثناء العملية.
 */
final class ZatcaSignedInvoiceQrCoordinator
{
    public function __construct(
        private readonly ZatcaSigningCredentialResolver $credentials,
        private readonly ZatcaSignaturePolicyResolver $policy,
        private readonly ZatcaXadesSignatureAssembler $assembler,
        private readonly ZatcaSignedInvoiceQrMaterialExtractor $signedMaterialExtractor,
        private readonly ZatcaQrCertificateMaterialExtractor $certificateMaterialExtractor,
        private readonly ZatcaPhaseTwoQrEncoder $qrEncoder,
    ) {}

    public function build(
        string $invoiceXml,
        DateTimeInterface $signingTime,
    ): ZatcaSignedInvoiceQrResult {
        $snapshot = $this->invoiceSnapshot($invoiceXml);
        $material = $this->credentials->resolve();
        $policy = $this->policy->resolve();
        $signedXml = $this->assembler->assemble(
            $invoiceXml,
            $material->certificateChain,
            $material->privateKey,
            $signingTime,
            $policy->identifier,
            $policy->digest,
        );
        $signedMaterial = $this->signedMaterialExtractor->extract($signedXml);
        $certificateMaterial = $this->certificateMaterialExtractor->extract(
            $material->certificateChain[0],
        );
        $qrCode = $this->qrEncoder->encode(
            $snapshot['seller_name'],
            $snapshot['vat_number'],
            $snapshot['invoice_time'],
            $snapshot['invoice_total'],
            $snapshot['vat_total'],
            $signedMaterial['invoice_hash'],
            $signedMaterial['ecdsa_signature'],
            $certificateMaterial['public_key'],
            $snapshot['document_type'],
            $snapshot['document_type'] === 'simplified'
                ? $certificateMaterial['certificate_signature']
                : null,
        );

        return new ZatcaSignedInvoiceQrResult(
            $signedXml,
            $signedMaterial['invoice_hash'],
            $qrCode,
        );
    }

    /**
     * @return array{
     *   seller_name:string,
     *   vat_number:string,
     *   invoice_time:DateTimeImmutable,
     *   invoice_total:string,
     *   vat_total:string,
     *   document_type:string
     * }
     */
    private function invoiceSnapshot(string $invoiceXml): array
    {
        $previous = libxml_use_internal_errors(true);
        try {
            $document = new DOMDocument();
            $loaded = $document->loadXML(
                $invoiceXml,
                LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING | LIBXML_COMPACT,
            );
            $root = $document->documentElement;
            if (! $loaded || ! $root instanceof DOMElement || $document->doctype !== null
                || $root->namespaceURI !== 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2'
                || $root->localName !== 'Invoice'
            ) {
                throw new InvalidArgumentException('XML غير صالح أو ليس فاتورة UBL آمنة لتحديد نوع ZATCA.');
            }

            $xpath = new DOMXPath($document);
            $xpath->registerNamespace('inv', 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2');
            $xpath->registerNamespace('cbc', ZatcaXadesSignatureAssembler::CBC_NAMESPACE);
            $xpath->registerNamespace(
                'cac',
                'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
            );
            $typeCode = $this->uniqueElement($xpath, '/inv:Invoice/cbc:InvoiceTypeCode');
            if (trim($typeCode->textContent) !== '388') {
                throw new InvalidArgumentException('فاتورة ZATCA يجب أن تحتوي InvoiceTypeCode فريداً بقيمة 388.');
            }
            $transactionCode = $typeCode->getAttribute('name');
            if (preg_match('/^(01|02)[01]{5}$/D', $transactionCode, $typeMatch) !== 1) {
                throw new InvalidArgumentException('اسم InvoiceTypeCode ليس رمز معاملة ZATCA صالحاً.');
            }

            $sellerName = trim($this->uniqueElement(
                $xpath,
                '/inv:Invoice/cac:AccountingSupplierParty/cac:Party/cac:PartyLegalEntity/cbc:RegistrationName',
            )->textContent);
            $vatNumber = trim($this->uniqueElement(
                $xpath,
                '/inv:Invoice/cac:AccountingSupplierParty/cac:Party/cac:PartyTaxScheme/cbc:CompanyID',
            )->textContent);
            $issueDate = trim($this->uniqueElement($xpath, '/inv:Invoice/cbc:IssueDate')->textContent);
            $issueTime = trim($this->uniqueElement($xpath, '/inv:Invoice/cbc:IssueTime')->textContent);
            $invoiceTotal = $this->amount(
                $this->uniqueElement(
                    $xpath,
                    "/inv:Invoice/cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount[@currencyID='SAR']",
                ),
                'إجمالي الفاتورة',
            );
            $vatTotal = $this->identicalAmount(
                $xpath,
                "/inv:Invoice/cac:TaxTotal/cbc:TaxAmount[@currencyID='SAR']",
                'إجمالي الضريبة',
            );

            return [
                'seller_name' => $sellerName,
                'vat_number' => $vatNumber,
                'invoice_time' => $this->invoiceTime($issueDate, $issueTime),
                'invoice_total' => $invoiceTotal,
                'vat_total' => $vatTotal,
                'document_type' => $typeMatch[1] === '01' ? 'standard' : 'simplified',
            ];
        } finally {
            libxml_clear_errors();
            libxml_use_internal_errors($previous);
        }
    }

    private function uniqueElement(DOMXPath $xpath, string $expression): DOMElement
    {
        $nodes = $xpath->query($expression);
        $element = $nodes !== false && $nodes->length === 1 ? $nodes->item(0) : null;
        if (! $element instanceof DOMElement) {
            throw new InvalidArgumentException('فاتورة ZATCA تفتقد حقل QR فريداً ومطلوباً.');
        }

        return $element;
    }

    private function amount(DOMElement $element, string $label): string
    {
        $amount = trim($element->textContent);
        if (preg_match('/^\d+\.\d{2}$/D', $amount) !== 1) {
            throw new InvalidArgumentException("{$label} داخل XML يجب أن يكون SAR بمنزلتين عشريتين.");
        }

        return $amount;
    }

    private function identicalAmount(DOMXPath $xpath, string $expression, string $label): string
    {
        $nodes = $xpath->query($expression);
        if ($nodes === false || $nodes->length < 1) {
            throw new InvalidArgumentException("فاتورة ZATCA تفتقد {$label} المطلوب لوسم QR.");
        }

        $expected = null;
        foreach ($nodes as $node) {
            if (! $node instanceof DOMElement) {
                throw new InvalidArgumentException("بنية {$label} داخل فاتورة ZATCA غير صالحة.");
            }
            $amount = $this->amount($node, $label);
            if ($expected !== null && $amount !== $expected) {
                throw new InvalidArgumentException("قيم {$label} المكررة داخل فاتورة ZATCA غير متطابقة.");
            }
            $expected = $amount;
        }

        if (! is_string($expected)) {
            throw new InvalidArgumentException("فاتورة ZATCA تفتقد {$label} المطلوب لوسم QR.");
        }

        return $expected;
    }

    private function invoiceTime(string $date, string $time): DateTimeImmutable
    {
        $stamp = $date.'T'.$time;
        if (preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})?$/D', $stamp) !== 1) {
            throw new InvalidArgumentException('تاريخ أو وقت إصدار فاتورة ZATCA غير صالح لوسم QR.');
        }

        $timezoneName = config('app.timezone', 'UTC');
        if (! is_string($timezoneName)) {
            throw new InvalidArgumentException('منطقة وقت التطبيق غير صالحة لبناء QR.');
        }
        $isZulu = str_ends_with($stamp, 'Z');
        try {
            $timezone = new DateTimeZone($isZulu ? 'UTC' : $timezoneName);
        } catch (\Exception) {
            throw new InvalidArgumentException('تعذر تفسير وقت إصدار فاتورة ZATCA.');
        }
        $format = $isZulu
            ? '!Y-m-d\TH:i:s\Z'
            : (preg_match('/[+-]\d{2}:\d{2}$/D', $stamp) === 1
                ? '!Y-m-d\TH:i:sP'
                : '!Y-m-d\TH:i:s');
        $invoiceTime = DateTimeImmutable::createFromFormat($format, $stamp, $timezone);
        $errors = DateTimeImmutable::getLastErrors();
        if ($invoiceTime === false || (is_array($errors)
            && ($errors['warning_count'] !== 0 || $errors['error_count'] !== 0))
        ) {
            throw new InvalidArgumentException('تعذر تفسير وقت إصدار فاتورة ZATCA.');
        }

        return $invoiceTime;
    }
}
