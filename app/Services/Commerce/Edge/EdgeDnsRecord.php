<?php

namespace App\Services\Commerce\Edge;

/** تعليمات DNS موجَّهة للتاجر — ليست بيانات اعتماد. */
final class EdgeDnsRecord
{
    public function __construct(
        public readonly string $type,
        public readonly string $name,
        public readonly string $value,
    ) {}

    /** @return array{type: string, name: string, value: string} */
    public function toArray(): array
    {
        return [
            'type' => $this->type,
            'name' => $this->name,
            'value' => $this->value,
        ];
    }
}
