<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * جهة اتصال (شخص) — مرتبطة اختيارياً بعميل. غير محاسبية.
 */
/** @see design-system/foundations/multi-branch-architecture.md — تشغيلي: معزول بالفرع */
class Contact extends BaseModel
{
    use ResolvesBranchReferences;
    use BranchScoped;

    protected $fillable = [
        'tenant_id', 'branch_id', 'partner_id', 'name', 'job_title', 'email', 'phone', 'notes', 'created_by',
    ];

    /** مرجع مخزَّن — لا يُصفّى بالفرع أبداً (المستند حجّة قائمة، لا نتيجة تصفّح). */
    public function partner(): BelongsTo
    {
        return $this->referenceBelongsTo(Partner::class);
    }
}
