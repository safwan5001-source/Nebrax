<?php

namespace App\Models;

use App\Tenancy\BelongsToBranch;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** مرفق إثبات لمصروف؛ يتبع المستند ولا يحمل أثراً محاسبياً مستقلاً. */
class ExpenseAttachment extends BaseModel
{
    use BelongsToBranch;
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'branch_id', 'expense_id', 'disk', 'path', 'original_name',
        'mime_type', 'size', 'uploaded_by',
    ];

    protected $casts = ['size' => 'integer'];

    /** مرجع مستند: لا يجوز أن يختفي من قراءة الأثر التاريخي بسبب فرع نشط آخر. */
    public function expense(): BelongsTo
    {
        return $this->referenceBelongsTo(Expense::class);
    }

    public function uploader(): BelongsTo
    {
        return $this->referenceBelongsTo(User::class, 'uploaded_by');
    }
}
