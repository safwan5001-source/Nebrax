<?php

namespace Tests\Feature;

/** Cost-leak assertions that compare JSON values, never raw text. */
trait AssertsNoCostLeak
{
    /**
     * Fails when any JSON scalar equals a cost value. A raw substring scan is unsafe: ids are time-ordered
     * UUIDs, so "777" shows up inside them by chance for a few seconds at a time.
     */
    private function assertNoScalarEquals(string $json, array $needles, string $message): void
    {
        $found = [];
        $decoded = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
        array_walk_recursive($decoded, function ($value) use (&$found): void {
            if (is_scalar($value)) {
                $found[] = (string) $value;
            }
        });

        foreach ($needles as $needle) {
            $this->assertNotContains((string) $needle, $found, $message);
        }
    }
}
