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
        if ($signatures->length !== 1 || ! $signatures->item(0) instanceof DOMElement) {
            throw new InvalidArgumentException('فاتورة ZATCA الموقعة لا تحتوي مجموعة توقيع واحدة مكتملة للـQR.');
        }
        $signatureElement = $signatures->item(0);
        $signedInfo = $this->query($xpath, './ds:SignedInfo', $signatureElement);
        $signatureValues = $this->query($xpath, './ds:SignatureValue', $signatureElement);
        if ($signedInfo->length !== 1 || $signatureValues->length !== 1
            || ! $signedInfo->item(0) instanceof DOMElement
        ) {
            throw new InvalidArgumentException('فاتورة ZATCA الموقعة لا تحتوي SignedInfo وSignatureValue فريدتين.');
        }

        $invoiceReferences = $this->query($xpath, "./ds:Reference[@URI='']", $signedInfo->item(0));
        if ($invoiceReferences->length !== 1 || ! $invoiceReferences->item(0) instanceof DOMElement) {
            throw new InvalidArgumentException('مرجع مستند الفاتورة داخل SignedInfo مفقود أو مكرر.');
        }
        $invoiceReference = $invoiceReferences->item(0);
        $this->assertInvoiceReferenceTransforms($xpath, $invoiceReference);
        $invoiceDigests = $this->query($xpath, './ds:DigestValue', $invoiceReference);
        if ($invoiceDigests->length !== 1) {
            throw new InvalidArgumentException('مرجع الفاتورة لا يحتوي DigestValue فريدة.');
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

        $calculatedHash = base64_decode($this->invoiceHasher->hash($signedXml), true);
        if (! is_string($calculatedHash) || ! hash_equals($calculatedHash, $invoiceHash)) {
            throw new RuntimeException('هاش QR لا يطابق محتوى فاتورة ZATCA الموقعة.');
        }

        return ['invoice_hash' => $invoiceHash, 'ecdsa_signature' => $signature];
    }

    private function assertInvoiceReferenceTransforms(DOMXPath $xpath, DOMElement $reference): void
    {
        $transforms = $this->query($xpath, './ds:Transforms/ds:Transform', $reference);
        $expectedXpath = [
            'not(//ancestor-or-self::ext:UBLExtensions)',
            'not(//ancestor-or-self::cac:Signature)',
            "not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])",
        ];
        if ($transforms->length !== 4) {
            throw new InvalidArgumentException('مرجع الفاتورة لا يحتوي تحويلات ZATCA الأربع المتوقعة.');
        }
        foreach ($expectedXpath as $index => $expression) {
            $transform = $transforms->item($index);
            if (! $transform instanceof DOMElement
                || $transform->getAttribute('Algorithm') !== ZatcaXmlDsigSignedInfoBuilder::XPATH_ALGORITHM
                || trim($this->query($xpath, './ds:XPath', $transform)->item(0)?->textContent ?? '') !== $expression
            ) {
                throw new InvalidArgumentException('تحويل XPath في مرجع فاتورة ZATCA غير مطابق.');
            }
        }
        $canonicalization = $transforms->item(3);
        if (! $canonicalization instanceof DOMElement
            || $canonicalization->getAttribute('Algorithm') !== ZatcaXmlCanonicalizer::ALGORITHM
        ) {
            throw new InvalidArgumentException('تحويل C14N في مرجع فاتورة ZATCA غير مطابق.');
        }

        $digestMethods = $this->query($xpath, './ds:DigestMethod', $reference);
        if ($digestMethods->length !== 1 || ! $digestMethods->item(0) instanceof DOMElement
            || $digestMethods->item(0)->getAttribute('Algorithm') !== ZatcaXmlDsigSignedInfoBuilder::SHA256_ALGORITHM
        ) {
            throw new InvalidArgumentException('مرجع الفاتورة لا يستخدم SHA-256 المطلوب.');
        }
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

    private function query(DOMXPath $xpath, string $expression, ?DOMElement $context = null): \DOMNodeList
    {
        $nodes = $xpath->query($expression, $context);
        if ($nodes === false) {
            throw new RuntimeException('تعذر فحص مادة QR داخل توقيع ZATCA.');
        }

        return $nodes;
    }
}
