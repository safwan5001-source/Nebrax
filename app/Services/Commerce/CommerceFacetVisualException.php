<?php

namespace App\Services\Commerce;

use RuntimeException;

/**
 * AWJ-VD-H1 / VD-1b — an expected failure of the facet-visual write path, with a stable `code` the UI translates and
 * an Arabic fallback message. `errors` carries field errors for 422 (`visual.<path>` => [code]); `context` carries
 * extra response keys (e.g. `current_version` on 409).
 */
final class CommerceFacetVisualException extends RuntimeException
{
    /**
     * @param  array<string, list<string>>  $errors
     * @param  array<string, mixed>  $context
     */
    public function __construct(
        public readonly string $errorCode,
        string $message,
        public readonly int $status,
        public readonly array $errors = [],
        public readonly array $context = [],
    ) {
        parent::__construct($message);
    }

    /** @param array<string, list<string>> $errors */
    public static function invalid(array $errors): self
    {
        return new self('visual_invalid', 'الهوية المرئية تحتوي قيماً غير صالحة.', 422, $errors);
    }

    public static function preconditionRequired(): self
    {
        return new self(
            'visual_precondition_required',
            'لهذه الهوية نسخة محفوظة. أرسل رقم النسخة التي عدّلتها (expected_version).',
            428,
        );
    }

    public static function versionConflict(?int $currentVersion): self
    {
        return new self(
            'visual_version_conflict',
            'تغيّرت الهوية المرئية منذ فتحتها. أعد تحميلها ثم عدّل.',
            409,
            [],
            ['current_version' => $currentVersion],
        );
    }
}
