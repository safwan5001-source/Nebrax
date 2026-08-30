<?php

namespace App\Services\Accounting;

use DateTimeInterface;
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
        string $documentType,
    ): ZatcaSignedInvoiceQrResult {
        if (! in_array($documentType, ['standard', 'simplified'], true)) {
            throw new InvalidArgumentException('نوع مستند ZATCA غير صالح للتوقيع وبناء QR.');
        }

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
}
