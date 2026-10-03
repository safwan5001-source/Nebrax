<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\HasMany;
use RuntimeException;

/**
 * FLOWERS-H2 / ADR-14 §2.3 — مجموعة تسويقية يدوية مرتّبة. ليست تصنيفاً ولا بُعداً:
 * أعضاؤها لا يتشاركون خاصية. `CompanyWide` كـ`CommerceListing`. الظهور العام =
 * `status = active` **و** عضو يمرّ ببوابة نشر المنتج على القناة.
 */
class CommerceCollection extends BaseModel implements CompanyWide
{
    public const STATUS_DRAFT = 'draft';

    public const STATUS_ACTIVE = 'active';

    public const STATUSES = [self::STATUS_DRAFT, self::STATUS_ACTIVE];

    protected $fillable = ['tenant_id', 'slug', 'title', 'title_en', 'description', 'status', 'sort_order'];

    protected $casts = ['sort_order' => 'integer'];

    protected $attributes = ['status' => self::STATUS_DRAFT, 'sort_order' => 0];

    protected static function booted(): void
    {
        static::saving(function (self $collection) {
            if (! in_array($collection->status, self::STATUSES, true)) {
                throw new RuntimeException('حالة المجموعة غير معروفة.');
            }
        });
    }

    public function members(): HasMany
    {
        return $this->hasMany(CommerceCollectionProduct::class, 'commerce_collection_id')->orderBy('position');
    }
}
