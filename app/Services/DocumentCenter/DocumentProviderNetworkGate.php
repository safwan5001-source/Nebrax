<?php

namespace App\Services\DocumentCenter;

final class DocumentProviderNetworkGate
{
    public static function allowsExternalRequests(): bool
    {
        return (bool) config('document_center.ai.provider_network_enabled', false);
    }

    public static function blockedMessage(): string
    {
        return 'اتصالات مزودي الذكاء الاصطناعي معطلة في مرحلة التأسيس الحالية.';
    }

    public static function assertAllowed(): void
    {
        if (! self::allowsExternalRequests()) {
            throw new DocumentProviderException('provider_network_disabled', self::blockedMessage(), false);
        }
    }
}
