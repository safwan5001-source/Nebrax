<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

/**
 * TANKER-PR1 — ملف صاحب الصهريج: طرف **مستقل داخلياً** (ليس بالضرورة عميلاً رسمياً ولا Partner). بيانات رئيسية للمؤسسة كلها (`CompanyWide`)
 * فلا يُحصر بفرع؛ يكتبها `FuelTankerService` وحده. لا حذف: التعطيل يحفظ التاريخ (سندات وتسويات لاحقة ستشير إليه).
 * لا عمولة ولا رصيد ولا تسعير هنا — قراراتها مفتوحة وتُضاف في شرائح لاحقة.
 */
class FuelTankerOwner extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    public const STATUS_ACTIVE = 'active';
    public const STATUS_SUSPENDED = 'suspended';
    public const STATUS_INACTIVE = 'inactive';
    public const STATUSES = [self::STATUS_ACTIVE, self::STATUS_SUSPENDED, self::STATUS_INACTIVE];

    protected $fillable = ['tenant_id', 'code', 'name', 'phone', 'notes', 'status', 'partner_id', 'created_by'];

    protected $attributes = ['status' => self::STATUS_ACTIVE];

    protected static function booted(): void
    {
        static::deleting(fn () => throw new LogicException('صاحب الصهريج لا يحذف؛ عطّله للحفاظ على تاريخ المسحوبات والتسويات.'));
    }

    public function tankers(): HasMany
    {
        return $this->hasMany(FuelTanker::class);
    }

    public function companyLinks(): HasMany
    {
        return $this->hasMany(FuelTankerOwnerCompanyLink::class);
    }

    public function partner(): BelongsTo
    {
        return $this->referenceBelongsTo(Partner::class);
    }

    public function isActive(): bool
    {
        return $this->status === self::STATUS_ACTIVE;
    }
}
