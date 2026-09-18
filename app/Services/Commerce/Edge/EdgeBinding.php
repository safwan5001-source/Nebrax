<?php

namespace App\Services\Commerce\Edge;

final class EdgeBinding
{
    public function __construct(
        public readonly string $providerId,
        public readonly string $hostname,
        public readonly EdgeSnapshot $snapshot,
    ) {}
}
