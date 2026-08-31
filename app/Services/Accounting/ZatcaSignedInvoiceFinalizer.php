<?php

namespace App\Services\Accounting;

use DateTimeInterface;
use DOMDocument;
use DOMElement;
use DOMXPath;
use InvalidArgumentException;
use RuntimeException;

/**
 * يجمّد أثر فاتورة المرحلة الثانية: XML موقّع، QR نهائي، وهاش واحد متطابق.
 *
 * لا يحفظ ولا يرسل شبكة. على المستدعي حفظ القيم الثلاث معاً داخل معاملته.
 */
final class ZatcaSignedInvoiceFinalizer
{
    private const INVOICE_NAMESPACE = 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2';
    private const CAC_NAMESPACE = 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2';
    private const CBC_NAMESPACE = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2';

    public function __construct(
        private readonly ZatcaInvoiceSigner $signer,
        private readonly ZatcaSignedInvoiceQrMaterialExtractor $signedMaterial,
        private readonly ZatcaPhaseTwoQrEncoder $qrEncoder,
    ) {}

    /**
     * @return array{xml:string, hash:string, qr:string}
     */
    public function finalize(
        string $invoiceXml,
        string $currentQr,
        string $sellerName,
        string $vatNumber,
        DateTimeInterface $invoiceTime,
        DateTimeInterface $signingTime,
        string $invoiceTotal,
        string $vatTotal,
        string $documentType,
    ): array {
        if ($invoiceXml === '' || $currentQr === '') {
            throw new InvalidArgumentException('XML وQR الحاليان مطلوبان لإتمام فاتورة ZATCA.');
        }

        $signed = $this->signer->signWithQrMaterial($invoiceXml, $signingTime);
        $cryptographic = $this->signedMaterial->extract($signed['xml']);
        $qr = $this->qrEncoder->encode(
            $sellerName,
            $vatNumber,
            $invoiceTime,
            $invoiceTotal,
            $vatTotal,
            $cryptographic['invoice_hash'],
            $cryptographic['ecdsa_signature'],
            $signed['public_key'],
            $documentType,
            $documentType === 'simplified' ? $signed['certificate_signature'] : null,
        );

        $finalXml = $this->replaceQr($signed['xml'], $currentQr, $qr);
        $verified = $this->signedMaterial->extract($finalXml);
        if (! hash_equals($cryptographic['invoice_hash'], $verified['invoice_hash'])
            || ! hash_equals($cryptographic['ecdsa_signature'], $verified['ecdsa_signature'])
        ) {
            throw new RuntimeException('تغيير QR غيّر مادة توقيع فاتورة ZATCA على نحو غير متوقع.');
        }

        return [
            'xml' => $finalXml,
            'hash' => base64_encode($verified['invoice_hash']),
            'qr' => $qr,
        ];
    }

    private function replaceQr(string $signedXml, string $currentQr, string $finalQr): string
    {
        $document = $this->parseSecurely($signedXml);
        $xpath = new DOMXPath($document);
        $xpath->registerNamespace('inv', self::INVOICE_NAMESPACE);
        $xpath->registerNamespace('cac', self::CAC_NAMESPACE);
        $xpath->registerNamespace('cbc', self::CBC_NAMESPACE);
        $nodes = $xpath->query(
            "/inv:Invoice/cac:AdditionalDocumentReference[cbc:ID='QR']".
            '/cac:Attachment/cbc:EmbeddedDocumentBinaryObject',
        );
        if ($nodes === false || $nodes->length !== 1 || ! $nodes->item(0) instanceof DOMElement) {
            throw new InvalidArgumentException('مرجع QR الرسمي في فاتورة ZATCA مفقود أو مكرر.');
        }
        $node = $nodes->item(0);
        if ($node->getAttribute('mimeCode') !== 'text/plain'
            || ! hash_equals($currentQr, $node->textContent)
        ) {
            throw new InvalidArgumentException('قيمة QR الحالية لا تطابق مرجع الفاتورة المراد تجميده.');
        }

        $needle = '<cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">'.
            htmlspecialchars($currentQr, ENT_XML1 | ENT_QUOTES, 'UTF-8').
            '</cbc:EmbeddedDocumentBinaryObject>';
        if (substr_count($signedXml, $needle) !== 1) {
            throw new RuntimeException('تعذر تحديد موضع QR الوحيد من دون إعادة تسلسل XML الموقّع.');
        }
        $replacement = '<cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">'.
            htmlspecialchars($finalQr, ENT_XML1 | ENT_QUOTES, 'UTF-8').
            '</cbc:EmbeddedDocumentBinaryObject>';

        return str_replace($needle, $replacement, $signedXml);
    }

    private function parseSecurely(string $xml): DOMDocument
    {
        $previous = libxml_use_internal_errors(true);
        try {
            $document = new DOMDocument();
            $document->preserveWhiteSpace = true;
            if (! $document->loadXML($xml, LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING | LIBXML_COMPACT)
                || $document->documentElement === null
                || $document->doctype !== null
                || $document->documentElement->namespaceURI !== self::INVOICE_NAMESPACE
                || $document->documentElement->localName !== 'Invoice'
            ) {
                throw new InvalidArgumentException('XML فاتورة ZATCA الموقّع غير صالح.');
            }

            return $document;
        } finally {
            libxml_clear_errors();
            libxml_use_internal_errors($previous);
        }
    }
}
