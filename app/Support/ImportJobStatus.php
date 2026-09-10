<?php

namespace App\Support;

/**
 * مفردات حالة تشغيلة استيراد دائم (`ImportJob::status`).
 *
 * كامل المفردات معلَنة منذ PR-DUR-1 كي لا تحتاج بنية المعالجة المجزّأة
 * هجرة جديدة لمجرّد توسعة enum. **القابل للوصول فعلياً اليوم (PR-DUR-2):**
 * `UPLOADED → READY|FAILED`، `{UPLOADED,READY} → CANCELLED`، و
 * `READY → PROCESSING → COMPLETED|FAILED` عبر `POST /import-jobs/{id}/apply`
 * لمجال `product_catalog` فقط (`ImportJobService::applyNextChunk`) — قطعةٌ
 * محدودة الحجم لكل استدعاء، لا معالجة خلفية دفعة واحدة.
 * `QUEUED` وحدها تبقى مفردة مُقرَّرة سلفاً بلا مسار كودٍ يبلغها — لا عامل
 * طابور حقيقي بعد (`QUEUE_CONNECTION=sync`)؛ الترحيل اليوم مُحرَّك بطلب HTTP
 * صريح لكل قطعة، لا بإرسالٍ لطابور.
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

    /** الحالة الوحيدة التي لا مسار كودٍ اليوم يبلغها — مفردة مُقرَّرة سلفاً فقط. */
    public const NOT_YET_REACHABLE = [
        self::QUEUED,
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
