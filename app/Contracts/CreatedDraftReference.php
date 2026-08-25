<?php

namespace App\Contracts;

/** مرجع معاملة مرتبط بدليل مراجع، صالح لكل نوع معاملة يدعمه المركز. */
final readonly class CreatedDraftReference
{
    public function __construct(
        public string $linkId,
        public string $transactionType,
        public string $transactionId,
        public string $transactionNumber,
        public string $status,
        public bool $idempotentReplay,
    ) {
    }
}
