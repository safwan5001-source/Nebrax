<?php

namespace App\Services\Communications;

/**
 * AWJ-COMMS-03-A — عدّادات تشغيل فقط (لا معرّفات ولا عناوين ولا أخطاء مزوّد): آمنة للطباعة والسجلات.
 */
final class RunSummary
{
    /** @var array<string, int> */
    private array $counts = [];

    public function increment(string $key): void
    {
        $this->counts[$key] = ($this->counts[$key] ?? 0) + 1;
    }

    public function get(string $key): int
    {
        return $this->counts[$key] ?? 0;
    }

    /** @return array<string, int> */
    public function toArray(): array
    {
        ksort($this->counts);

        return $this->counts;
    }
}
