<?php

namespace App\Contracts;

/**
 * سياق بناء معاملة عام: يثبت إصدار المراجعة والفاعل والسبب وخيارات نوعية محدودة.
 * لا يحمل نوع معاملة أو مبالغ أو أسطر أو معرّفات بيانات رئيسة من العميل.
 */
final readonly class DraftBuildContext
{
    public function __construct(
        public int $expectedVersion,
        public string $reason,
        public ?string $actorId,
        public ?DraftBuildOptions $options = null,
    ) {
    }
}
