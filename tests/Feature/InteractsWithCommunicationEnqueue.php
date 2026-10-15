<?php

namespace Tests\Feature;

use App\Support\Communications\CommunicationChannel;
use App\Support\Communications\MessageClassification;
use App\Support\Communications\MessageIntent;
use App\Support\Communications\MessageRecipient;

/**
 * أدوات اختبار الإدراج (AWJ-COMMS-02-B): مفتاح HMAC اختباري صريح (عشوائي لكل تشغيل، ليس سراً حقيقياً) ونيّات جاهزة.
 */
trait InteractsWithCommunicationEnqueue
{
    private function commTestKey(string $seed = ''): string
    {
        return base64_encode(random_bytes(32).$seed);
    }

    /** @param  array<int, string>|null  $keys */
    private function configureCommunicationsHmac(?array $keys = null, int|string|null $active = 1): void
    {
        config(['communications.hmac' => [
            'active_version' => $active,
            'keys' => $keys ?? [1 => $this->commTestKey()],
        ]]);
    }

    /** @param  array<string, mixed>  $o */
    private function commIntent(string $tenantId, array $o = []): MessageIntent
    {
        $channel = $o['channel'] ?? CommunicationChannel::Sms;

        return new MessageIntent(
            tenantId: $tenantId,
            classification: $o['classification'] ?? MessageClassification::Transactional,
            recipient: new MessageRecipient($channel, $o['address'] ?? ($channel === CommunicationChannel::Email ? 'Customer@Example.com' : '+966500000001')),
            templateKey: $o['template'] ?? 'invoice.issued',
            idempotencyKey: $o['key'] ?? 'invoice:123:issued',
            source: $o['source'] ?? 'invoicing.issue',
            variables: $o['variables'] ?? ['invoice_no' => 'INV-1'],
        );
    }
}
