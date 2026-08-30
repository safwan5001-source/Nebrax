<?php

namespace App\Services\Accounting;

use DOMDocument;
use DOMElement;
use DOMXPath;
use InvalidArgumentException;
use RuntimeException;

/** يستخرج وسمي QR 6 و7 من فاتورة موقعة ويتحقق من ارتباط الهاش بمحتواها. */
final class ZatcaSignedInvoiceQrMaterialExtractor
{
    public function __construct(private readonly ZatcaInvoiceHasher $invoiceHasher) {}

    /** @return array{invoice_hash:string, ecdsa_signature:string} بايتات خام */
    public function extract(string $signedXml): array
    {
        $document = $this->parseSecurely($signedXml);
        $xpath = new DOMXPath($document);
        $xpath->registerNamespace('ds', ZatcaXadesSignatureAssembler::XMLDSIG_NAMESPACE);

        $signatures = $this->query($xpath, '//ds:Signature');
        $signatureValues = $this->query($xpath, '//ds:Signature/ds:SignatureValue');
        $invoiceDigests = $this->query(
            $xpath,
            "//ds:Signature/ds:SignedInfo/ds:Reference[@Id='invoiceSignedData' and @URI='']/ds:DigestValue",
        );
        if ($signatures->length !== 1 || $signatureValues->length !== 1 || $invoiceDigests->length !== 1) {
            throw new InvalidArgumentException('فاتورة ZATCA الموقعة لا تحتوي مجموعة توقيع واحدة مكتملة للـQR.');
        }

        $invoiceHashBase64 = trim($invoiceDigests->item(0)?->textContent ?? '');
        $signatureBase64 = trim($signatureValues->item(0)?->textContent ?? '');
        $invoiceHash = base64_decode($invoiceHashBase64, true);
        $signature = base64_decode($signatureBase64, true);
        if (! is_string($invoiceHash) || strlen($invoiceHash) !== 32) {
            throw new InvalidArgumentException('DigestValue لفاتورة ZATCA ليس Base64 صالحاً بطول 32 بايت.');
        }
        if (! is_string($signature) || strlen($signature) !== 64) {
            throw new InvalidArgumentException('SignatureValue لفاتورة ZATCA ليس Base64 صالحاً بطول 64 بايت.');
        }

        $calculatedHash = $this->invoiceHasher->hash($signedXml);
        if (! hash_equals($calculatedHash, $invoiceHashBase64)) {
            throw new RuntimeException('هاش QR لا يطابق محتوى فاتورة ZATCA الموقعة.');
        }

        return ['invoice_hash' => $invoiceHash, 'ecdsa_signature' => $signature];
    }

    private function parseSecurely(string $xml): DOMDocument
    {
        $previous = libxml_use_internal_errors(true);
        try {
            $document = new DOMDocument();
            $document->preserveWhiteSpace = true;
            $loaded = $document->loadXML(
                $xml,
                LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING | LIBXML_COMPACT,
            );
            $root = $document->documentElement;
            if (! $loaded || ! $root instanceof DOMElement || $document->doctype !== null
                || $root->namespaceURI !== 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2'
                || $root->localName !== 'Invoice'
            ) {
                throw new RuntimeException('XML الموقّع غير صالح أو ليس فاتورة UBL آمنة.');
            }

            return $document;
        } finally {
            libxml_clear_errors();
            libxml_use_internal_errors($previous);
        }
    }

    private function query(DOMXPath $xpath, string $expression): \DOMNodeList
    {
        $nodes = $xpath->query($expression);
        if ($nodes === false) {
            throw new RuntimeException('تعذر فحص مادة QR داخل توقيع ZATCA.');
        }

        return $nodes;
    }
}
