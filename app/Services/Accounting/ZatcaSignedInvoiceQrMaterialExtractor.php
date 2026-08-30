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
    private const CAC_NAMESPACE = 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2';

    public function __construct(
        private readonly ZatcaInvoiceHasher $invoiceHasher,
        private readonly ZatcaXmlCanonicalizer $canonicalizer,
        private readonly ZatcaXmlEcdsaSigner $signatureVerifier,
    ) {}

    /** @return array{invoice_hash:string, ecdsa_signature:string} بايتات خام */
    public function extract(string $signedXml): array
    {
        $document = $this->parseSecurely($signedXml);
        $xpath = new DOMXPath($document);
        $xpath->registerNamespace('inv', 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2');
        $xpath->registerNamespace('ext', ZatcaXadesSignatureAssembler::EXT_NAMESPACE);
        $xpath->registerNamespace('sig', ZatcaXadesSignatureAssembler::SIG_NAMESPACE);
        $xpath->registerNamespace('sac', ZatcaXadesSignatureAssembler::SAC_NAMESPACE);
        $xpath->registerNamespace('sbc', ZatcaXadesSignatureAssembler::SBC_NAMESPACE);
        $xpath->registerNamespace('cbc', ZatcaXadesSignatureAssembler::CBC_NAMESPACE);
        $xpath->registerNamespace('ds', ZatcaXadesSignatureAssembler::XMLDSIG_NAMESPACE);
        $xpath->registerNamespace('xades', ZatcaXadesSignatureAssembler::XADES_NAMESPACE);

        $allSignatures = $this->query($xpath, '//ds:Signature');
        $extensionWrappers = $this->query($xpath, '/inv:Invoice/ext:UBLExtensions');
        if ($extensionWrappers->length !== 1 || ! $extensionWrappers->item(0) instanceof DOMElement) {
            throw new InvalidArgumentException('فاتورة ZATCA يجب أن تحتوي غلاف UBLExtensions جذرياً واحداً.');
        }
        $officialExtensions = $this->query(
            $xpath,
            "./ext:UBLExtension[ext:ExtensionURI='".
            ZatcaXadesSignatureAssembler::EXTENSION_URI.
            "']",
            $extensionWrappers->item(0),
        );
        if ($officialExtensions->length !== 1 || ! $officialExtensions->item(0) instanceof DOMElement) {
            throw new InvalidArgumentException('فاتورة ZATCA لا تحتوي امتداد UBL رسمياً وفريداً.');
        }
        $officialExtension = $officialExtensions->item(0);
        $extensionUris = $this->query($xpath, './ext:ExtensionURI', $officialExtension);
        $extensionContents = $this->query($xpath, './ext:ExtensionContent', $officialExtension);
        if ($extensionUris->length !== 1
            || trim($extensionUris->item(0)?->textContent ?? '') !== ZatcaXadesSignatureAssembler::EXTENSION_URI
            || $extensionContents->length !== 1
            || ! $extensionContents->item(0) instanceof DOMElement
        ) {
            throw new InvalidArgumentException('حقول امتداد UBL الرسمي مفقودة أو مكررة.');
        }
        $documentSignatures = $this->query(
            $xpath,
            './sig:UBLDocumentSignatures',
            $extensionContents->item(0),
        );
        if ($documentSignatures->length !== 1 || ! $documentSignatures->item(0) instanceof DOMElement) {
            throw new InvalidArgumentException('حاوية توقيع UBL الرسمية مفقودة أو مكررة.');
        }
        $signatureInformation = $this->query(
            $xpath,
            './sac:SignatureInformation',
            $documentSignatures->item(0),
        );
        if ($signatureInformation->length !== 1 || ! $signatureInformation->item(0) instanceof DOMElement) {
            throw new InvalidArgumentException('SignatureInformation الرسمية مفقودة أو مكررة.');
        }
        $informationIds = $this->query($xpath, './cbc:ID', $signatureInformation->item(0));
        $referencedIds = $this->query(
            $xpath,
            './sbc:ReferencedSignatureID',
            $signatureInformation->item(0),
        );
        $signatures = $this->query($xpath, './ds:Signature', $signatureInformation->item(0));
        if ($informationIds->length !== 1
            || trim($informationIds->item(0)?->textContent ?? '') !== ZatcaXadesSignatureAssembler::SIGNATURE_INFORMATION_ID
            || $referencedIds->length !== 1
            || trim($referencedIds->item(0)?->textContent ?? '') !== ZatcaXadesSignatureAssembler::REFERENCED_SIGNATURE_ID
            || $allSignatures->length !== 1
            || $signatures->length !== 1
            || ! $signatures->item(0) instanceof DOMElement
            || ! $allSignatures->item(0) instanceof DOMElement
            || ! $allSignatures->item(0)->isSameNode($signatures->item(0))
        ) {
            throw new InvalidArgumentException('حقول حاوية توقيع UBL الرسمية مفقودة أو مكررة أو متضاربة.');
        }
        $signatureElement = $signatures->item(0);
        $signedInfo = $this->query($xpath, './ds:SignedInfo', $signatureElement);
        $signatureValues = $this->query($xpath, './ds:SignatureValue', $signatureElement);
        if ($signedInfo->length !== 1 || $signatureValues->length !== 1
            || ! $signedInfo->item(0) instanceof DOMElement
        ) {
            throw new InvalidArgumentException('فاتورة ZATCA الموقعة لا تحتوي SignedInfo وSignatureValue فريدتين.');
        }
        $this->assertSignedInfoAlgorithms($xpath, $signedInfo->item(0));

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
        $references = $this->query($xpath, './ds:Reference', $signedInfo->item(0));
        if ($references->length !== 2) {
            throw new InvalidArgumentException('SignedInfo يجب أن تحتوي مرجعي الفاتورة وSignedProperties فقط.');
        }
        $signedProperties = $this->assertSignedPropertiesReference(
            $xpath,
            $signatureElement,
            $signedInfo->item(0),
        );
        $this->assertInvoiceDataObjectFormat($xpath, $signedProperties, $invoiceReference);

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

        $keyInfo = $this->query($xpath, './ds:KeyInfo', $signatureElement);
        if ($keyInfo->length !== 1 || ! $keyInfo->item(0) instanceof DOMElement) {
            throw new InvalidArgumentException('توقيع فاتورة ZATCA لا يحتوي KeyInfo فريدة.');
        }
        $x509Data = $this->query($xpath, './ds:X509Data', $keyInfo->item(0));
        if ($x509Data->length !== 1 || ! $x509Data->item(0) instanceof DOMElement) {
            throw new InvalidArgumentException('توقيع فاتورة ZATCA لا يحتوي X509Data فريدة.');
        }
        $certificates = $this->query($xpath, './ds:X509Certificate', $x509Data->item(0));
        if ($certificates->length < 1) {
            throw new InvalidArgumentException('توقيع فاتورة ZATCA يفتقد شهادة leaf.');
        }
        $this->assertSigningCertificateDigests($xpath, $signedProperties, $certificates);
        $publicKeyPem = $this->publicKeyPem(trim($certificates->item(0)?->textContent ?? ''));
        if (! $this->signatureVerifier->verify(
            $this->canonicalizer->canonicalizeElementInContext($signedInfo->item(0)),
            $signatureBase64,
            $publicKeyPem,
        )) {
            throw new RuntimeException('SignatureValue لا يطابق SignedInfo وشهادة leaf المضمّنة.');
        }

        $calculatedHash = base64_decode($this->invoiceHasher->hash($signedXml), true);
        if (! is_string($calculatedHash) || ! hash_equals($calculatedHash, $invoiceHash)) {
            throw new RuntimeException('هاش QR لا يطابق محتوى فاتورة ZATCA الموقعة.');
        }

        return ['invoice_hash' => $invoiceHash, 'ecdsa_signature' => $signature];
    }

    private function assertInvoiceDataObjectFormat(
        DOMXPath $xpath,
        DOMElement $signedProperties,
        DOMElement $invoiceReference,
    ): void {
        $referenceId = $invoiceReference->getAttribute('Id');
        $referenceTargets = preg_match('/^[A-Za-z_][A-Za-z0-9._-]*$/D', $referenceId) === 1
            ? $this->elementsWithId($invoiceReference->ownerDocument, $referenceId)
            : [];
        if (count($referenceTargets) !== 1 || ! $referenceTargets[0]->isSameNode($invoiceReference)) {
            throw new InvalidArgumentException('معرّف مرجع فاتورة ZATCA مفقود أو مكرر على مستوى المستند.');
        }
        $dataObjectProperties = $this->query(
            $xpath,
            './xades:SignedDataObjectProperties',
            $signedProperties,
        );
        if ($dataObjectProperties->length !== 1
            || ! $dataObjectProperties->item(0) instanceof DOMElement
        ) {
            throw new InvalidArgumentException('SignedProperties لا تحتوي SignedDataObjectProperties فريدة.');
        }
        $formats = $this->query(
            $xpath,
            './xades:DataObjectFormat',
            $dataObjectProperties->item(0),
        );
        if ($formats->length !== 1 || ! $formats->item(0) instanceof DOMElement
            || $formats->item(0)->getAttribute('ObjectReference') !== '#'.$referenceId
        ) {
            throw new InvalidArgumentException('DataObjectFormat لا ترتبط بمرجع فاتورة ZATCA الفريد.');
        }
        $dataObjectChildren = $this->elementChildren($dataObjectProperties->item(0));
        $formatChildren = $this->elementChildren($formats->item(0));
        if (count($dataObjectChildren) !== 1
            || ! $dataObjectChildren[0]->isSameNode($formats->item(0))
            || count($formatChildren) !== 1
            || $formatChildren[0]->namespaceURI !== ZatcaXadesSignatureAssembler::XADES_NAMESPACE
            || $formatChildren[0]->localName !== 'MimeType'
            || trim($formatChildren[0]->textContent) !== 'text/xml'
        ) {
            throw new InvalidArgumentException('DataObjectFormat يجب أن تحتوي MimeType فريدة بقيمة text/xml.');
        }
    }

    private function assertSigningCertificateDigests(
        DOMXPath $xpath,
        DOMElement $signedProperties,
        \DOMNodeList $certificates,
    ): void {
        $signatureProperties = $this->query(
            $xpath,
            './xades:SignedSignatureProperties',
            $signedProperties,
        );
        if ($signatureProperties->length !== 1 || ! $signatureProperties->item(0) instanceof DOMElement) {
            throw new InvalidArgumentException('SignedProperties لا تحتوي SignedSignatureProperties فريدة.');
        }
        $signingCertificates = $this->query(
            $xpath,
            './xades:SigningCertificateV2',
            $signatureProperties->item(0),
        );
        if ($signingCertificates->length !== 1 || ! $signingCertificates->item(0) instanceof DOMElement) {
            throw new InvalidArgumentException('SignedProperties لا تحتوي SigningCertificateV2 فريدة.');
        }
        $certificateEntries = $this->query(
            $xpath,
            './xades:Cert',
            $signingCertificates->item(0),
        );
        if ($certificateEntries->length !== $certificates->length) {
            throw new RuntimeException('بصمات SigningCertificateV2 لا تطابق سلسلة شهادات KeyInfo.');
        }
        for ($index = 0; $index < $certificates->length; $index++) {
            $certificateEntry = $certificateEntries->item($index);
            if (! $certificateEntry instanceof DOMElement) {
                throw new InvalidArgumentException('بنية شهادة XAdES غير صالحة.');
            }
            $entryDigests = $this->query($xpath, './xades:CertDigest', $certificateEntry);
            if ($entryDigests->length !== 1 || ! $entryDigests->item(0) instanceof DOMElement) {
                throw new InvalidArgumentException('كل عنصر Cert في XAdES يجب أن يحتوي CertDigest مباشرة وفريدة.');
            }
            $certDigest = $entryDigests->item(0);
            $methods = $this->query($xpath, './ds:DigestMethod', $certDigest);
            $values = $this->query($xpath, './ds:DigestValue', $certDigest);
            if ($methods->length !== 1 || ! $methods->item(0) instanceof DOMElement
                || $methods->item(0)->getAttribute('Algorithm') !== ZatcaXmlDsigSignedInfoBuilder::SHA256_ALGORITHM
                || $values->length !== 1
            ) {
                throw new InvalidArgumentException('بصمة شهادة XAdES لا تستخدم SHA-256 بشكل فريد.');
            }
            $declared = base64_decode(trim($values->item(0)?->textContent ?? ''), true);
            $der = $this->certificateDer(trim($certificates->item($index)?->textContent ?? ''));
            if (! is_string($declared) || strlen($declared) !== 32
                || ! hash_equals(hash('sha256', $der, true), $declared)
            ) {
                throw new RuntimeException('بصمة SigningCertificateV2 لا تطابق شهادة KeyInfo المقابلة.');
            }
        }
    }

    private function assertSignedPropertiesReference(
        DOMXPath $xpath,
        DOMElement $signature,
        DOMElement $signedInfo,
    ): DOMElement {
        $references = $this->query(
            $xpath,
            "./ds:Reference[@Type='".ZatcaXmlDsigSignedInfoBuilder::SIGNED_PROPERTIES_TYPE."']",
            $signedInfo,
        );
        if ($references->length !== 1 || ! $references->item(0) instanceof DOMElement) {
            throw new InvalidArgumentException('مرجع SignedProperties مفقود أو مكرر.');
        }
        $reference = $references->item(0);
        $uri = $reference->getAttribute('URI');
        if (preg_match('/^#([A-Za-z_][A-Za-z0-9._-]*)$/D', $uri, $match) !== 1) {
            throw new InvalidArgumentException('URI مرجع SignedProperties ليس XML ID محلياً صالحاً.');
        }
        $signatureId = $signature->getAttribute('Id');
        $signatureTargets = preg_match('/^[A-Za-z_][A-Za-z0-9._-]*$/D', $signatureId) === 1
            ? $this->elementsWithId($signature->ownerDocument, $signatureId)
            : [];
        if (count($signatureTargets) !== 1 || ! $signatureTargets[0]->isSameNode($signature)) {
            throw new InvalidArgumentException('معرّف توقيع ZATCA مفقود أو مكرر على مستوى المستند.');
        }
        $qualifyingProperties = $this->query(
            $xpath,
            './ds:Object/xades:QualifyingProperties',
            $signature,
        );
        if ($qualifyingProperties->length !== 1
            || ! $qualifyingProperties->item(0) instanceof DOMElement
            || $qualifyingProperties->item(0)->getAttribute('Target') !== '#'.$signatureId
        ) {
            throw new InvalidArgumentException('QualifyingProperties لا ترتبط بتوقيع ZATCA عبر Target صالح وفريد.');
        }
        $targets = $this->query($xpath, './xades:SignedProperties', $qualifyingProperties->item(0));
        $documentTargets = $this->elementsWithId($signature->ownerDocument, $match[1]);
        if ($targets->length !== 1 || ! $targets->item(0) instanceof DOMElement
            || $targets->item(0)->getAttribute('Id') !== $match[1]
            || count($documentTargets) !== 1
            || ! $documentTargets[0]->isSameNode($targets->item(0))
        ) {
            throw new InvalidArgumentException('عنصر SignedProperties المستهدف مفقود أو مكرر.');
        }

        $transformContainers = $this->query($xpath, './ds:Transforms', $reference);
        $transforms = $transformContainers->length === 1 && $transformContainers->item(0) instanceof DOMElement
            ? $this->query($xpath, './ds:Transform', $transformContainers->item(0))
            : null;
        if ($transforms === null || $transforms->length !== 1 || ! $transforms->item(0) instanceof DOMElement
            || $transforms->item(0)->getAttribute('Algorithm') !== ZatcaXmlCanonicalizer::ALGORITHM
        ) {
            throw new InvalidArgumentException('مرجع SignedProperties لا يستخدم تحويل C14N المطلوب وحده.');
        }
        $digestMethods = $this->query($xpath, './ds:DigestMethod', $reference);
        if ($digestMethods->length !== 1 || ! $digestMethods->item(0) instanceof DOMElement
            || $digestMethods->item(0)->getAttribute('Algorithm') !== ZatcaXmlDsigSignedInfoBuilder::SHA256_ALGORITHM
        ) {
            throw new InvalidArgumentException('مرجع SignedProperties لا يستخدم SHA-256 المطلوب.');
        }
        $digestValues = $this->query($xpath, './ds:DigestValue', $reference);
        $digest = $digestValues->length === 1
            ? base64_decode(trim($digestValues->item(0)?->textContent ?? ''), true)
            : false;
        if (! is_string($digest) || strlen($digest) !== 32) {
            throw new InvalidArgumentException('DigestValue لـSignedProperties غير صالح.');
        }
        $calculated = hash(
            'sha256',
            $this->canonicalizer->canonicalizeElementInContext($targets->item(0)),
            true,
        );
        if (! hash_equals($calculated, $digest)) {
            throw new RuntimeException('DigestValue لا يطابق SignedProperties المضمّنة.');
        }

        return $targets->item(0);
    }

    /** @return list<DOMElement> */
    private function elementsWithId(DOMDocument $document, string $id): array
    {
        $matches = [];
        foreach ($document->getElementsByTagName('*') as $element) {
            foreach ($element->attributes as $attribute) {
                $plainId = $attribute->namespaceURI === null && $attribute->nodeName === 'Id';
                $xmlId = $attribute->namespaceURI === 'http://www.w3.org/XML/1998/namespace'
                    && $attribute->localName === 'id';
                if (($plainId || $xmlId) && hash_equals($id, $attribute->nodeValue)) {
                    $matches[] = $element;
                    break;
                }
            }
        }

        return $matches;
    }

    /** @return list<DOMElement> */
    private function elementChildren(DOMElement $parent): array
    {
        $children = [];
        foreach ($parent->childNodes as $child) {
            if ($child instanceof DOMElement) {
                $children[] = $child;
            }
        }

        return $children;
    }

    private function assertSignedInfoAlgorithms(DOMXPath $xpath, DOMElement $signedInfo): void
    {
        $canonicalization = $this->query($xpath, './ds:CanonicalizationMethod', $signedInfo);
        $signatureMethod = $this->query($xpath, './ds:SignatureMethod', $signedInfo);
        if ($canonicalization->length !== 1 || ! $canonicalization->item(0) instanceof DOMElement
            || $canonicalization->item(0)->getAttribute('Algorithm') !== ZatcaXmlCanonicalizer::ALGORITHM
        ) {
            throw new InvalidArgumentException('SignedInfo لا تعلن خوارزمية C14N المطلوبة لـZATCA.');
        }
        if ($signatureMethod->length !== 1 || ! $signatureMethod->item(0) instanceof DOMElement
            || $signatureMethod->item(0)->getAttribute('Algorithm') !== ZatcaXmlDsigSignedInfoBuilder::ECDSA_SHA256_ALGORITHM
        ) {
            throw new InvalidArgumentException('SignedInfo لا تعلن خوارزمية ECDSA-SHA256 المطلوبة لـZATCA.');
        }
    }

    private function publicKeyPem(string $certificateBase64): string
    {
        $der = $this->certificateDer($certificateBase64);
        $pem = "-----BEGIN CERTIFICATE-----\n"
            .chunk_split(base64_encode($der), 64, "\n")
            ."-----END CERTIFICATE-----\n";
        $certificate = @openssl_x509_read($pem);
        $publicKey = $certificate === false ? false : openssl_pkey_get_public($certificate);
        $details = $publicKey === false ? false : openssl_pkey_get_details($publicKey);
        $publicKeyPem = is_array($details) ? ($details['key'] ?? null) : null;
        if (! is_string($publicKeyPem) || $publicKeyPem === '') {
            throw new InvalidArgumentException('تعذر استخراج المفتاح العام من شهادة leaf المضمّنة.');
        }

        return $publicKeyPem;
    }

    private function certificateDer(string $certificateBase64): string
    {
        $der = base64_decode($certificateBase64, true);
        if (! is_string($der) || $der === '') {
            throw new InvalidArgumentException('شهادة ZATCA المضمّنة ليست Base64 DER صالحة.');
        }
        $pem = "-----BEGIN CERTIFICATE-----\n"
            .chunk_split(base64_encode($der), 64, "\n")
            ."-----END CERTIFICATE-----\n";
        $certificate = @openssl_x509_read($pem);
        $normalizedPem = '';
        if ($certificate === false || ! openssl_x509_export($certificate, $normalizedPem, true)) {
            throw new InvalidArgumentException('شهادة ZATCA المضمّنة ليست شهادة X.509 صالحة.');
        }
        $normalizedBody = preg_replace(
            '/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s+/',
            '',
            $normalizedPem,
        );
        $normalizedDer = is_string($normalizedBody)
            ? base64_decode($normalizedBody, true)
            : false;
        if (! is_string($normalizedDer) || ! hash_equals($normalizedDer, $der)) {
            throw new InvalidArgumentException('شهادة ZATCA المضمّنة تحتوي بايتات خارج DER.');
        }

        return $normalizedDer;
    }

    private function assertInvoiceReferenceTransforms(DOMXPath $xpath, DOMElement $reference): void
    {
        $transformContainers = $this->query($xpath, './ds:Transforms', $reference);
        $transforms = $transformContainers->length === 1 && $transformContainers->item(0) instanceof DOMElement
            ? $this->query($xpath, './ds:Transform', $transformContainers->item(0))
            : null;
        $expectedXpath = [
            'not(//ancestor-or-self::ext:UBLExtensions)',
            'not(//ancestor-or-self::cac:Signature)',
            "not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])",
        ];
        if ($transforms === null || $transforms->length !== 4) {
            throw new InvalidArgumentException('مرجع الفاتورة لا يحتوي تحويلات ZATCA الأربع المتوقعة.');
        }
        foreach ($expectedXpath as $index => $expression) {
            $transform = $transforms->item($index);
            $xpathNodes = $transform instanceof DOMElement
                ? $this->query($xpath, './ds:XPath', $transform)
                : null;
            $xpathElement = $xpathNodes?->length === 1 ? $xpathNodes->item(0) : null;
            if (! $transform instanceof DOMElement
                || $transform->getAttribute('Algorithm') !== ZatcaXmlDsigSignedInfoBuilder::XPATH_ALGORITHM
                || ! $xpathElement instanceof DOMElement
                || trim($xpathElement->textContent) !== $expression
            ) {
                throw new InvalidArgumentException('تحويل XPath في مرجع فاتورة ZATCA غير مطابق.');
            }
            $requiredNamespaces = match ($index) {
                0 => ['ext' => ZatcaXadesSignatureAssembler::EXT_NAMESPACE],
                1 => ['cac' => self::CAC_NAMESPACE],
                2 => [
                    'cac' => self::CAC_NAMESPACE,
                    'cbc' => ZatcaXadesSignatureAssembler::CBC_NAMESPACE,
                ],
            };
            foreach ($requiredNamespaces as $prefix => $namespace) {
                if ($xpathElement->lookupNamespaceURI($prefix) !== $namespace) {
                    throw new InvalidArgumentException("بادئة {$prefix} داخل تحويل XPath غير مرتبطة بمساحة UBL المطلوبة.");
                }
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
