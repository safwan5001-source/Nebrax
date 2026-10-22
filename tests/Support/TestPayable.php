<?php

namespace Tests\Support;

use App\Contracts\Payable;
use DomainException;

/** Payable اختباري: المبلغ والصلاحية قابلان للتغيير ليُثبَت أن المنسّق يعيد حسابهما من المصدر. */
final class TestPayable implements Payable
{
    public function __construct(
        public string $key = 'invoice:inv-1',
        public int $due = 11500,
        public string $currency = 'SAR',
        public bool $payable = true,
    ) {}

    public function payableKey(): string
    {
        return $this->key;
    }

    public function amountDueMinor(): int
    {
        return $this->due;
    }

    public function currency(): string
    {
        return $this->currency;
    }

    public function partnerIdForAccounting(): ?string
    {
        return null;
    }

    public function allocationTargets(): array
    {
        return [];
    }

    public function assertStillPayable(): void
    {
        if (! $this->payable) {
            throw new DomainException('not payable');
        }
    }
}
