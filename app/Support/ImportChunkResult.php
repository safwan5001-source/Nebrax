<?php

namespace App\Support;

/** نتيجة قطعة (IMP-H1-S2): وحدات منجزة + نتيجة المجال كما تُخزَّن في `apply_result`. */
final class ImportChunkResult
{
    /** @param  array<string, mixed>  $result */
    public function __construct(
        public readonly int $processedUnits,
        public readonly array $result,
    ) {}
}
