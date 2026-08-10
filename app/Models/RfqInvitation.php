<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * دعوة مورّد إلى طلب عروض أسعار — سجلّ مَن طُلب منه التسعير.
 */
/** @see design-system/foundations/multi-branch-architecture.md — مشترك: سجلّ تابع لمستند — يتبع فرع رأسه */
class RfqInvitation extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    protected $fillable = ['tenant_id', 'procurement_document_id', 'partner_id'];

    public function document(): BelongsTo
    {
        return $this->belongsTo(ProcurementDocument::class, 'procurement_document_id');
    }

    /** مرجع مخزَّن — لا يُصفّى بالفرع أبداً. */
    public function partner(): BelongsTo
    {
        return $this->referenceBelongsTo(Partner::class);
    }
}
