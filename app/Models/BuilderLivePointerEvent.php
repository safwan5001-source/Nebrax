<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** سجل تدقيق ثابت لتحريك المؤشر الحي (ترقية/تراجع). لا يُحدَّث ولا يُحذف بعد الإنشاء. */
class BuilderLivePointerEvent extends BaseModel implements CompanyWide
{
    public const ACTION_PROMOTE = 'promote';

    public const ACTION_ROLLBACK = 'rollback';

    protected $fillable = ['tenant_id', 'sales_channel_id', 'action', 'from_version_id', 'to_version_id', 'actor_id', 'reason'];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Live pointer events are immutable.'));
        static::deleting(fn () => throw new LogicException('Live pointer events cannot be deleted.'));
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_id');
    }

    public function fromVersion(): BelongsTo
    {
        return $this->belongsTo(BuilderPublishedExperienceVersion::class, 'from_version_id');
    }

    public function toVersion(): BelongsTo
    {
        return $this->belongsTo(BuilderPublishedExperienceVersion::class, 'to_version_id');
    }
}
