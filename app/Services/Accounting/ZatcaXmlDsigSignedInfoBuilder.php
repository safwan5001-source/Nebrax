<?php

namespace App\Services\Accounting;

use DOMDocument;
use DOMElement;
use InvalidArgumentException;
use RuntimeException;

final class ZatcaXmlDsigSignedInfoBuilder
{
    public const XMLDSIG_NAMESPACE = 'http://www.w3.org/2000/09/xmldsig#';
    public const SHA256_ALGORITHM = 'http://www.w3.org/2001/04/xmlenc#sha256';
    public const ECDSA_SHA256_ALGORITHM = 'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256';
    public const XPATH_ALGORITHM = 'http://www.w3.org/TR/1999/REC-xpath-19991116';
    public const SIGNED_PROPERTIES_TYPE = 'http://uri.etsi.org/01903#SignedProperties';

    private const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/';
    private const EXT_NAMESPACE = 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2';
    private const CAC_NAMESPACE = 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2';
    private const CBC_NAMESPACE = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2';

    public function __construct(private readonly ZatcaXmlCanonicalizer $canonicalizer)
    {
    }

    public function build(
        string $invoiceDigest,
        string $signedPropertiesDigest,
        string $invoiceReferenceId = 'invoiceSignedData',
        string $signedPropertiesId = 'xadesSignedProperties',
    ): string {
        $this->assertSha256Digest($invoiceDigest, 'بصمة الفاتورة');
        $this->assertSha256Digest($signedPropertiesDigest, 'بصمة SignedProperties');
        $this->assertXmlId($invoiceReferenceId, 'معرّف مرجع الفاتورة');
        $this->assertXmlId($signedPropertiesId, 'معرّف SignedProperties');

        $document = new DOMDocument('1.0', 'UTF-8');
        $document->formatOutput = false;

        $root = $document->createElementNS(self::XMLDSIG_NAMESPACE, 'ds:SignedInfo');
        $root->setAttributeNS(self::XMLNS_NAMESPACE, 'xmlns:ext', self::EXT_NAMESPACE);
        $root->setAttributeNS(self::XMLNS_NAMESPACE, 'xmlns:cac', self::CAC_NAMESPACE);
        $root->setAttributeNS(self::XMLNS_NAMESPACE, 'xmlns:cbc', self::CBC_NAMESPACE);
        $document->appendChild($root);

        $canonicalization = $this->ds($document, 'CanonicalizationMethod');
        $canonicalization->setAttribute('Algorithm', ZatcaXmlCanonicalizer::ALGORITHM);
        $root->appendChild($canonicalization);

        $signatureMethod = $this->ds($document, 'SignatureMethod');
        $signatureMethod->setAttribute('Algorithm', self::ECDSA_SHA256_ALGORITHM);
        $root->appendChild($signatureMethod);

        $invoiceReference = $this->ds($document, 'Reference');
        $invoiceReference->setAttribute('Id', $invoiceReferenceId);
        $invoiceReference->setAttribute('URI', '');
        $invoiceTransforms = $this->ds($document, 'Transforms');

        foreach ([
            'not(//ancestor-or-self::ext:UBLExtensions)',
            'not(//ancestor-or-self::cac:Signature)',
            "not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])",
        ] as $expression) {
            $transform = $this->ds($document, 'Transform');
            $transform->setAttribute('Algorithm', self::XPATH_ALGORITHM);
            $transform->appendChild($this->ds($document, 'XPath', $expression));
            $invoiceTransforms->appendChild($transform);
        }

        $invoiceTransforms->appendChild($this->canonicalizationTransform($document));
        $invoiceReference->appendChild($invoiceTransforms);
        $invoiceReference->appendChild($this->digestMethod($document));
        $invoiceReference->appendChild($this->ds($document, 'DigestValue', $invoiceDigest));
        $root->appendChild($invoiceReference);

        $propertiesReference = $this->ds($document, 'Reference');
        $propertiesReference->setAttribute('Type', self::SIGNED_PROPERTIES_TYPE);
        $propertiesReference->setAttribute('URI', '#'.$signedPropertiesId);
        $propertiesTransforms = $this->ds($document, 'Transforms');
        $propertiesTransforms->appendChild($this->canonicalizationTransform($document));
        $propertiesReference->appendChild($propertiesTransforms);
        $propertiesReference->appendChild($this->digestMethod($document));
        $propertiesReference->appendChild(
            $this->ds($document, 'DigestValue', $signedPropertiesDigest)
        );
        $root->appendChild($propertiesReference);

        $xml = $document->saveXML($root);
        if ($xml === false) {
            throw new RuntimeException('تعذر إنشاء SignedInfo الخاص بتوقيع ZATCA.');
        }

        return $xml;
    }

    public function buildCanonical(
        string $invoiceDigest,
        string $signedPropertiesDigest,
        string $invoiceReferenceId = 'invoiceSignedData',
        string $signedPropertiesId = 'xadesSignedProperties',
    ): string {
        return $this->canonicalizer->canonicalize(
            $this->build(
                $invoiceDigest,
                $signedPropertiesDigest,
                $invoiceReferenceId,
                $signedPropertiesId,
            )
        );
    }

    private function assertSha256Digest(string $value, string $label): void
    {
        $decoded = base64_decode($value, true);
        if ($decoded === false || strlen($decoded) !== 32) {
            throw new InvalidArgumentException("{$label} يجب أن تكون SHA-256 بترميز Base64.");
        }
    }

    private function assertXmlId(string $value, string $label): void
    {
        if (preg_match('/^[A-Za-z_][A-Za-z0-9._-]*$/D', $value) !== 1) {
            throw new InvalidArgumentException("{$label} ليس XML ID صالحاً.");
        }
    }

    private function canonicalizationTransform(DOMDocument $document): DOMElement
    {
        $transform = $this->ds($document, 'Transform');
        $transform->setAttribute('Algorithm', ZatcaXmlCanonicalizer::ALGORITHM);

        return $transform;
    }

    private function digestMethod(DOMDocument $document): DOMElement
    {
        $method = $this->ds($document, 'DigestMethod');
        $method->setAttribute('Algorithm', self::SHA256_ALGORITHM);

        return $method;
    }

    private function ds(DOMDocument $document, string $name, ?string $value = null): DOMElement
    {
        $element = $document->createElementNS(self::XMLDSIG_NAMESPACE, 'ds:'.$name);
        if ($value !== null) {
            $element->appendChild($document->createTextNode($value));
        }

        return $element;
    }
}
