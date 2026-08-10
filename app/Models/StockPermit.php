<?php

namespace App\Models;

use App\Support\RecordsRevisions;
use App\Tenancy\BelongsToBranch;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * إذن مخزني — إضافة أو صرف أو تحويل بين مخزنين.
 *
 * مستند **مخزني ومحاسبي معاً**: الترحيل يحرّك الكمية ويولّد القيد المقابل في
 * نفس المعاملة، فلا ينفصل حساب المراقبة 1140 عن دفتر المخزون المساعد.
 * كل المبالغ بالـ minor units (هللات) كـ bigint.
 */
/** @see design-system/foundations/multi-branch-architecture.md — موسوم: مستند، تصفيته صريحة في المتحكّم */
class StockPermit extends BaseModel
{
    use RecordsRevisions;
    use ResolvesBranchReferences;
    use BelongsToBranch;

    public const TYPES = ['receipt', 'issue', 'transfer'];

    protected $fillable = [
        'branch_id', 'tenant_id', 'type', 'number', 'warehouse_id', 'target_warehouse_id',
        'permit_date', 'status', 'reason', 'notes', 'total_cost', 'journal_entry_id', 'created_by',
    ];

    protected $casts = [
        'permit_date' => 'date',
        'total_cost'  => 'integer',
    ];

    protected $attributes = [
        'status'     => 'draft',
        'total_cost' => 0,
    ];

    public function lines(): HasMany
    {
        return $this->hasMany(StockPermitLine::class);
    }

    /** مراجع مخزَّنة — لا تُصفّى بالفرع (التحويل يعبر الفروع بطبيعته). */
    public function warehouse(): BelongsTo
    {
        return $this->referenceBelongsTo(Warehouse::class);
    }

    public function targetWarehouse(): BelongsTo
    {
        return $this->referenceBelongsTo(Warehouse::class, 'target_warehouse_id');
    }

    public function isDraft(): bool
    {
        return $this->status === 'draft';
    }

    public function isTransfer(): bool
    {
        return $this->type === 'transfer';
    }
}
