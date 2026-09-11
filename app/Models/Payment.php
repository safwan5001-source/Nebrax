<?php

namespace App\Models;

use App\Support\GeneratesDocumentNumbers;
use App\Tenancy\BelongsToBranch;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Payment extends BaseModel
{
    use ResolvesBranchReferences;
    use BelongsToBranch;
    use GeneratesDocumentNumbers;

    protected $fillable = [
        'branch_id',
        'tenant_id', 'number', 'partner_id', 'invoice_id', 'pos_session_id', 'classification_id',
        'direction', 'method', 'payment_method_id', 'payment_method_name', 'payment_gateway_id', 'reference', 'payment_details', 'cash_account_id', 'payment_date', 'amount',
        'status', 'notes', 'journal_entry_id', 'reversal_entry_id', 'reversed_at', 'print_template_revision_id', 'pdf_template_revision_id', 'thermal_template_revision_id', 'created_by', 'collector_employee_id',
    ];

    protected $casts = [
        'payment_date' => 'date',
        'reversed_at'  => 'datetime',
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
        return $this->referenceBelongsTo(Partner::class);
    }

    public function classification(): BelongsTo
    {
        return $this->referenceBelongsTo(Classification::class);
    }

    public function invoice(): BelongsTo
    {
        return $this->belongsTo(Invoice::class);
    }

    public function posSession(): BelongsTo
    {
        return $this->referenceBelongsTo(PosSession::class);
    }

    public function cashAccount(): BelongsTo
    {
        return $this->belongsTo(Account::class, 'cash_account_id');
    }

    public function paymentMethod(): BelongsTo
    {
        return $this->belongsTo(PaymentMethod::class);
    }

    public function paymentGateway(): BelongsTo
    {
        return $this->belongsTo(PaymentGateway::class);
    }

    public function journalEntry(): BelongsTo
    {
        return $this->belongsTo(JournalEntry::class, 'journal_entry_id');
    }

    public function reversalEntry(): BelongsTo
    {
        return $this->belongsTo(JournalEntry::class, 'reversal_entry_id');
    }

    public function collectorEmployee(): BelongsTo
    {
        return $this->referenceBelongsTo(Employee::class, 'collector_employee_id');
    }

    public function attachments(): HasMany
    {
        return $this->hasMany(PaymentAttachment::class);
    }

    public function printTemplateRevision(): BelongsTo
    {
        return $this->belongsTo(PrintTemplateRevision::class, 'print_template_revision_id');
    }

    public function pdfTemplateRevision(): BelongsTo
    {
        return $this->belongsTo(PrintTemplateRevision::class, 'pdf_template_revision_id');
    }

    public function thermalTemplateRevision(): BelongsTo
    {
        return $this->belongsTo(PrintTemplateRevision::class, 'thermal_template_revision_id');
    }

    public function allocations(): HasMany
    {
        return $this->hasMany(PaymentAllocation::class);
    }

    public function isDraft(): bool
    {
        return $this->status === 'draft';
    }

    public function isPosted(): bool
    {
        return $this->status === 'posted';
    }

    public function isReversed(): bool
    {
        return $this->status === 'reversed';
    }
}
