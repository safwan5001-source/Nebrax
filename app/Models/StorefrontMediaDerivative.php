<?php

namespace App\Models;

use App\Tenancy\CompanyWide;

/**
 * CUST-HV V2b — ملفٌ مُشتقٌّ من تحويل استخدامٍ على أصل وسائط (V0 §7.2/§7.5).
 * مكتبة المؤسسة مشتركة فلا فرع لها (`CompanyWide`)، والعزل بالمستأجر آليٌّ عبر
 * `BaseModel`. لا مسار/دلو يخرج: `storage_key` اسم ملفٍ فقط.
 */
/** @see design-system/foundations/multi-branch-architecture.md — مشترك: مكتبة وسائط المؤسسة */
class StorefrontMediaDerivative extends BaseModel implements CompanyWide
{
    public const STATE_PENDING = 'pending';
    public const STATE_READY = 'ready';
    public const STATE_FAILED = 'failed';

    protected $table = 'storefront_media_derivatives';

    protected $fillable = [
        'tenant_id', 'media_id', 'usage_key', 'transform_key', 'transform', 'width', 'format',
        'rendered_width', 'rendered_height', 'bytes', 'avg_luminance', 'dominant_colour',
        'region_luminance', 'storage_key', 'state', 'error_code', 'attempts', 'claimed_at',
        'generated_at',
    ];

    protected $casts = [
        'transform' => 'array',
        'region_luminance' => 'array',
        'width' => 'integer',
        'rendered_width' => 'integer',
        'rendered_height' => 'integer',
        'bytes' => 'integer',
        'avg_luminance' => 'integer',
        'attempts' => 'integer',
        'claimed_at' => 'datetime',
        'generated_at' => 'datetime',
    ];

    protected $attributes = ['state' => self::STATE_PENDING, 'attempts' => 0];

    public function media(): \Illuminate\Database\Eloquent\Relations\BelongsTo
    {
        return $this->belongsTo(StorefrontMedia::class, 'media_id');
    }

    /** اسم الملف في R2 تحت مجلد الوسيط: `{transformKey}.{format}` — لا يطابق قواعد أسماء السلّم الأساسي. */
    public static function fileName(string $transformKey, string $format): string
    {
        return "{$transformKey}.{$format}";
    }
}
