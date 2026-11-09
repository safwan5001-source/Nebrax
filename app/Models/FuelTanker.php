<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * TANKER-PR1 — صهريج/مركبة تابع لصاحب صهريج. `plate_key` لوحة مطبَّعة يحسبها `FuelTankerService` (فريدة للمستأجر). `fuel_tanker_owner_id` ثابت بعد
 * الإنشاء في هذه الشريحة (نقل صهريج بين ملاك قرار لاحق مفتوح). لا حذف؛ التعطيل فقط. هذا الكيان **ليس مخزوناً** ولا خزاناً افتراضياً: لا أرصدة ولا مستودع.
 */
class FuelTanker extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    public const STATUS_ACTIVE = 'active';
    public const STATUS_SUSPENDED = 'suspended';
    public const STATUS_INACTIVE = 'inactive';
    public const STATUSES = [self::STATUS_ACTIVE, self::STATUS_SUSPENDED, self::STATUS_INACTIVE];

    protected $fillable = [
        'tenant_id', 'fuel_tanker_owner_id', 'plate_number', 'plate_key', 'plate_country', 'capacity_milliliters', 'notes', 'status', 'created_by',
    ];

    protected $casts = ['capacity_milliliters' => 'integer'];

    protected $attributes = ['status' => self::STATUS_ACTIVE];

    protected static function booted(): void
    {
        static::updating(function (self $tanker) {
            if ($tanker->isDirty('fuel_tanker_owner_id')) {
                throw new LogicException('لا يُنقل الصهريج إلى صاحب آخر بتعديل مباشر؛ يحتاج مساراً مدقَّقاً يُعتمد لاحقاً.');
            }
        });
        static::deleting(fn () => throw new LogicException('الصهريج لا يحذف؛ عطّله للحفاظ على تاريخ التعبئات.'));
    }

    public function owner(): BelongsTo
    {
        return $this->referenceBelongsTo(FuelTankerOwner::class, 'fuel_tanker_owner_id');
    }
}
