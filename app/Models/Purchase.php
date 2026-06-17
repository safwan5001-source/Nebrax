<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * فاتورة مشتريات من مورد. تُنشأ draft ثم تُرحَّل عبر PurchaseService::post
 * الذي يولّد قيداً متوازناً عبر LedgerService ويُدخِل البضاعة للمخزون.
 * كل المبالغ بالـ minor units (هللات) كـ bigint.
 */
class Purchase extends BaseModel
{
    protected $fillable = [
        'tenant_id', 'number', 'partner_id', 'payment_type',
        'purchase_date', 'due_date', 'supplier_invoice_no', 'status',
        'subtotal', 'tax_amount', 'total',
        'notes', 'journal_entry_id', 'created_by',
    ];

    protected $casts = [
        'purchase_date' => 'date',
        'due_date'      => 'date',
        'subtotal'      => 'integer',
        'tax_amount'    => 'integer',
        'total'         => 'integer',
    ];

    protected $attributes = [
        'payment_type' => 'credit',
        'status'       => 'draft',
        'subtotal'     => 0,
        'tax_amount'   => 0,
        'total'        => 0,
    ];

    public function lines(): HasMany
    {
        return $this->hasMany(PurchaseLine::class);
    }

    public function partner(): BelongsTo
    {
        return $this->belongsTo(Partner::class);
    }

    public function journalEntry(): BelongsTo
    {
        return $this->belongsTo(JournalEntry::class, 'journal_entry_id');
    }

    public function isDraft(): bool
    {
        return $this->status === 'draft';
    }

    public function isPosted(): bool
    {
        return $this->status === 'posted';
    }
}
