<?php

namespace App\Models;

use App\Support\GeneratesDocumentNumbers;
use App\Support\RecordsRevisions;
use App\Tenancy\BelongsToBranch;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * جرد مخزن — التقاطُ أرصدةٍ ثم عدٌّ ثم ترحيلُ الفرق.
 *
 * الترحيل يصحّح الكمية ويولّد قيد الفرق في معاملة واحدة، فلا ينفصل حساب
 * المراقبة 1140 عن دفتر المخزون المساعد.
 */
/** @see design-system/foundations/multi-branch-architecture.md — موسوم: مستند، تصفيته صريحة في المتحكّم */
class Stocktake extends BaseModel
{
    use RecordsRevisions;
    use ResolvesBranchReferences;
    use BelongsToBranch;
    use GeneratesDocumentNumbers;

    protected $fillable = [
        'branch_id', 'tenant_id', 'number', 'warehouse_id', 'stocktake_date',
        'status', 'notes', 'difference_value', 'journal_entry_id', 'created_by',
    ];

    protected $casts = [
        'stocktake_date'   => 'date',
        'difference_value' => 'integer',
    ];

    protected $attributes = [
        'status'           => 'draft',
        'difference_value' => 0,
    ];

    public function lines(): HasMany
    {
        return $this->hasMany(StocktakeLine::class);
    }

    /** مرجع مخزَّن — لا يُصفّى بالفرع. */
    public function warehouse(): BelongsTo
    {
        return $this->referenceBelongsTo(Warehouse::class);
    }

    public function isDraft(): bool
    {
        return $this->status === 'draft';
    }
}
