<?php

namespace App\Services;

use App\Services\DocumentCenter\DocumentProviderException;

/**
 * بوابة الاتصال الخارجي للمساعد الذكي (AI-07) — **مستقلة تماماً** عن `DocumentProviderNetworkGate` (استخراج المستندات).
 *
 * مفتاحان لا يفتح أحدهما الآخر: تفعيل Document AI لا يسمح للمساعد بأي طلب، وتفعيل المساعد لا يفتح مسار
 * الاستخراج. يمكن تشغيلهما معاً بمفتاحين صريحين. الافتراضي مغلق.
 */
final class AssistantNetworkGate
{
    public static function allowsExternalRequests(): bool
    {
        return (bool) config('ai_assistant.external_network_enabled', false);
    }

    /** @throws DocumentProviderException */
    public static function assertAllowed(): void
    {
        if (! self::allowsExternalRequests()) {
            throw new DocumentProviderException('provider_network_disabled', 'اتصال المساعد الذكي بمزوّد خارجي معطّل.', false);
        }
    }
}
