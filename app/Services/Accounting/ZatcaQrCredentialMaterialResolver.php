<?php

namespace App\Services\Accounting;

/**
 * يشتق مادة QR من الشهادة النهائية للاعتماد النشط من دون تخزين نسخة مشتقة.
 *
 * @phpstan-type QrCredentialMaterial array{public_key:string, certificate_signature:string}
 */
final class ZatcaQrCredentialMaterialResolver
{
    public function __construct(
        private readonly ZatcaSigningCredentialResolver $credentials,
        private readonly ZatcaQrCertificateMaterialExtractor $extractor,
    ) {}

    /** @return array{public_key:string, certificate_signature:string} */
    public function resolve(): array
    {
        $material = $this->credentials->resolve();

        return $this->extractor->extract($material->certificateChain[0]);
    }
}
