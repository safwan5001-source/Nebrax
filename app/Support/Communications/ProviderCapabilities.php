<?php

namespace App\Support\Communications;

use InvalidArgumentException;

/**
 * ADR-COMMS-01 §5 — ما يعلنه المزوّد عن نفسه بدل أن نفترضه (Growth §12). الواجهة وسجل الجاهزية
 * يقرآن هذا التصريح؛ أي طلب خارجه يُرفض بـ`DispatchResult::unsupported` لا بخطأ.
 */
final readonly class ProviderCapabilities
{
    /**
     * @param  list<CommunicationChannel>  $channels
     * @param  list<MessageClassification>  $classifications
     */
    public function __construct(
        public array $channels,
        public array $classifications,
        public bool $deliveryReceipts = false,
        public bool $providerIdempotency = false,
    ) {
        if ($channels === [] || $classifications === []) {
            throw new InvalidArgumentException('A provider must declare at least one channel and one classification.');
        }
    }

    public function supports(CommunicationChannel $channel, MessageClassification $classification): bool
    {
        return in_array($channel, $this->channels, true) && in_array($classification, $this->classifications, true);
    }
}
