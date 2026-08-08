<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * مخزن — يحمل كميات المنتجات لموقع معيّن، ويتبع فرعاً (أو لا فرع = مركزي).
 * التقييم (متوسط التكلفة) يبقى عالمياً على مستوى المنتج؛ المخزن يفصّل الكميات فقط.
 */
class Warehouse extends BaseModel
{
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

    /** الكود التسلسلي التالي (خمس خانات مصفَّرة) — كنمط الفروع. */
    public static function nextCode(): string
    {
        $max = static::query()->pluck('code')
            ->map(fn ($c) => (int) preg_replace('/\D/', '', (string) $c))
            ->max() ?? 0;

        return str_pad((string) ($max + 1), 5, '0', STR_PAD_LEFT);
    }

    /** المخزن الافتراضي للمستأجر: المُعلَّم افتراضياً، وإلا أول مخزن نشط. */
    public static function default(): ?self
    {
        return static::where('is_default', true)->first()
            ?? static::where('is_active', true)->orderBy('code')->first();
    }
}
