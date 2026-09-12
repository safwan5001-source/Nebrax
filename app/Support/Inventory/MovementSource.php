<?php

namespace App\Support\Inventory;

/**
 * بيانات مصدر حركة مخزون صالحة للعرض. لا تحمل أرقاماً مالية ولا حمولة المستند.
 */
final class MovementSource
{
    public function __construct(
        public readonly string $type,
        public readonly string $label,
        public readonly ?string $reference,
        public readonly ?string $date,
        public readonly ?string $status,
        public readonly bool $canOpen,
        public readonly ?string $route,
    ) {}

    public static function unavailable(string $type, string $label): self
    {
        return new self($type, $label, null, null, null, false, null);
    }

    public static function unknown(): self
    {
        return new self('unknown', 'مصدر غير معروف', null, null, null, false, null);
    }

    /** @return array<string,mixed> */
    public function toArray(): array
    {
        return [
            'type' => $this->type,
            'label' => $this->label,
            'reference' => $this->reference,
            'date' => $this->date,
            'status' => $this->status,
            'can_open' => $this->canOpen,
            'route' => $this->route,
        ];
    }
}
