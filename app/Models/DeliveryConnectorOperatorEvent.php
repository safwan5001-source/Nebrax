<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use LogicException;

/**
 * سجل إسناد تشغيلي إلحاقي. المعرّفات تُحفظ كما هي حتى بعد الحذف الناعم.
 * ليس سرّاً ولا حالة اتصال مزوّد.
 */
class DeliveryConnectorOperatorEvent extends BaseModel implements CompanyWide
{
    public const UPDATED_AT = null;

    protected $fillable = [
        'tenant_id',
        'delivery_connector_account_id',
        'from_user_id',
        'to_user_id',
        'actor_user_id',
    ];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('سجل إسناد موصّل التوصيل إلحاقي ولا يُعدَّل.'));
        static::deleting(fn () => throw new LogicException('سجل إسناد موصّل التوصيل إلحاقي ولا يُحذف.'));
    }
}
