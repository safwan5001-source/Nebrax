<?php

namespace App\Services\Accounting;

/** نتيجة توقيع وQR داخلية؛ invoiceHash بايتات SHA-256 خام وليست Base64. */
final class ZatcaSignedInvoiceQrResult
{
    public function __construct(
        public readonly string $signedXml,
        public readonly string $invoiceHash,
        public readonly string $qrCode,
    ) {}
}
