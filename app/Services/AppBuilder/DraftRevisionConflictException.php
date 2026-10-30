<?php

namespace App\Services\AppBuilder;

use DomainException;

/**
 * تعارض حفظ المسودة — AD-01 (S01a). `base_revision` الذي أرسله العميل لا يطابق
 * `revision` الحالي للمسودة داخل القفل: أي أن شخصاً/جلسة أخرى حفظت بعد آخر قراءة له.
 *
 * **لا يرث `RuntimeException` عمداً**: `ApiController::domain()` يحوّل كل
 * `RuntimeException` إلى 422 عام، بينما هذا تعارضٌ يُعاد 409 بجسمٍ منظَّم
 * (`BuilderDraftExperienceController::update`). لا يحمل أي بيانات من المخطط نفسه،
 * فقط أرقام وهوية آخر كاتب في المستأجر نفسه.
 */
final class DraftRevisionConflictException extends DomainException
{
    public function __construct(
        public readonly int $currentRevision,
        public readonly int $baseRevision,
        public readonly ?string $updatedBy,
        public readonly ?string $updatedAt,
    ) {
        parent::__construct('draft_conflict');
    }
}
