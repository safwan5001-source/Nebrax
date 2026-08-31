<?php

namespace App\Services\Accounting;

use DateTimeInterface;

/**
 * ينسّق توقيع فاتورة ZATCA من اعتماد البيئة النشطة والسياسة المثبتة.
 *
 * لا يحفظ XML ولا يرسل شبكة؛ يبقى أثره محصوراً في القيمة الموقعة المعادة.
 */
final class ZatcaInvoiceSigner
{
    public function __construct(
        private readonly ZatcaSigningCredentialResolver $credentials,
        private readonly ZatcaSignaturePolicyResolver $policy,
        private readonly ZatcaXadesSignatureAssembler $assembler,
        private readonly ZatcaQrCertificateMaterialExtractor $qrCertificateMaterial,
    ) {}

    public function sign(string $invoiceXml, DateTimeInterface $signingTime): string
    {
        $material = $this->credentials->resolve();

        return $this->assemble($invoiceXml, $signingTime, $material);
    }

    /**
     * يوقّع ويشتق وسمي QR 8 و9 من شهادة leaf نفسها التي استُعملت في التوقيع.
     * حلّ الاعتماد مرة واحدة يمنع مزج توقيع من اعتماد ومفتاح QR من اعتماد
     * آخر إذا دُوّرت الشهادة بالتزامن مع إصدار الفاتورة.
     *
     * @return array{xml:string, public_key:string, certificate_signature:string}
     */
    public function signWithQrMaterial(string $invoiceXml, DateTimeInterface $signingTime): array
    {
        $material = $this->credentials->resolve();
        $signedXml = $this->assemble($invoiceXml, $signingTime, $material);
        $qrMaterial = $this->qrCertificateMaterial->extract($material->certificateChain[0]);

        return [
            'xml' => $signedXml,
            'public_key' => $qrMaterial['public_key'],
            'certificate_signature' => $qrMaterial['certificate_signature'],
        ];
    }

    private function assemble(
        string $invoiceXml,
        DateTimeInterface $signingTime,
        ZatcaSigningMaterial $material,
    ): string {
        $policy = $this->policy->resolve();

        return $this->assembler->assemble(
            $invoiceXml,
            $material->certificateChain,
            $material->privateKey,
            $signingTime,
            $policy->identifier,
            $policy->digest,
        );
    }
}
