<?php

namespace App\Models;

use App\Tenancy\BelongsToBranch;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** مرفق إثبات لسند قبض أو صرف؛ يتبع المستند ولا يحمل أثراً محاسبياً مستقلاً. */
class PaymentAttachment extends BaseModel
{
    use BelongsToBranch;
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'branch_id', 'payment_id', 'disk', 'path', 'original_name',
        'mime_type', 'size', 'uploaded_by',
    ];

    protected $casts = ['size' => 'integer'];

    /** مرجع مستند تاريخي؛ لا يخفيه عزل الفرع عند قراءة الإثبات. */
    public function payment(): BelongsTo
    {
        return $this->referenceBelongsTo(Payment::class);
    }

    public function uploader(): BelongsTo
    {
        return $this->referenceBelongsTo(User::class, 'uploaded_by');
    }
}
