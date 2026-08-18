<?php

namespace App\Models;

use App\Support\GeneratesDocumentNumbers;
use App\Support\Settings;
use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * مخزن — يحمل كميات المنتجات لموقع معيّن، ويتبع فرعاً (أو لا فرع = مركزي).
 * التقييم (متوسط التكلفة) يبقى عالمياً على مستوى المنتج؛ المخزن يفصّل الكميات فقط.
 */
/** @see design-system/foundations/multi-branch-architecture.md — مشترك: المخازن تُدار مركزياً وتُنسب لفرع عبر branch_id (لا تُعزل عن إدارتها) */
class Warehouse extends BaseModel implements CompanyWide
{
    use GeneratesDocumentNumbers;

    protected $fillable = [
        'tenant_id', 'branch_id', 'code', 'name', 'city', 'address', 'notes',
        'is_default', 'is_active',
    ];

    protected $casts = [
        'is_default' => 'boolean',
        'is_active'  => 'boolean',
    ];

    protected $attributes = [
        'is_default' => false,
        'is_active'  => true,
    ];

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function stock(): HasMany
    {
        return $this->hasMany(ProductWarehouseStock::class);
    }

    /** عمود الرقم هنا اسمه `code` لا `number`. */
    public static function documentNumberColumn(): string
    {
        return 'code';
    }

    /**
     * الكود التسلسلي التالي (خمس خانات مصفَّرة) — كنمط الفروع.
     * البادئة مضبوطة، وافتراضها فارغ فيبقى الكود `00001` كما كان.
     */
    public static function nextCode(): string
    {
        return static::nextDocumentNumber(
            ((string) Settings::get('numbering', 'warehouse_prefix')) ?: null
        );
    }

    /** المخزن الافتراضي للمستأجر: المُعلَّم افتراضياً، وإلا أول مخزن نشط. */
    public static function default(): ?self
    {
        return static::where('is_default', true)->first()
            ?? static::where('is_active', true)->orderBy('code')->first();
    }
}
