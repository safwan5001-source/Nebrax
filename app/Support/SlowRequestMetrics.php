<?php

namespace App\Support;

/** Request-local aggregate only; it never carries SQL, bindings, or business data. */
final class SlowRequestMetrics
{
    private int $queryCount = 0;
    private float $databaseDurationMs = 0.0;

    public function recordQuery(float $durationMs): void
    {
        $this->queryCount++;
        $this->databaseDurationMs += max(0, $durationMs);
    }

    public function queryCount(): int { return $this->queryCount; }
    public function databaseDurationMs(): float { return $this->databaseDurationMs; }
}
