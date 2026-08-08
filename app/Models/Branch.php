<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsToMany;

/**
 * فرع تابع للمؤسسة (المستأجر). بنية تنظيمية وبُعد تصفية — لا يولّد قيوداً
 * ولا يشكّل حاجز عزل (العزل بالمستأجر عبر TenantScope).
 */
class Branch extends BaseModel
{
    protected $fillable = [
        'tenant_id', 'code', 'name', 'phone', 'mobile',
        'address_line1', 'address_line2', 'city', 'region', 'country',
        'description', 'working_hours', 'latitude', 'longitude', 'is_active',
    ];

    protected $casts = [
        'is_active' => 'boolean',
    ];

    protected $attributes = [
        'is_active' => true,
    ];

    /** الحسابات المخصَّصة لهذا الفرع (فارغة = كل الحسابات متاحة). */
    public function accounts(): BelongsToMany
    {
        return $this->belongsToMany(Account::class, 'account_branch')->withTimestamps();
    }

    /**
     * الكود التسلسلي التالي للمستأجر الحالي: خمس خانات مصفَّرة (00001).
     * يُشتقّ من أكبر كود رقمي قائم فلا يتصادم بعد الحذف.
     */
    public static function nextCode(): string
    {
        $max = static::query()
            ->pluck('code')
            ->map(fn ($c) => (int) preg_replace('/\D/', '', (string) $c))
            ->max() ?? 0;

        return str_pad((string) ($max + 1), 5, '0', STR_PAD_LEFT);
    }
}
