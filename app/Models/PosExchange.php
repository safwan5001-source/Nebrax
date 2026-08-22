<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * سجل تشغيلي لاستبدال POS: يربط مرتجع المبيعات بفاتورة البيع البديلة.
 * كل أثر مالي ومخزني يبقى على مستنديه الأصليين؛ هذا السجل لا ينشئ قيداً بنفسه.
 */
class PosExchange extends BaseModel
{
    use BranchScoped;

    protected $fillable = [
        'branch_id',
        'tenant_id',
        'pos_session_id',
        'original_invoice_id',
        'return_id',
        'replacement_invoice_id',
        'applied_credit_amount',
        'cash_refund_amount',
        'journal_entry_id',
        'status',
        'notes',
        'created_by',
    ];

    protected $casts = [
        'applied_credit_amount' => 'integer',
        'cash_refund_amount' => 'integer',
    ];

    protected $attributes = [
        'status' => 'draft',
        'applied_credit_amount' => 0,
        'cash_refund_amount' => 0,
    ];

    public function session(): BelongsTo
    {
        return $this->belongsTo(PosSession::class, 'pos_session_id');
    }

    public function originalInvoice(): BelongsTo
    {
        return $this->belongsTo(Invoice::class, 'original_invoice_id');
    }

    public function returnDocument(): BelongsTo
    {
        return $this->belongsTo(ReturnDocument::class, 'return_id');
    }

    public function replacementInvoice(): BelongsTo
    {
        return $this->belongsTo(Invoice::class, 'replacement_invoice_id');
    }

    protected static function booted(): void
    {
        static::updating(function (self $exchange): void {
            if ($exchange->getOriginal('status') === 'posted') {
                throw new LogicException('لا يمكن تعديل استبدال POS مرحّل.');
            }
        });
        static::deleting(function (self $exchange): void {
            throw new LogicException('لا يمكن حذف استبدال POS؛ أنشئ مستندات تصحيحية بدلاً منه.');
        });
    }
}
