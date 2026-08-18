<?php

namespace App\Models;

use App\Support\DocumentNumberingCatalog;
use App\Support\GeneratesDocumentNumbers;
use App\Support\Settings;
use App\Tenancy\BranchScope;
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
     * هل للفرع مستنداتٌ تمنع حذفه؟
     *
     * ═══ لماذا المنع، ولماذا هذه الجداول تحديداً ═══
     *
     * `branch_id` على المستندات مُعرَّف `nullOnDelete`، فحذف الفرع **ينقل
     * مستنداته إلى سلسلة «بلا فرع»** — المحروسة بفهرس جزئي على
     * `(tenant_id, number) WHERE branch_id IS NULL`. وبما أن الترقيم صار
     * مستقلاً لكل فرع، يحمل فرعان `INV-2026-00001` مشروعَين؛ فحذف الثاني
     * بعد الأول يصطدم بذلك الفهرس ويسقط بـ`23505` خاماً لا برسالة مفهومة.
     *
     * فالمنع هنا ليس تنظيماً بل تحويلُ عطلٍ صامتٍ إلى رفضٍ مفهوم — والتعطيل
     * (`is_active`) هو البديل الذي يحفظ البيانات وأرقامها.
     *
     * القائمة تُشتقّ من `DocumentNumberingCatalog` لا تُكتب: فهي بالضبط
     * الجداول التي يتكرّر رقمها بين الفروع، ولا تشمل ما هو `CompanyWide`
     * (الموظف والمخزن وسمُهما بالفرع وصفيّ ولا يحمل رقماً فرعياً).
     */
    public function hasDocuments(): bool
    {
        foreach (DocumentNumberingCatalog::branchNumberedModels() as $model) {
            $exists = $model::withoutGlobalScope(BranchScope::class)
                ->where('branch_id', $this->id)
                ->exists();

            if ($exists) {
                return true;
            }
        }

        return false;
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
