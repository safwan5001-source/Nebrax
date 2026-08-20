<?php

namespace App\Models;

use App\Tenancy\BelongsToBranch;
use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * مسوّغ تعيين (مرفق) لموظف؛ يتبع تصنيف `Employee` (`CompanyWide`) — كل
 * الفروع ترى مرفقات كل الموظفين، فلا Global Scope فرع هنا أيضاً.
 */
class EmployeeAttachment extends BaseModel implements CompanyWide
{
    use BelongsToBranch;
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'branch_id', 'employee_id', 'disk', 'path', 'original_name',
        'mime_type', 'size', 'uploaded_by',
    ];

    protected $casts = ['size' => 'integer'];

    public function employee(): BelongsTo
    {
        return $this->referenceBelongsTo(Employee::class);
    }

    public function uploader(): BelongsTo
    {
        return $this->referenceBelongsTo(User::class, 'uploaded_by');
    }
}
