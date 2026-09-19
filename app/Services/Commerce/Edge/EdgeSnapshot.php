<?php

namespace App\Services\Commerce\Edge;

final class EdgeSnapshot
{
    public const STATUS_DNS_REQUIRED = 'dns_required';

    public const STATUS_TLS_PENDING = 'tls_pending';

    public const STATUS_READY = 'ready';

    public const STATUS_FAILED = 'failed';

    /**
     * @param  list<EdgeDnsRecord>  $dnsRecords
     */
    public function __construct(
        public readonly string $status,
        public readonly array $dnsRecords,
        public readonly ?string $lastError,
        public readonly bool $missing = false,
    ) {}

    /** @return list<array{type: string, name: string, value: string}> */
    public function instructionPayload(): array
    {
        return array_map(static fn (EdgeDnsRecord $record) => $record->toArray(), $this->dnsRecords);
    }
}
