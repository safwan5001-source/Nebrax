<?php

namespace App\Services\Accounting;

use DateTimeInterface;
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
        string $sellerName,
        string $vatNumber,
        DateTimeInterface $invoiceTime,
        DateTimeInterface $signingTime,
        string $invoiceTotal,
        string $vatTotal,
    ): ZatcaSignedInvoiceQrResult {
        $documentType = $this->documentType($invoiceXml);
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
            $sellerName,
            $vatNumber,
            $invoiceTime,
            $invoiceTotal,
            $vatTotal,
            $signedMaterial['invoice_hash'],
            $signedMaterial['ecdsa_signature'],
            $certificateMaterial['public_key'],
            $documentType,
            $documentType === 'simplified'
                ? $certificateMaterial['certificate_signature']
                : null,
        );

        return new ZatcaSignedInvoiceQrResult(
            $signedXml,
            $signedMaterial['invoice_hash'],
            $qrCode,
        );
    }

    private function documentType(string $invoiceXml): string
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
            $typeCodes = $xpath->query('/inv:Invoice/cbc:InvoiceTypeCode');
            $typeCode = $typeCodes !== false && $typeCodes->length === 1
                ? $typeCodes->item(0)
                : null;
            if (! $typeCode instanceof DOMElement || trim($typeCode->textContent) !== '388') {
                throw new InvalidArgumentException('فاتورة ZATCA يجب أن تحتوي InvoiceTypeCode فريداً بقيمة 388.');
            }

            return match ($typeCode->getAttribute('name')) {
                '0100000' => 'standard',
                '0200000' => 'simplified',
                default => throw new InvalidArgumentException(
                    'اسم InvoiceTypeCode يجب أن يحدد فاتورة standard أو simplified صراحةً.',
                ),
            };
        } finally {
            libxml_clear_errors();
            libxml_use_internal_errors($previous);
        }
    }
}
