<?php

namespace App\Support;

/**
 * مفردات حالة تشغيلة استيراد دائم (`ImportJob::status`).
 *
 * كامل المفردات معلَنة الآن (PR-DUR-1) كي لا تحتاج بنية المعالجة المجزّأة
 * (PR-DUR-2) هجرة جديدة لمجرّد توسعة enum — لكن **القابل للوصول فعلياً في
 * هذا الـPR فقط**: `UPLOADED → READY|FAILED`، و`{UPLOADED,READY} → CANCELLED`.
 * `QUEUED`/`PROCESSING`/`COMPLETED` مفردات مُقرَّرة سلفاً بلا أي مسار كودٍ
 * يبلغها بعد — تثبته اختبارات هذا الـPR صراحة.
 */
final class ImportJobStatus
{
    public const UPLOADED = 'uploaded';

    public const READY = 'ready';

    public const QUEUED = 'queued';

    public const PROCESSING = 'processing';

    public const COMPLETED = 'completed';

    public const FAILED = 'failed';

    public const CANCELLED = 'cancelled';

    /** الحالات التي لا مسار كودٍ في PR-DUR-1 يبلغها — مفردات مُقرَّرة سلفاً فقط. */
    public const NOT_YET_REACHABLE = [
        self::QUEUED,
        self::PROCESSING,
        self::COMPLETED,
    ];

    /** الحالات التي يقبل منها الإلغاء. */
    public const CANCELLABLE_FROM = [
        self::UPLOADED,
        self::READY,
    ];

    /** حالات نهائية — لا انتقال بعدها. */
    public const TERMINAL = [
        self::COMPLETED,
        self::FAILED,
        self::CANCELLED,
    ];
}
