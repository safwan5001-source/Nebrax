<?php

namespace App\Support;

final readonly class ApplicationAccessResult
{
    public function __construct(
        public ApplicationAccessLevel $level,
        public ApplicationAccessReason $reason,
    ) {}

    public static function allowed(): self
    {
        return new self(ApplicationAccessLevel::ALLOWED, ApplicationAccessReason::ACCESS_ALLOWED);
    }

    public static function readOnly(ApplicationAccessReason $reason = ApplicationAccessReason::ACCESS_READ_ONLY): self
    {
        return new self(ApplicationAccessLevel::READ_ONLY, $reason);
    }

    public static function denied(ApplicationAccessReason $reason): self
    {
        return new self(ApplicationAccessLevel::DENIED, $reason);
    }
}
