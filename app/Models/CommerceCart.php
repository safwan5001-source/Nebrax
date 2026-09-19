<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** Anonymous, server-authoritative storefront cart; never a financial document. */
class CommerceCart extends BaseModel implements CompanyWide
{
    public const STATUS_ACTIVE = 'active';

    public const STATUS_EXPIRED = 'expired';

    /** الحالة النهائية بعد أول Order ناجح — سلةٌ واحدة تدعم طلباً ناجحاً واحداً على الأكثر. لا تُستأنَف ولا تُعدَّل. */
    public const STATUS_CONSUMED = 'consumed';

    protected $fillable = [
        'tenant_id', 'storefront_id', 'sales_channel_id', 'token_hash', 'status', 'expires_at',
    ];

    protected $hidden = ['token_hash'];

    protected $casts = ['expires_at' => 'datetime'];

    protected $attributes = ['status' => self::STATUS_ACTIVE];

    public function storefront(): BelongsTo
    {
        return $this->belongsTo(Storefront::class);
    }

    public function salesChannel(): BelongsTo
    {
        return $this->belongsTo(SalesChannel::class);
    }

    public function items(): HasMany
    {
        return $this->hasMany(CommerceCartItem::class, 'cart_id');
    }
}
