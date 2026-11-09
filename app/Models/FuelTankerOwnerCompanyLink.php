<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * TANKER-PR1 — ربط شركة (Partner عميل رسمي) بصاحب صهريج **مؤرَّخاً** لأغراض المسؤولية والتقارير والتسوية. الربط **لا يلغي** هوية العميل ولا حسابه الرسمي،
 * ولا يعيد نسب أي عملية سابقة. ثابت بعد الإنشاء إلا إنهاؤه مرة واحدة (`valid_to`/`ended_*` من null إلى قيمة)؛ لا حذف. يكتبه `FuelTankerService` وحده.
 */
class FuelTankerOwnerCompanyLink extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'fuel_tanker_owner_id', 'partner_id', 'valid_from', 'valid_to', 'note', 'end_reason', 'created_by', 'ended_by', 'ended_at',
    ];

    protected $casts = ['valid_from' => 'date:Y-m-d', 'valid_to' => 'date:Y-m-d', 'ended_at' => 'datetime'];

    protected static function booted(): void
    {
        static::updating(function (self $link) {
            $frozen = ['fuel_tanker_owner_id', 'partner_id', 'valid_from', 'note', 'created_by'];
            foreach ($frozen as $column) {
                if ($link->isDirty($column)) {
                    throw new LogicException('ربط الشركة بصاحب الصهريج ثابت؛ يُنهى بتاريخ فقط.');
                }
            }
            if ($link->isDirty('valid_to') && $link->getOriginal('valid_to') !== null) {
                throw new LogicException('الربط المنتهي لا يُعاد فتحه ولا يُعدَّل تاريخ نهايته.');
            }
        });
        static::deleting(fn () => throw new LogicException('ربط الشركة بصاحب الصهريج لا يحذف؛ يُنهى بتاريخ.'));
    }

    public function owner(): BelongsTo
    {
        return $this->referenceBelongsTo(FuelTankerOwner::class, 'fuel_tanker_owner_id');
    }

    public function partner(): BelongsTo
    {
        return $this->referenceBelongsTo(Partner::class);
    }
}
