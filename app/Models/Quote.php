<?php

namespace App\Models;

use App\Support\RecordsRevisions;
use App\Tenancy\BelongsToBranch;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * عرض سعر (Quote) — مستند تجاري غير محاسبي: لا يولّد قيوداً.
 * يُحوَّل إلى فاتورة مبيعات عبر QuoteService::convert عند القبول.
 * كل المبالغ بالـ minor units (هللات) كـ bigint.
 */
class Quote extends BaseModel
{
    use ResolvesBranchReferences;
    use RecordsRevisions;
    use BelongsToBranch;

    protected $fillable = [
        'branch_id',
        'tenant_id', 'number', 'partner_id', 'quote_date', 'valid_until',
        'status', 'subtotal', 'tax_amount', 'total', 'tax_inclusive', 'notes',
        'converted_invoice_id', 'created_by',
    ];

    protected $casts = [
        'quote_date'    => 'date',
        'valid_until'   => 'date',
        'subtotal'      => 'integer',
        'tax_amount'    => 'integer',
        'total'         => 'integer',
        'tax_inclusive' => 'boolean',
    ];

    protected $attributes = [
        'status'     => 'draft',
        'subtotal'   => 0,
        'tax_amount' => 0,
        'total'      => 0,
    ];

    public function lines(): HasMany
    {
        return $this->hasMany(QuoteLine::class);
    }

    /** مرجع مخزَّن — لا يُصفّى بالفرع أبداً (المستند حجّة قائمة، لا نتيجة تصفّح). */
    public function partner(): BelongsTo
    {
        return $this->referenceBelongsTo(Partner::class);
    }

    public function isConverted(): bool
    {
        return $this->status === 'converted';
    }
}
