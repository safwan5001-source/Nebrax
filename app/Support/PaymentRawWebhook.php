<?php

namespace App\Support;

/** webhook وارد كما وصل: الجسم الخام (للتوقيع) والترويسات بأحرف صغيرة → قيمة نصية. */
final class PaymentRawWebhook
{
    /** @param array<string, string> $headers */
    public function __construct(
        public readonly string $body,
        public readonly array $headers,
    ) {}

    public function header(string $name): ?string
    {
        return $this->headers[strtolower($name)] ?? null;
    }
}
