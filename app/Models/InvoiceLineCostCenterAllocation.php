<?php

namespace App\Models;

use App\Tenancy\BelongsToBranch;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** توزيع صافي سطر فاتورة بين مراكز تكلفة؛ ليس قيداً مستقلاً ولا يعدّل إجمالي المستند. */
class InvoiceLineCostCenterAllocation extends BaseModel
{
    use BelongsToBranch;
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'branch_id', 'invoice_line_id', 'cost_center_id', 'mode', 'position', 'basis_points', 'amount',
    ];

    protected $casts = [
        'position'     => 'integer',
        'basis_points' => 'integer',
        'amount'       => 'integer',
    ];

    /** سطر المستند مرجع تاريخي، فلا يُخفى بتبديل نطاق العرض. */
    public function invoiceLine(): BelongsTo
    {
        return $this->referenceBelongsTo(InvoiceLine::class);
    }

    /** مركز التكلفة مرجع تحليلي مخزَّن؛ تحلّه العلاقة بأمان في السجل التاريخي. */
    public function costCenter(): BelongsTo
    {
        return $this->referenceBelongsTo(CostCenter::class);
    }
}
