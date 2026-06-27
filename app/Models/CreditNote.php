<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * إشعار دائن (Credit Note) — مستند مالي للعميل (بلا حركة مخزون).
 * يُنشأ draft ثم يُرحَّل عبر CreditNoteService::post الذي يولّد قيداً
 * عكسياً متوازناً عبر LedgerService. كل المبالغ بالهللات كـ bigint.
 */
class CreditNote extends BaseModel
{
    protected $fillable = [
        'tenant_id', 'number', 'partner_id', 'refund_type', 'note_date',
        'status', 'subtotal', 'tax_amount', 'total', 'reason',
        'original_invoice_id', 'journal_entry_id', 'created_by',
    ];

    protected $casts = [
        'note_date'  => 'date',
        'subtotal'   => 'integer',
        'tax_amount' => 'integer',
        'total'      => 'integer',
    ];

    protected $attributes = [
        'refund_type' => 'credit',
        'status'      => 'draft',
        'subtotal'    => 0,
        'tax_amount'  => 0,
        'total'       => 0,
    ];

    public function lines(): HasMany
    {
        return $this->hasMany(CreditNoteLine::class);
    }

    public function partner(): BelongsTo
    {
        return $this->belongsTo(Partner::class);
    }

    public function isDraft(): bool
    {
        return $this->status === 'draft';
    }
}
