<?php

namespace App\Models;

use App\Tenancy\BelongsToBranch;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** بيانات ملف خاص مرتبط بملاحظة فاتورة، لا رابط عام ولا أثر محاسبي مستقل. */
class InvoiceNoteAttachment extends BaseModel
{
    use BelongsToBranch;
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'branch_id', 'invoice_note_id', 'disk', 'path', 'original_name',
        'mime_type', 'size', 'uploaded_by',
    ];

    protected $casts = ['size' => 'integer'];

    public function note(): BelongsTo
    {
        return $this->referenceBelongsTo(InvoiceNote::class, 'invoice_note_id');
    }

    public function uploader(): BelongsTo
    {
        return $this->referenceBelongsTo(User::class, 'uploaded_by');
    }
}
