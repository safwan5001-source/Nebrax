<?php

namespace App\Services\Commerce\Edge;

/**
 * CUSTOM-DOMAIN-EDGE-1 — منفذ Edge الضيق. التجارة لا ترى GraphQL.
 * Disconnect في EDGE-1 لا يستدعي `release`؛ الـ method موجود لدورة EDGE-3.
 */
interface StorefrontEdgeClient
{
    public function provision(string $hostname): EdgeBinding;

    public function fetch(string $providerId): EdgeSnapshot;

    public function findByHostname(string $hostname): ?EdgeBinding;

    public function release(string $providerId): void;
}
