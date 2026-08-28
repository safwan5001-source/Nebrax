<?php

namespace App\Services\Accounting;

use DateTimeImmutable;
use DateTimeInterface;
use DateTimeZone;
use DOMDocument;
use DOMElement;
use InvalidArgumentException;
use RuntimeException;

final class ZatcaXadesSignedPropertiesBuilder
{
    public const XADES_NAMESPACE = 'http://uri.etsi.org/01903/v1.3.2#';
    public const XMLDSIG_NAMESPACE = 'http://www.w3.org/2000/09/xmldsig#';
    public const SHA256_ALGORITHM = 'http://www.w3.org/2001/04/xmlenc#sha256';

    /**
     * @param list<string> $certificateChain Base64 DER certificates, leaf first.
     */
    public function build(
        array $certificateChain,
        DateTimeInterface $signingTime,
        string $policyIdentifier,
        string $policyDigest,
        string $signedPropertiesId = 'xadesSignedProperties',
        string $dataObjectReference = '#invoiceSignedData',
    ): string {
        $certificateDigests = $this->certificateDigests($certificateChain);
        $this->assertHttpsUrl($policyIdentifier);

        $decodedPolicyDigest = base64_decode($policyDigest, true);
        if ($decodedPolicyDigest === false || strlen($decodedPolicyDigest) !== 32) {
            throw new InvalidArgumentException('بصمة سياسة توقيع ZATCA يجب أن تكون SHA-256 بترميز Base64.');
        }

        $this->assertXmlId($signedPropertiesId, 'معرّف SignedProperties');
        if (! str_starts_with($dataObjectReference, '#')) {
            throw new InvalidArgumentException('مرجع بيانات الفاتورة يجب أن يبدأ بعلامة #.');
        }
        $this->assertXmlId(substr($dataObjectReference, 1), 'مرجع بيانات الفاتورة');

        $document = new DOMDocument('1.0', 'UTF-8');
        $document->formatOutput = false;

        $root = $document->createElementNS(self::XADES_NAMESPACE, 'xades:SignedProperties');
        $root->setAttribute('Id', $signedPropertiesId);
        $document->appendChild($root);

        $signedSignatureProperties = $this->xades($document, 'SignedSignatureProperties');
        $root->appendChild($signedSignatureProperties);

        $utcTime = DateTimeImmutable::createFromInterface($signingTime)
            ->setTimezone(new DateTimeZone('UTC'))
            ->format('Y-m-d\\TH:i:s\\Z');
        $signedSignatureProperties->appendChild(
            $this->xades($document, 'SigningTime', $utcTime)
        );

        $signingCertificate = $this->xades($document, 'SigningCertificateV2');
        $signedSignatureProperties->appendChild($signingCertificate);

        foreach ($certificateDigests as $digest) {
            $certificate = $this->xades($document, 'Cert');
            $certificateDigest = $this->xades($document, 'CertDigest');
            $certificateDigest->appendChild($this->digestMethod($document));
            $certificateDigest->appendChild($this->ds($document, 'DigestValue', $digest));
            $certificate->appendChild($certificateDigest);
            $signingCertificate->appendChild($certificate);
        }

        $signaturePolicyIdentifier = $this->xades($document, 'SignaturePolicyIdentifier');
        $signaturePolicyId = $this->xades($document, 'SignaturePolicyId');
        $signaturePolicyName = $this->xades($document, 'SigPolicyId');
        $signaturePolicyName->appendChild(
            $this->xades($document, 'Identifier', $policyIdentifier)
        );
        $signaturePolicyId->appendChild($signaturePolicyName);

        $signaturePolicyHash = $this->xades($document, 'SigPolicyHash');
        $signaturePolicyHash->appendChild($this->digestMethod($document));
        $signaturePolicyHash->appendChild(
            $this->ds($document, 'DigestValue', $policyDigest)
        );
        $signaturePolicyId->appendChild($signaturePolicyHash);
        $signaturePolicyIdentifier->appendChild($signaturePolicyId);
        $signedSignatureProperties->appendChild($signaturePolicyIdentifier);

        $signedDataObjectProperties = $this->xades($document, 'SignedDataObjectProperties');
        $dataObjectFormat = $this->xades($document, 'DataObjectFormat');
        $dataObjectFormat->setAttribute('ObjectReference', $dataObjectReference);
        $dataObjectFormat->appendChild($this->xades($document, 'MimeType', 'text/xml'));
        $signedDataObjectProperties->appendChild($dataObjectFormat);
        $root->appendChild($signedDataObjectProperties);

        $xml = $document->saveXML($root);
        if ($xml === false) {
            throw new RuntimeException('تعذر إنشاء SignedProperties الخاص بتوقيع ZATCA.');
        }

        return $xml;
    }

    /**
     * @param list<string> $certificateChain
     * @return list<string>
     */
    private function certificateDigests(array $certificateChain): array
    {
        if ($certificateChain === [] || ! array_is_list($certificateChain)) {
            throw new InvalidArgumentException('سلسلة شهادات ZATCA يجب أن تكون قائمة غير فارغة.');
        }

        return array_map(function ($certificate, $index): string {
            if (! is_string($certificate) || $certificate === '') {
                throw new InvalidArgumentException('شهادة ZATCA في السلسلة غير صالحة.');
            }

            $der = base64_decode($certificate, true);
            if ($der === false || $der === '') {
                throw new InvalidArgumentException('شهادة ZATCA يجب أن تكون DER بترميز Base64 صالح.');
            }

            $pem = "-----BEGIN CERTIFICATE-----\n"
                .chunk_split(base64_encode($der), 64, "\n")
                ."-----END CERTIFICATE-----\n";

            if (openssl_x509_read($pem) === false) {
                throw new InvalidArgumentException(
                    'شهادة ZATCA رقم '.($index + 1).' ليست شهادة X.509 صالحة.'
                );
            }

            return base64_encode(hash('sha256', $der, true));
        }, $certificateChain, array_keys($certificateChain));
    }

    private function assertHttpsUrl(string $value): void
    {
        $parts = parse_url($value);
        if (
            filter_var($value, FILTER_VALIDATE_URL) === false
            || ! is_array($parts)
            || strtolower((string) ($parts['scheme'] ?? '')) !== 'https'
            || ($parts['host'] ?? '') === ''
        ) {
            throw new InvalidArgumentException('معرّف سياسة توقيع ZATCA يجب أن يكون رابط HTTPS مطلقاً.');
        }
    }

    private function assertXmlId(string $value, string $label): void
    {
        if (preg_match('/^[A-Za-z_][A-Za-z0-9._-]*$/D', $value) !== 1) {
            throw new InvalidArgumentException("{$label} ليس XML ID صالحاً.");
        }
    }

    private function digestMethod(DOMDocument $document): DOMElement
    {
        $element = $this->ds($document, 'DigestMethod');
        $element->setAttribute('Algorithm', self::SHA256_ALGORITHM);

        return $element;
    }

    private function xades(DOMDocument $document, string $name, ?string $value = null): DOMElement
    {
        return $this->element($document, self::XADES_NAMESPACE, 'xades:'.$name, $value);
    }

    private function ds(DOMDocument $document, string $name, ?string $value = null): DOMElement
    {
        return $this->element($document, self::XMLDSIG_NAMESPACE, 'ds:'.$name, $value);
    }

    private function element(
        DOMDocument $document,
        string $namespace,
        string $qualifiedName,
        ?string $value,
    ): DOMElement {
        $element = $document->createElementNS($namespace, $qualifiedName);
        if ($value !== null) {
            $element->appendChild($document->createTextNode($value));
        }

        return $element;
    }
}
