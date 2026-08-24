<?php

namespace App\Models;

use App\Tenancy\BelongsToBranch;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** مرفق إثبات لفاتورة شراء؛ لا يحمل أثراً محاسبياً أو مخزونياً مستقلاً. */
class PurchaseAttachment extends BaseModel
{
    use BelongsToBranch;
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'branch_id', 'purchase_id', 'disk', 'path', 'original_name',
        'mime_type', 'size', 'uploaded_by',
    ];

    protected $casts = ['size' => 'integer'];

    /** مرجع فاتورة قائم، لذلك لا يتأثر تغيير الفرع الحالي عند قراءة الإثبات. */
    public function purchase(): BelongsTo
    {
        return $this->referenceBelongsTo(Purchase::class);
    }

    public function uploader(): BelongsTo
    {
        return $this->referenceBelongsTo(User::class, 'uploaded_by');
    }
}
