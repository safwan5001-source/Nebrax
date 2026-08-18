<?php

namespace App\Models;

use App\Support\GeneratesDocumentNumbers;
use App\Support\Settings;
use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Support\Facades\DB;

/**
 * فرع تابع للمؤسسة (المستأجر). بنية تنظيمية وبُعد تصفية — لا يولّد قيوداً
 * ولا يشكّل حاجز عزل (العزل بالمستأجر عبر TenantScope).
 */
/** @see design-system/foundations/multi-branch-architecture.md — مشترك: الفرع نفسه لا يُعزل بفرع */
class Branch extends BaseModel implements CompanyWide
{
    use GeneratesDocumentNumbers;

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

    /** عمود الرقم هنا اسمه `code` لا `number`. */
    public static function documentNumberColumn(): string
    {
        return 'code';
    }

    /**
     * الكود التسلسلي التالي للمستأجر الحالي: خمس خانات مصفَّرة (00001).
     * بلا سنة — سلسلة واحدة مستمرة على مستوى المؤسسة.
     *
     * البادئة مضبوطة من «إعدادات الترقيم المتسلسل»، وافتراضها فارغ فيبقى
     * الكود `00001` كما كان لكل مستأجر قائم.
     */
    public static function nextCode(): string
    {
        return static::nextDocumentNumber(
            ((string) Settings::get('numbering', 'branch_prefix')) ?: null
        );
    }
}
