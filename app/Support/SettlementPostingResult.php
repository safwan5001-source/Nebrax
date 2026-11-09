<?php

namespace App\Support;

/** نتيجة محاولة ترحيل تسوية وردية (رموز وأعداد فقط، بلا مبالغ). */
final class SettlementPostingResult
{
    public const POSTED = 'posted';
    public const BLOCKED = 'blocked';
    public const REPLAYED = 'replayed';

    /** @param list<string> $reasons */
    private function __construct(
        public readonly string $outcome,
        public readonly ?string $settlementId,
        public readonly ?string $status,
        public readonly int $postedLines,
        public readonly int $withheldLines,
        public readonly array $reasons,
    ) {}

    public static function posted(string $settlementId, string $status, int $postedLines, int $withheldLines): self
    {
        return new self(self::POSTED, $settlementId, $status, $postedLines, $withheldLines, []);
    }

    public static function replayed(string $settlementId, string $status): self
    {
        return new self(self::REPLAYED, $settlementId, $status, 0, 0, []);
    }

    /** @param list<string> $reasons */
    public static function blocked(array $reasons): self
    {
        return new self(self::BLOCKED, null, null, 0, 0, array_values(array_unique($reasons)));
    }
}
