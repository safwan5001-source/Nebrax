<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

/**
 * ═══════════════════════════════════════════════════════════════
 *  تطبيق جوال — AWJ App Builder (APP-BUILDER-1)
 * ═══════════════════════════════════════════════════════════════
 *
 * هويّة/معدن فقط — لا يحمل محتوى التجربة (انظر `draft()`/`publishedVersions()`).
 *
 * **`CompanyWide`**: يخصّ المؤسسة كلها، لا فرعاً بعينه — يوازي تصنيف
 * `commerce.storefront` (قناة بيع واحدة للمؤسسة).
 */
class BuilderApp extends BaseModel implements CompanyWide
{
    public const SOURCE_STORE_DESIGN = 'store_design';

    public const SOURCE_TEMPLATE = 'template';

    public const SOURCE_SCRATCH = 'scratch';

    public const CREATION_SOURCES = [
        self::SOURCE_STORE_DESIGN,
        self::SOURCE_TEMPLATE,
        self::SOURCE_SCRATCH,
    ];

    protected $fillable = [
        'tenant_id', 'name', 'name_en', 'creation_source', 'created_by',
    ];

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /** المسودة العاملة الحالية — صفٌّ واحد دوماً (مُنشأ ذرّياً مع التطبيق). */
    public function draft(): HasOne
    {
        return $this->hasOne(BuilderDraftExperience::class);
    }

    public function publishedVersions(): HasMany
    {
        return $this->hasMany(BuilderPublishedExperienceVersion::class)->orderByDesc('version');
    }

    /** أحدث نسخة منشورة، أو null إن لم يُنشر التطبيق قط. */
    public function latestPublishedVersion(): ?BuilderPublishedExperienceVersion
    {
        return $this->publishedVersions()->first();
    }
}
