<?php

namespace App\Models;

use App\Tenancy\BelongsToBranch;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** ملاحظة تشغيلية داخلية مرتبطة بفاتورة؛ لا تنشئ أثراً محاسبياً. */
class InvoiceNote extends BaseModel
{
    use BelongsToBranch;
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'branch_id', 'invoice_id', 'recorded_at', 'body', 'created_by',
    ];

    protected $casts = [
        'recorded_at' => 'datetime',
    ];

    /** فاتورة مرجعية محفوظة؛ لا تختفي من أثر السجل بسبب تبديل نطاق العرض. */
    public function invoice(): BelongsTo
    {
        return $this->referenceBelongsTo(Invoice::class);
    }

    public function attachments(): HasMany
    {
        return $this->hasMany(InvoiceNoteAttachment::class);
    }

    public function author(): BelongsTo
    {
        return $this->referenceBelongsTo(User::class, 'created_by');
    }
}
