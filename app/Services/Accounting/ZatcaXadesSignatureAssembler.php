<?php

namespace App\Services\Accounting;

use DateTimeInterface;
use DOMDocument;
use DOMElement;
use DOMXPath;
use InvalidArgumentException;
use RuntimeException;

/**
 * يجمع توقيع XAdES داخل امتداد UBL — REM-17.
 *
 * التسلسل (الدليل الفني التفصيلي، الخطوات 1–6): هاش الفاتورة → توقيع ECDSA على بايتات الهاش الخام (DER) →
 * SignedProperties وبصمتها → SignedInfo بالبصمتين → إدراج الامتداد. يُدرج الامتداد **نصاً** مباشرةً بعد وسم الجذر
 * الافتتاحي ولا يُعاد تسلسل المستند: بصمة SignedProperties حسّاسة للمسافات، وأي مسافة تُضاف حول UBLExtensions تغيّر
 * هاش الفاتورة نفسه. بعد الإدراج يُعاد التحقق من أن هاش الناتج يساوي البصمة الموقَّعة.
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

    /** وسم جذر Invoice الافتتاحي (بعد إعلان XML وتعليقات/تعليمات معالجة اختيارية). */
    private const ROOT_START_TAG = '/^(?:\xEF\xBB\xBF)?(?:<\?xml[^>]*\?>)?(?:\s|<!--(?:(?!-->).)*-->|<\?(?:(?!\?>).)*\?>)*'
        .'<(?:[A-Za-z_][\w.-]*:)?Invoice(?:\s+[^\s=\/>]+\s*=\s*(?:"[^"]*"|\'[^\']*\'))*\s*>/s';

    public function __construct(
        private readonly ZatcaInvoiceHasher $invoiceHasher,
        private readonly ZatcaXadesSignedPropertiesBuilder $signedPropertiesBuilder,
        private readonly ZatcaXmlDsigSignedInfoBuilder $signedInfoBuilder,
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
        $existingWrapper = $this->query($xpath, '/inv:Invoice/ext:UBLExtensions')->item(0);
        if ($this->query($xpath, '//ext:UBLExtensions')->length !== ($existingWrapper === null ? 0 : 1)) {
            throw new InvalidArgumentException('غلاف UBLExtensions في فاتورة ZATCA مكرر أو في غير موضعه.');
        }
        if ($this->query($xpath, "//ext:UBLExtension[ext:ExtensionURI='".self::EXTENSION_URI."']")->length !== 0) {
            throw new InvalidArgumentException('فاتورة ZATCA تحتوي امتداد XAdES مسبقاً.');
        }

        $certificates = $this->canonicalChain($certificateChain);
        $publicKeyPem = $this->leafPublicKey($certificates);

        $invoiceDigest = $this->invoiceHasher->hash($invoiceXml);
        $invoiceHash = base64_decode($invoiceDigest, true);
        if (! is_string($invoiceHash) || strlen($invoiceHash) !== 32) {
            throw new RuntimeException('هاش فاتورة ZATCA غير صالح للتوقيع.');
        }

        $signatureValue = $this->signer->sign($invoiceHash, $privateKeyPem);
        if (! $this->signer->verify($invoiceHash, $signatureValue, $publicKeyPem)) {
            throw new RuntimeException('مفتاح ZATCA الخاص لا يطابق شهادة التوقيع.');
        }

        $signedProperties = $this->signedPropertiesBuilder->build(
            $certificates,
            $signingTime,
            $policyIdentifier,
            $policyDigest,
            $signedPropertiesId,
            '#'.$invoiceReferenceId,
        );
        $signedInfo = $this->signedInfoBuilder->build(
            $invoiceDigest,
            $signedProperties['digest'],
            $invoiceReferenceId,
            $signedPropertiesId,
        );

        $keyInfo = '';
        foreach ($certificates as $certificate) {
            $keyInfo .= '<ds:X509Certificate>'.$certificate.'</ds:X509Certificate>';
        }

        $extension = '<ext:UBLExtension xmlns:ext="'.self::EXT_NAMESPACE.'">'
            .'<ext:ExtensionURI>'.self::EXTENSION_URI.'</ext:ExtensionURI><ext:ExtensionContent>'
            .'<sig:UBLDocumentSignatures xmlns:sig="'.self::SIG_NAMESPACE.'" xmlns:sac="'.self::SAC_NAMESPACE.'" xmlns:sbc="'.self::SBC_NAMESPACE.'">'
            .'<sac:SignatureInformation><cbc:ID xmlns:cbc="'.self::CBC_NAMESPACE.'">'.self::SIGNATURE_INFORMATION_ID.'</cbc:ID>'
            .'<sbc:ReferencedSignatureID>'.self::REFERENCED_SIGNATURE_ID.'</sbc:ReferencedSignatureID>'
            .'<ds:Signature xmlns:ds="'.self::XMLDSIG_NAMESPACE.'" Id="'.$signatureId.'">'
            .$signedInfo
            .'<ds:SignatureValue>'.$signatureValue.'</ds:SignatureValue>'
            .'<ds:KeyInfo><ds:X509Data>'.$keyInfo.'</ds:X509Data></ds:KeyInfo>'
            .'<ds:Object><xades:QualifyingProperties xmlns:xades="'.self::XADES_NAMESPACE.'" Target="#'.$signatureId.'">'
            .$signedProperties['xml']
            .'</xades:QualifyingProperties></ds:Object>'
            .'</ds:Signature></sac:SignatureInformation></sig:UBLDocumentSignatures>'
            .'</ext:ExtensionContent></ext:UBLExtension>';

        $signedXml = $existingWrapper instanceof DOMElement
            ? $this->appendToExistingWrapper($invoiceXml, $existingWrapper, $extension)
            : $this->insertWrapper($invoiceXml, $extension);

        $signedDocument = $this->parseSecurely($signedXml);
        $firstChild = $signedDocument->documentElement?->firstElementChild;
        if (! $firstChild instanceof DOMElement
            || $firstChild->namespaceURI !== self::EXT_NAMESPACE
            || $firstChild->localName !== 'UBLExtensions'
        ) {
            throw new RuntimeException('تعذر إدراج امتداد توقيع ZATCA أولَ أبناء جذر الفاتورة.');
        }
        // الإدراج نصّي: يُثبت أن التوقيع صار عنصراً فعلياً واحداً داخل الامتداد الرسمي (لا داخل تعليق مثلاً).
        $signedXpath = $this->xpath($signedDocument);
        if ($this->query($signedXpath, '//ds:Signature')->length !== 1
            || $this->query($signedXpath, "/inv:Invoice/ext:UBLExtensions/ext:UBLExtension[ext:ExtensionURI='".self::EXTENSION_URI."']"
                ."/ext:ExtensionContent//ds:Signature[@Id='".$signatureId."']")->length !== 1
        ) {
            throw new RuntimeException('امتداد توقيع ZATCA لم يُدرج في موضعه الرسمي.');
        }
        if (! hash_equals($invoiceDigest, $this->invoiceHasher->hash($signedXml))) {
            throw new RuntimeException('إدراج توقيع ZATCA غيّر هاش الفاتورة.');
        }

        return $signedXml;
    }

    /** غلاف جديد مباشرةً بعد وسم الجذر الافتتاحي، بلا أي مسافة مضافة (المسافات خارج الغلاف تدخل في هاش الفاتورة). */
    private function insertWrapper(string $invoiceXml, string $extension): string
    {
        if (preg_match(self::ROOT_START_TAG, $invoiceXml, $match) !== 1) {
            throw new InvalidArgumentException('تعذر تحديد وسم جذر فاتورة ZATCA لإدراج التوقيع.');
        }

        return $match[0].'<ext:UBLExtensions xmlns:ext="'.self::EXT_NAMESPACE.'">'.$extension.'</ext:UBLExtensions>'
            .substr($invoiceXml, strlen($match[0]));
    }

    /** امتدادات غير التوقيع تبقى كما هي، ويُضاف امتداد التوقيع آخرها قبل الوسم الختامي الوحيد للغلاف. */
    private function appendToExistingWrapper(string $invoiceXml, DOMElement $wrapper, string $extension): string
    {
        if ($wrapper->prefix !== 'ext' || substr_count($invoiceXml, '</ext:UBLExtensions>') !== 1) {
            throw new InvalidArgumentException('تعذر تحديد غلاف UBLExtensions القائم بلا لبس لإدراج التوقيع.');
        }
        $position = strpos($invoiceXml, '</ext:UBLExtensions>');

        return substr($invoiceXml, 0, (int) $position).$extension.substr($invoiceXml, (int) $position);
    }

    /**
     * @param list<string> $certificateChain
     * @return list<string> Base64 قياسي بلا مسافات لكل شهادة (هو نفسه في KeyInfo وفي بصمة الشهادة).
     */
    private function canonicalChain(array $certificateChain): array
    {
        if ($certificateChain === [] || ! array_is_list($certificateChain)) {
            throw new InvalidArgumentException('سلسلة شهادات ZATCA يجب أن تكون قائمة غير فارغة.');
        }

        return array_map(function ($certificate): string {
            $der = is_string($certificate) ? base64_decode($certificate, true) : false;
            if (! is_string($der) || $der === '') {
                throw new InvalidArgumentException('سلسلة شهادات ZATCA تحتوي شهادة غير صالحة.');
            }

            return base64_encode($der);
        }, $certificateChain);
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
}
