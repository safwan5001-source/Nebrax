<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** H6 Batch F — append-only history of staff changes to a sales channel's pricing settings. Never updated or deleted. */
class SalesChannelSettingEvent extends BaseModel implements CompanyWide
{
    public const UPDATED_AT = null;

    protected $fillable = ['tenant_id', 'sales_channel_id', 'actor_user_id', 'changes'];

    protected $casts = ['changes' => 'array'];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Sales channel setting events are immutable.'));
        static::deleting(fn () => throw new LogicException('Sales channel setting events cannot be deleted.'));
    }

    public function channel(): BelongsTo
    {
        return $this->belongsTo(SalesChannel::class, 'sales_channel_id');
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_user_id');
    }
}
