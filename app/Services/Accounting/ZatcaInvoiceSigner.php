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
    ) {}

    public function sign(string $invoiceXml, DateTimeInterface $signingTime): string
    {
        $material = $this->credentials->resolve();
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
