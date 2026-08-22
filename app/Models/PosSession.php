<?php

namespace App\Models;

use App\Support\GeneratesDocumentNumbers;
use App\Tenancy\BelongsToBranch;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
/**
 * جلسة نقطة بيع (وردية) — سجلّ تشغيلي لمطابقة النقدية. غير محاسبي.
 * المبالغ بالهللات كـ bigint.
 */
class PosSession extends BaseModel
{
    use BelongsToBranch;
    use GeneratesDocumentNumbers;
    use ResolvesBranchReferences;

    protected $fillable = [
        'branch_id',
        'tenant_id', 'number', 'status', 'opening_balance', 'closing_balance',
        'expected_balance', 'difference', 'opened_at', 'closed_at', 'notes', 'opened_by', 'closed_by',
        'pos_device_id', 'warehouse_id', 'shift_id',
    ];

    protected $casts = [
        'opening_balance'  => 'integer',
        'closing_balance'  => 'integer',
        'expected_balance' => 'integer',
        'difference'       => 'integer',
        'opened_at'        => 'datetime',
        'closed_at'        => 'datetime',
    ];

    protected $attributes = [
        'status'          => 'open',
        'opening_balance' => 0,
    ];

    /** جهاز البيع المثبت عند فتح الورديّة؛ يحل تاريخياً خارج عزل الفرع. */
    public function posDevice(): BelongsTo
    {
        return $this->referenceBelongsTo(PosDevice::class);
    }

    /** مخزن خروج البضائع المثبت للجلسة؛ لا يُعاد حله من إعداد الجهاز الحي. */
    public function warehouse(): BelongsTo
    {
        return $this->belongsTo(Warehouse::class);
    }

    /** وردية الموارد البشرية الاختيارية التي بدأت فيها جلسة الكاشير. */
    public function shift(): BelongsTo
    {
        return $this->referenceBelongsTo(Shift::class);
    }

    public function openedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'opened_by');
    }

    public function closedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'closed_by');
    }

    public function isOpen(): bool
    {
        return $this->status === 'open';
    }
}
