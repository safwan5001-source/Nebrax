<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * فاتورة مبيعات. تُنشأ بحالة draft ثم تُرحَّل عبر InvoiceService::post
 * الذي يولّد قيداً متوازناً تلقائياً عبر LedgerService.
 * كل المبالغ بالـ minor units (هللات) كـ bigint.
 */
class Invoice extends BaseModel
{
    protected $fillable = [
        'tenant_id', 'number', 'partner_id', 'type', 'payment_type',
        'invoice_date', 'due_date', 'status',
        'subtotal', 'tax_amount', 'total',
        'paid_amount', 'payment_status',
        'notes', 'journal_entry_id', 'cogs_entry_id', 'created_by',
        'zatca_qr', 'zatca_hash',
        'zatca_uuid', 'zatca_icv', 'zatca_previous_hash', 'zatca_xml',
    ];

    protected $casts = [
        'invoice_date' => 'date',
        'due_date'     => 'date',
        'subtotal'     => 'integer',
        'tax_amount'   => 'integer',
        'total'        => 'integer',
        'paid_amount'  => 'integer',
    ];

    protected $attributes = [
        'type'           => 'sale',
        'payment_type'   => 'cash',
        'status'         => 'draft',
        'subtotal'       => 0,
        'tax_amount'     => 0,
        'total'          => 0,
        'paid_amount'    => 0,
        'payment_status' => 'unpaid',
    ];

    public function lines(): HasMany
    {
        return $this->hasMany(InvoiceLine::class);
    }

    public function partner(): BelongsTo
    {
        return $this->belongsTo(Partner::class);
    }

    public function journalEntry(): BelongsTo
    {
        return $this->belongsTo(JournalEntry::class, 'journal_entry_id');
    }

    public function cogsEntry(): BelongsTo
    {
        return $this->belongsTo(JournalEntry::class, 'cogs_entry_id');
    }

    public function isDraft(): bool
    {
        return $this->status === 'draft';
    }

    public function isPosted(): bool
    {
        return $this->status === 'posted';
    }

    /** المتبقي على الفاتورة (الإجمالي − المسدَّد). */
    public function remaining(): int
    {
        return max(0, $this->total - $this->paid_amount);
    }

    public function isFullyPaid(): bool
    {
        return $this->payment_status === 'paid';
    }

    public function isPartiallyPaid(): bool
    {
        return $this->payment_status === 'partial';
    }
}
