<?php

namespace App\Models;

use App\Models\User;
use App\Tenancy\BelongsToBranch;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use RuntimeException;

/**
 * إسقاط تشغيلي لطلب توصيل. ليس CompanyWide: الصف للمستأجر، والفرع قد يغيب
 * ما دام `unrouted`. لا فاتورة ولا مخزون ولا جلسة نقطة بيع.
 */
class DeliveryHubOrder extends BaseModel
{
    use BelongsToBranch;

    public const UNROUTED = 'unrouted';

    public const RECEIVED = 'received';

    public const ACCEPTED = 'accepted';

    public const PREPARING = 'preparing';

    public const READY = 'ready';

    public const HANDED_OFF = 'handed_off';

    public const CANCELLED = 'cancelled_before_post';

    public const STATES = [
        self::UNROUTED,
        self::RECEIVED,
        self::ACCEPTED,
        self::PREPARING,
        self::READY,
        self::HANDED_OFF,
        self::CANCELLED,
    ];

    protected $fillable = [
        'tenant_id',
        'branch_id',
        'delivery_platform_profile_id',
        'state',
        'provider_order_id',
        'external_order_reference',
        'idempotency_key',
        'request_checksum',
        'intake_payload_hash',
        'provider_status',
        'created_by',
        'updated_by',
    ];

    protected static function booted(): void
    {
        static::updating(function (self $order): void {
            foreach (['tenant_id', 'delivery_platform_profile_id', 'provider_order_id', 'idempotency_key', 'request_checksum'] as $field) {
                if ($order->isDirty($field)) {
                    throw new RuntimeException('هوية طلب التوصيل ثابتة.');
                }
            }

            if ($order->isDirty('branch_id')) {
                $from = (string) $order->getOriginal('state');
                if (! in_array($from, [self::UNROUTED, self::RECEIVED], true)) {
                    throw new RuntimeException('الفرع ثابت بعد القبول.');
                }
            }
        });
    }

    /**
     * الوجهة صريحة فقط. سمة BelongsToBranch تُستخدم للتصنيف بلا نطاق عام،
     * لكن وسم الإنشاء من X-Branch-Id أو الفرع الرئيسي يُلغى هنا: صف unrouted
     * يجب أن يبقى بلا فرع حتى يُسمّى الوجهة في الطلب.
     */
    public static function bootBelongsToBranch(): void
    {
    }

    public function profile(): BelongsTo
    {
        return $this->belongsTo(DeliveryPlatformProfile::class, 'delivery_platform_profile_id');
    }

    public function visibleTo(User $user): bool
    {
        $allowed = $user->allowedBranchIds();
        if ($allowed === null) {
            return true;
        }

        return $this->branch_id !== null && in_array((string) $this->branch_id, $allowed, true);
    }
}
