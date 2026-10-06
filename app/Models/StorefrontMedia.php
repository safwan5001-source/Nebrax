<?php

namespace App\Models;

use App\Tenancy\CompanyWide;

/**
 * CUST-HV V2a — أصل وسائط للمُخصِّص على مستوى المستأجر (صورة واحدة بأصلها
 * ومتغيّراتها الأساسية). العقد: docs/plans/store/CUST-HV-V0-DECISIONS-AND-
 * ARCHITECTURE-CONTRACT.md §7.2.
 *
 * **`CompanyWide`**: مكتبة مشتركة على مستوى المؤسسة (كـ`Storefront` و
 * `StorefrontPresentationVersion`) — لا فرع لها. العزل بالمستأجر آليٌّ عبر
 * `BaseModel`؛ المسارات غير المصادَقة (القراءة الموقَّعة) تتجاوز النطاق صراحةً
 * وتقارن `tenant_id` يدوياً.
 *
 * لا مسار/قرص/دلو يخرج من هذا النموذج: `storage_key` اسم ملفٍ فقط، والمفتاح
 * الكامل تبنيه `R2StorageService` من سياق المستأجر.
 */
/** @see design-system/foundations/multi-branch-architecture.md — مشترك: مكتبة وسائط المؤسسة */
class StorefrontMedia extends BaseModel implements CompanyWide
{
    /** نطاق R2 الثابت — نفس السلسلة لكل كتابة/قراءة/حذف. */
    public const R2_DOMAIN = 'storefront-media';

    public const KIND_IMAGE = 'image';

    public const STATE_ACTIVE = 'active';
    public const STATE_DELETED = 'deleted';
    public const STATE_PURGED = 'purged';

    public const VARIANTS_PENDING = 'pending';
    public const VARIANTS_READY = 'ready';
    public const VARIANTS_FAILED = 'failed';

    protected $table = 'storefront_media';

    protected $fillable = [
        'tenant_id', 'kind', 'original_name', 'mime', 'size', 'sha256', 'width', 'height',
        'avg_luminance', 'dominant_colour', 'region_luminance', 'alt_ar', 'alt_en',
        'storage_key', 'variants', 'variants_state', 'variants_error', 'state',
        'deleted_at', 'purge_after', 'uploaded_by',
    ];

    protected $casts = [
        'size' => 'integer',
        'width' => 'integer',
        'height' => 'integer',
        'avg_luminance' => 'integer',
        'region_luminance' => 'array',
        'variants' => 'array',
        'deleted_at' => 'datetime',
        'purge_after' => 'datetime',
    ];

    protected $attributes = [
        'kind' => self::KIND_IMAGE,
        'variants_state' => self::VARIANTS_PENDING,
        'state' => self::STATE_ACTIVE,
    ];

    public function isActive(): bool
    {
        return $this->state === self::STATE_ACTIVE;
    }

    public function isReady(): bool
    {
        return $this->variants_state === self::VARIANTS_READY;
    }

    /**
     * @return list<array{kind:string,width:int,height:int,format:string,file:string,bytes:int}>
     */
    public function variantList(): array
    {
        return is_array($this->variants) ? array_values($this->variants) : [];
    }

    /** @return array{kind:string,width:int,height:int,format:string,file:string,bytes:int}|null */
    public function variantByFile(string $file): ?array
    {
        foreach ($this->variantList() as $variant) {
            if (($variant['file'] ?? null) === $file) {
                return $variant;
            }
        }

        return null;
    }
}
