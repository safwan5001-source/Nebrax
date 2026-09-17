<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * قيمة واحدة لخيار منتج (أسود لخيار اللون، XL لخيار المقاس). تنتمي لخيارٍ
 * واحد، وبالتبعية لمنتجٍ ومستأجرٍ واحد. لا `product_id` مباشر عمداً — الملكية
 * الحقيقية عبر `product_option_id` فقط، فلا مصدرَي حقيقة لنفس العلاقة.
 *
 * **VAR-OPTION-VISUAL-1** — القيمة هي المالك الوحيد لصريّتها البصرية
 * (swatch). `visual_type` نصٌّ لا `false`/غياب: `none` الافتراضي والتوافق
 * الرجعي الكامل، `color` بقيمة `#RRGGBB` معياريّة فقط، `image` بمرجع صريح
 * لصفّ `product_media` مملوكٍ فعلاً لهذه القيمة بالذات (يُتحقَّق في الخدمة لا
 * هنا). الصريّة عرضٌ/كتالوج بحت — لا تمسّ هوية المتغيّر أو المخزون أو السعر.
 */
class ProductOptionValue extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    public const VISUAL_TYPE_NONE = 'none';

    public const VISUAL_TYPE_COLOR = 'color';

    public const VISUAL_TYPE_IMAGE = 'image';

    public const VISUAL_TYPES = [self::VISUAL_TYPE_NONE, self::VISUAL_TYPE_COLOR, self::VISUAL_TYPE_IMAGE];

    protected $fillable = [
        'tenant_id', 'product_option_id', 'value', 'value_en', 'value_key', 'sort_order', 'is_active',
        'visual_type', 'color_value', 'image_media_id',
    ];

    protected $casts = [
        'sort_order' => 'integer',
        'is_active' => 'boolean',
    ];

    protected $attributes = [
        'sort_order' => 0,
        'is_active' => true,
        'visual_type' => self::VISUAL_TYPE_NONE,
    ];

    public static function normalizeKey(string $value): string
    {
        return mb_strtolower(trim($value));
    }

    /** يقبل فقط `#RRGGBB` (6 خانات hex)، ويُطبَّع بحرفٍ كبير. null إن لم يطابق. */
    public static function normalizeColorHex(string $value): ?string
    {
        $trimmed = trim($value);
        if (preg_match('/^#[0-9A-Fa-f]{6}$/', $trimmed) !== 1) {
            return null;
        }

        return strtoupper($trimmed);
    }

    public function option(): BelongsTo
    {
        return $this->referenceBelongsTo(ProductOption::class, 'product_option_id');
    }

    /** المتغيّرات التي تختار هذه القيمة — للتحقق من الاستعمال قبل الحذف فقط. */
    public function variants(): BelongsToMany
    {
        return $this->belongsToMany(
            ProductVariant::class,
            'product_variant_option_values',
            'product_option_value_id',
            'product_variant_id',
        );
    }

    /** وسائط هذه القيمة (VAR-MEDIA-1) — يرثها كل متغيّرٍ يختارها. */
    public function media(): HasMany
    {
        return $this->hasMany(ProductMedia::class, 'product_option_value_id');
    }

    /**
     * الصورة البصرية المعتمَدة لهذه القيمة عند `visual_type=image` — سطرٌ
     * واحدٌ من `media()` نفسه، لا معرضٌ مستقل. يُحقَّق تبعيتها الحصرية لهذه
     * القيمة بالذات في `ProductVariantService` وقت الكتابة، لا بقيدٍ هنا.
     */
    public function imageMedia(): BelongsTo
    {
        return $this->belongsTo(ProductMedia::class, 'image_media_id');
    }
}
