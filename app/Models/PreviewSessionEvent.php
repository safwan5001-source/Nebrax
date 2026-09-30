<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * سجلّ تدقيق ثابت لدورة حياة جلسات المعاينة (MOBILE-PREVIEW-6، §5.12 من
 * وثيقة معمارية MP-5). لا يُحدَّث ولا يُحذف بعد الإنشاء — نفس انضباط
 * `TenantApplicationEvent::booted()` حرفياً.
 */
class PreviewSessionEvent extends BaseModel implements CompanyWide
{
    public const ACTION_CREATED = 'created';

    public const ACTION_OPENED = 'opened';

    public const ACTION_REFRESHED = 'refreshed';

    public const ACTION_REVOKED = 'revoked';

    public const ACTION_EXPIRED = 'expired';

    public const ACTION_REJECTED = 'rejected';

    /** MOBILE-PREVIEW-7 — مرجع تبادل صدر (لوحة التاجر، قبل أي تبادل فعلي). */
    public const ACTION_EXCHANGE_CREATED = 'exchange_created';

    /** MOBILE-PREVIEW-7 — تبادل ناجح استهلك المرجع وأنشأ جلسة معاينة حقيقية. */
    public const ACTION_EXCHANGED = 'exchanged';

    protected $fillable = [
        'tenant_id',
        'preview_session_id',
        'action',
        'changed_by',
        'reason',
    ];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Preview session events are immutable.'));
        static::deleting(fn () => throw new LogicException('Preview session events cannot be deleted.'));
    }

    public function session(): BelongsTo
    {
        return $this->belongsTo(PreviewSession::class, 'preview_session_id');
    }

    public function changedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'changed_by');
    }
}
