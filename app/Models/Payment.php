<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * سند قبض/صرف. تُنشأ بحالة draft ثم تُرحَّل عبر PaymentService::post
 * الذي يولّد قيداً متوازناً عبر LedgerService.
 *  - direction=received: قبض من عميل  (دائن 1130 العملاء)
 *  - direction=paid:     صرف لمورد    (مدين 2110 الموردون)
 * كل المبالغ بالـ minor units (هللات) كـ bigint.
 */
class Payment extends BaseModel
{
    protected $fillable = [
        'tenant_id', 'number', 'partner_id', 'invoice_id',
        'direction', 'method', 'payment_date', 'amount',
        'status', 'notes', 'journal_entry_id', 'created_by',
    ];

    protected $casts = [
        'payment_date' => 'date',
        'amount'       => 'integer',
    ];

    protected $attributes = [
        'direction' => 'received',
        'method'    => 'cash',
        'status'    => 'draft',
        'amount'    => 0,
    ];

    public function partner(): BelongsTo
    {
        return $this->belongsTo(Partner::class);
    }

    public function invoice(): BelongsTo
    {
        return $this->belongsTo(Invoice::class);
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
