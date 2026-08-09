<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Support\Facades\DB;

/**
 * فرع تابع للمؤسسة (المستأجر). بنية تنظيمية وبُعد تصفية — لا يولّد قيوداً
 * ولا يشكّل حاجز عزل (العزل بالمستأجر عبر TenantScope).
 */
class Branch extends BaseModel
{
    protected $fillable = [
        'tenant_id', 'code', 'name', 'is_main', 'phone', 'mobile',
        'address_line1', 'address_line2', 'city', 'region', 'country',
        'description', 'working_hours', 'latitude', 'longitude', 'is_active',
    ];

    protected $casts = [
        'is_main'   => 'boolean',
        'is_active' => 'boolean',
    ];

    protected $attributes = [
        'is_main'   => false,
        'is_active' => true,
    ];

    /** الحسابات المخصَّصة لهذا الفرع (فارغة = كل الحسابات متاحة). */
    public function accounts(): BelongsToMany
    {
        return $this->belongsToMany(Account::class, 'account_branch')->withTimestamps();
    }

    /** الفرع الرئيسي للمستأجر الحالي (أو null إن لم يوجد أي فرع). */
    public static function main(): ?self
    {
        return static::where('is_main', true)->first();
    }

    /**
     * يجعل هذا الفرع الرئيسي **حصرياً** — الإجراء الوحيد المسموح لتغيير الرئيسي،
     * ويُستدعى فقط من «إعدادات الفروع». يُنفَّذ في معاملة فلا تمرّ لحظة بفرعين
     * رئيسيين (يمنعها الفهرس الفريد الجزئي أيضاً).
     */
    public function makeMain(): void
    {
        DB::transaction(function () {
            static::where('is_main', true)->where('id', '!=', $this->id)
                ->update(['is_main' => false]);
            $this->forceFill(['is_main' => true])->save();
        });
    }

    /**
     * يضمن وجود فرع رئيسي: يُعيّن هذا الفرع رئيسياً **فقط** إن لم يكن للمؤسسة
     * أيُّ فرع رئيسي بعد. لا يسرق الصفة من فرع قائم — وهذا جوهر إصلاح P1.
     */
    public function claimMainIfNone(): void
    {
        if (! static::where('is_main', true)->exists()) {
            $this->forceFill(['is_main' => true])->save();
        }
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
