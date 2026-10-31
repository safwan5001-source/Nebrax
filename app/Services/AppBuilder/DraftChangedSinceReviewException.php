<?php

namespace App\Services\AppBuilder;

use DomainException;

/**
 * نشرٌ بـ`expected_draft_revision` لا يطابق `revision` المسودة داخل القفل — AD-01 (S01d / G1):
 * المسودة تغيّرت بعد أن راجعها الناشر، فلا تُنشر نسخة لم يرها.
 *
 * **لا يرث `RuntimeException` عمداً** (وإلا حوّله `ApiController::domain()` إلى 422)؛ يُعاد 409
 * بجسم منظَّم. لا بيانات مخطط، فقط الأرقام.
 */
final class DraftChangedSinceReviewException extends DomainException
{
    public function __construct(
        public readonly int $currentRevision,
        public readonly int $expectedRevision,
    ) {
        parent::__construct('draft_changed_since_review');
    }
}
