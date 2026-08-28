<?php

namespace App\Services\Accounting;

use DateTimeInterface;
use DOMDocument;
use DOMElement;
use DOMXPath;
use InvalidArgumentException;
use RuntimeException;

/**
 * يجمع توقيع XAdES داخل امتداد UBL ثم يتحقق منه بعد إعادة تسلسل المستند.
 *
 * لا تقرأ هذه الطبقة الأسرار من التخزين ولا ترسل الفاتورة؛ مدخلاتها صريحة
 * حتى يبقى حد التوقيع قابلاً للاختبار قبل ربطه بدورة ترحيل الفاتورة.
 */
final class ZatcaXadesSignatureAssembler
{
    public const EXT_NAMESPACE = 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2';
    public const SIG_NAMESPACE = 'urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2';
    public const SAC_NAMESPACE = 'urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2';
    public const SBC_NAMESPACE = 'urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2';
    public const CBC_NAMESPACE = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2';
    public const XMLDSIG_NAMESPACE = 'http://www.w3.org/2000/09/xmldsig#';
    public const XADES_NAMESPACE = 'http://uri.etsi.org/01903/v1.3.2#';
    public const EXTENSION_URI = 'urn:oasis:names:specification:ubl:dsig:enveloped:xades';
    public const SIGNATURE_INFORMATION_ID = 'urn:oasis:names:specification:ubl:signature:1';
    public const REFERENCED_SIGNATURE_ID = 'urn:oasis:names:specification:ubl:signature:Invoice';

    public function __construct(
        private readonly ZatcaInvoiceHasher $invoiceHasher,
        private readonly ZatcaXadesSignedPropertiesBuilder $signedPropertiesBuilder,
        private readonly ZatcaXmlDsigSignedInfoBuilder $signedInfoBuilder,
        private readonly ZatcaXmlCanonicalizer $canonicalizer,
        private readonly ZatcaXmlEcdsaSigner $signer,
    ) {
    }

    /**
     * @param list<string> $certificateChain Base64 DER certificates, leaf first.
     */
    public function assemble(
        string $invoiceXml,
        array $certificateChain,
        string $privateKeyPem,
        DateTimeInterface $signingTime,
        string $policyIdentifier,
        string $policyDigest,
        string $signatureId = 'signature',
        string $invoiceReferenceId = 'invoiceSignedData',
        string $signedPropertiesId = 'xadesSignedProperties',
    ): string {
        $this->assertDistinctXmlIds($signatureId, $invoiceReferenceId, $signedPropertiesId);
        $document = $this->parseSecurely($invoiceXml);
        $this->assertIdsUnused($document, $signatureId, $invoiceReferenceId, $signedPropertiesId);
        $xpath = $this->xpath($document);

        if ($this->query($xpath, '//ds:Signature')->length !== 0) {
            throw new InvalidArgumentException('فاتورة ZATCA تحتوي توقيع XML مسبقاً.');
        }
        if ($this->query($xpath, "//ext:UBLExtension[ext:ExtensionURI='".self::EXTENSION_URI."']")->length !== 0) {
            throw new InvalidArgumentException('فاتورة ZATCA تحتوي امتداد XAdES مسبقاً.');
        }

        $invoiceDigest = $this->invoiceHasher->hash($invoiceXml);
        $signature = $this->createSignatureContainer($document, $signatureId);

        $object = $this->ds($document, 'Object');
        $qualifyingProperties = $this->element($document, self::XADES_NAMESPACE, 'xades:QualifyingProperties');
        $qualifyingProperties->setAttribute('Target', '#'.$signatureId);
        $object->appendChild($qualifyingProperties);
        $signature->appendChild($object);

        $signedPropertiesXml = $this->signedPropertiesBuilder->build(
            $certificateChain,
            $signingTime,
            $policyIdentifier,
            $policyDigest,
            $signedPropertiesId,
            '#'.$invoiceReferenceId,
        );
        $signedProperties = $this->importRoot($document, $signedPropertiesXml, 'SignedProperties');
        $qualifyingProperties->appendChild($signedProperties);
        $signedPropertiesDigest = base64_encode(hash(
            'sha256',
            $this->canonicalizer->canonicalizeElementInContext($signedProperties),
            true
        ));

        $signedInfoXml = $this->signedInfoBuilder->build(
            $invoiceDigest,
            $signedPropertiesDigest,
            $invoiceReferenceId,
            $signedPropertiesId,
        );
        $signedInfo = $this->importRoot($document, $signedInfoXml, 'SignedInfo');
        $signature->insertBefore($signedInfo, $object);

        $canonicalSignedInfo = $this->canonicalizer->canonicalizeElementInContext($signedInfo);
        $signatureValueText = $this->signer->sign($canonicalSignedInfo, $privateKeyPem);
        $signatureValue = $this->ds($document, 'SignatureValue', $signatureValueText);
        $signature->insertBefore($signatureValue, $object);
        $signature->insertBefore($this->keyInfo($document, $certificateChain), $object);

        $publicKeyPem = $this->leafPublicKey($certificateChain);
        if (! $this->signer->verify($canonicalSignedInfo, $signatureValueText, $publicKeyPem)) {
            throw new RuntimeException('مفتاح ZATCA الخاص لا يطابق شهادة التوقيع.');
        }

        $signedXml = $document->saveXML();
        if ($signedXml === false) {
            throw new RuntimeException('تعذر تسلسل فاتورة ZATCA الموقعة.');
        }

        $this->verifySerializedSignature($signedXml, $publicKeyPem);

        return $signedXml;
    }

    private function createSignatureContainer(DOMDocument $document, string $signatureId): DOMElement
    {
        $root = $document->documentElement;
        if (! $root instanceof DOMElement) {
            throw new RuntimeException('XML الفاتورة يفتقد العنصر الجذر.');
        }

        $xpath = $this->xpath($document);
        $extensions = $this->query($xpath, '/inv:Invoice/ext:UBLExtensions')->item(0);
        if (! $extensions instanceof DOMElement) {
            $extensions = $this->element($document, self::EXT_NAMESPACE, 'ext:UBLExtensions');
            $root->insertBefore($extensions, $root->firstChild);
        }

        $extension = $this->element($document, self::EXT_NAMESPACE, 'ext:UBLExtension');
        $extension->appendChild($this->element($document, self::EXT_NAMESPACE, 'ext:ExtensionURI', self::EXTENSION_URI));
        $content = $this->element($document, self::EXT_NAMESPACE, 'ext:ExtensionContent');
        $extension->appendChild($content);
        $extensions->appendChild($extension);

        $documentSignatures = $this->element($document, self::SIG_NAMESPACE, 'sig:UBLDocumentSignatures');
        $signatureInformation = $this->element($document, self::SAC_NAMESPACE, 'sac:SignatureInformation');
        $signatureInformation->appendChild($this->element($document, self::CBC_NAMESPACE, 'cbc:ID', self::SIGNATURE_INFORMATION_ID));
        $signatureInformation->appendChild($this->element($document, self::SBC_NAMESPACE, 'sbc:ReferencedSignatureID', self::REFERENCED_SIGNATURE_ID));
        $signature = $this->ds($document, 'Signature');
        $signature->setAttribute('Id', $signatureId);
        $signatureInformation->appendChild($signature);
        $documentSignatures->appendChild($signatureInformation);
        $content->appendChild($documentSignatures);

        return $signature;
    }

    /** @param list<string> $certificateChain */
    private function keyInfo(DOMDocument $document, array $certificateChain): DOMElement
    {
        if ($certificateChain === [] || ! array_is_list($certificateChain)) {
            throw new InvalidArgumentException('سلسلة شهادات ZATCA يجب أن تكون قائمة غير فارغة.');
        }

        $keyInfo = $this->ds($document, 'KeyInfo');
        $x509Data = $this->ds($document, 'X509Data');
        foreach ($certificateChain as $certificate) {
            if (! is_string($certificate) || base64_decode($certificate, true) === false) {
                throw new InvalidArgumentException('سلسلة شهادات ZATCA تحتوي شهادة غير صالحة.');
            }
            $x509Data->appendChild($this->ds($document, 'X509Certificate', $certificate));
        }
        $keyInfo->appendChild($x509Data);

        return $keyInfo;
    }

    /** @param list<string> $certificateChain */
    private function leafPublicKey(array $certificateChain): string
    {
        $leaf = $certificateChain[0] ?? null;
        $der = is_string($leaf) ? base64_decode($leaf, true) : false;
        if (! is_string($der) || $der === '') {
            throw new InvalidArgumentException('شهادة توقيع ZATCA الأولى غير صالحة.');
        }

        $pem = "-----BEGIN CERTIFICATE-----\n".chunk_split(base64_encode($der), 64, "\n")."-----END CERTIFICATE-----\n";
        $certificate = @openssl_x509_read($pem);
        $publicKey = $certificate === false ? false : openssl_pkey_get_public($certificate);
        $details = $publicKey === false ? false : openssl_pkey_get_details($publicKey);
        $publicKeyPem = is_array($details) ? ($details['key'] ?? null) : null;
        if (! is_string($publicKeyPem) || $publicKeyPem === '') {
            throw new InvalidArgumentException('تعذر استخراج المفتاح العام من شهادة توقيع ZATCA.');
        }

        return $publicKeyPem;
    }

    private function verifySerializedSignature(string $xml, string $publicKeyPem): void
    {
        $document = $this->parseSecurely($xml);
        $xpath = $this->xpath($document);
        $signedInfo = $this->query($xpath, '//ds:Signature/ds:SignedInfo')->item(0);
        $signatureValue = $this->query($xpath, '//ds:Signature/ds:SignatureValue')->item(0);
        if (! $signedInfo instanceof DOMElement || ! $signatureValue instanceof DOMElement) {
            throw new RuntimeException('فاتورة ZATCA الموقعة تفتقد عناصر XMLDSig الأساسية.');
        }

        if (! $this->signer->verify(
            $this->canonicalizer->canonicalizeElementInContext($signedInfo),
            trim($signatureValue->textContent),
            $publicKeyPem,
        )) {
            throw new RuntimeException('فشل التحقق من توقيع ZATCA بعد تسلسل XML.');
        }
    }

    private function parseSecurely(string $xml): DOMDocument
    {
        $previous = libxml_use_internal_errors(true);
        try {
            $document = new DOMDocument();
            $document->preserveWhiteSpace = true;
            $loaded = $document->loadXML($xml, LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING | LIBXML_COMPACT);
            if (! $loaded || $document->documentElement === null || $document->doctype !== null) {
                throw new RuntimeException('XML غير صالح أو يحتوي DTD غير مسموح لتوقيع ZATCA.');
            }
            if (
                $document->documentElement->namespaceURI !== 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2'
                || $document->documentElement->localName !== 'Invoice'
            ) {
                throw new InvalidArgumentException('المستند المطلوب توقيعه ليس فاتورة UBL 2.1.');
            }

            return $document;
        } finally {
            libxml_clear_errors();
            libxml_use_internal_errors($previous);
        }
    }

    private function xpath(DOMDocument $document): DOMXPath
    {
        $xpath = new DOMXPath($document);
        $xpath->registerNamespace('inv', 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2');
        $xpath->registerNamespace('ext', self::EXT_NAMESPACE);
        $xpath->registerNamespace('ds', self::XMLDSIG_NAMESPACE);

        return $xpath;
    }

    private function query(DOMXPath $xpath, string $expression): \DOMNodeList
    {
        $nodes = $xpath->query($expression);
        if ($nodes === false) {
            throw new RuntimeException('تعذر فحص بنية توقيع ZATCA داخل XML.');
        }

        return $nodes;
    }

    private function importRoot(DOMDocument $target, string $xml, string $label): DOMElement
    {
        $source = $this->parseFragment($xml, $label);
        $imported = $target->importNode($source->documentElement, true);
        if (! $imported instanceof DOMElement) {
            throw new RuntimeException("تعذر إدراج {$label} داخل توقيع ZATCA.");
        }

        return $imported;
    }

    private function parseFragment(string $xml, string $label): DOMDocument
    {
        $previous = libxml_use_internal_errors(true);
        try {
            $document = new DOMDocument();
            if (! $document->loadXML($xml, LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING | LIBXML_COMPACT)
                || $document->documentElement === null || $document->doctype !== null) {
                throw new RuntimeException("{$label} الذي تم إنشاؤه غير صالح.");
            }

            return $document;
        } finally {
            libxml_clear_errors();
            libxml_use_internal_errors($previous);
        }
    }

    private function assertDistinctXmlIds(string ...$ids): void
    {
        foreach ($ids as $id) {
            if (preg_match('/^[A-Za-z_][A-Za-z0-9._-]*$/D', $id) !== 1) {
                throw new InvalidArgumentException('معرّف عنصر توقيع ZATCA ليس XML ID صالحاً.');
            }
        }
        if (count(array_unique($ids)) !== count($ids)) {
            throw new InvalidArgumentException('معرّفات عناصر توقيع ZATCA يجب أن تكون فريدة.');
        }
    }

    private function assertIdsUnused(DOMDocument $document, string ...$ids): void
    {
        $reserved = array_fill_keys($ids, true);

        foreach ($document->getElementsByTagName('*') as $element) {
            foreach ($element->attributes as $attribute) {
                $isPlainId = $attribute->namespaceURI === null && $attribute->nodeName === 'Id';
                $isXmlId = $attribute->namespaceURI === 'http://www.w3.org/XML/1998/namespace'
                    && $attribute->localName === 'id';

                if (($isPlainId || $isXmlId) && isset($reserved[$attribute->nodeValue])) {
                    throw new InvalidArgumentException(
                        'معرّف عنصر توقيع ZATCA مستخدم مسبقاً داخل الفاتورة.'
                    );
                }
            }
        }
    }

    private function ds(DOMDocument $document, string $name, ?string $value = null): DOMElement
    {
        return $this->element($document, self::XMLDSIG_NAMESPACE, 'ds:'.$name, $value);
    }

    private function element(DOMDocument $document, string $namespace, string $name, ?string $value = null): DOMElement
    {
        $element = $document->createElementNS($namespace, $name);
        if ($value !== null) {
            $element->appendChild($document->createTextNode($value));
        }

        return $element;
    }
}
