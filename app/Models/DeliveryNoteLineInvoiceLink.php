<?php

namespace App\Models;

use App\Tenancy\BranchContext;
use App\Tenancy\BranchScoped;
use App\Tenancy\ResolvesBranchReferences;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** رابط تدقيقي كامل بين سطر سند التسليم وسطر الفاتورة، ولا يمثل تخصيصاً جزئياً. */
class DeliveryNoteLineInvoiceLink extends BaseModel
{
    use BranchScoped;
    use ResolvesBranchReferences;

    public $timestamps = false;

    private static bool $writingAllowed = false;

    protected $fillable = [
        'tenant_id', 'branch_id', 'delivery_note_invoice_allocation_id', 'delivery_note_line_id', 'invoice_line_id',
        'quantity', 'quantity_numerator', 'quantity_denominator', 'unit_name', 'unit_factor', 'created_by', 'created_at',
    ];

    protected $casts = [
        'quantity' => 'integer',
        'quantity_numerator' => 'integer',
        'quantity_denominator' => 'integer',
        'unit_factor' => 'integer',
    ];

    protected static function booted(): void
    {
        static::creating(function (self $link): void {
            if (! self::$writingAllowed) {
                throw new LogicException('روابط سطور سندات التسليم لا تضاف إلا من خدمة بناء مسودة الفاتورة.');
            }

            $tenant = app(TenantContext::class);
            $branch = app(BranchContext::class);
            if (! $tenant->has() || ! $branch->has()) {
                throw new LogicException('رابط سطر سند التسليم يتطلب سياق مستأجر وفرع موثوقين.');
            }

            $allocation = DeliveryNoteInvoiceAllocation::query()->findOrFail($link->delivery_note_invoice_allocation_id);
            $sourceLine = DeliveryNoteLine::query()->findOrFail($link->delivery_note_line_id);
            $invoiceLine = InvoiceLine::query()->findOrFail($link->invoice_line_id);
            $invoice = Invoice::query()->findOrFail($invoiceLine->invoice_id);
            $actor = $link->created_by === null ? null : User::query()->find($link->created_by);
            if (! $invoice->isDraft()
                || $allocation->tenant_id !== $tenant->id()
                || $allocation->branch_id !== $branch->id()
                || $allocation->invoice_id !== $invoice->id
                || $sourceLine->tenant_id !== $tenant->id()
                || $sourceLine->branch_id !== $branch->id()
                || $sourceLine->delivery_note_id !== $allocation->delivery_note_id
                || $invoice->tenant_id !== $tenant->id()
                || $invoice->branch_id !== $branch->id()
                || $actor === null) {
                throw new LogicException('رابط سطر سند التسليم لا يطابق نطاق التخصيص أو المسودة.');
            }

            $link->tenant_id = $tenant->id();
            $link->branch_id = $branch->id();
        });
        static::updating(fn () => throw new LogicException('روابط سطور سندات التسليم لا تعدل.'));
        static::deleting(fn () => throw new LogicException('روابط سطور سندات التسليم لا تحذف.'));
    }

    /** @template T @param callable(): T $callback @return T */
    public static function withWriting(callable $callback): mixed
    {
        if (self::$writingAllowed) {
            return $callback();
        }

        self::$writingAllowed = true;
        try {
            return $callback();
        } finally {
            self::$writingAllowed = false;
        }
    }

    public function allocation(): BelongsTo
    {
        return $this->belongsTo(DeliveryNoteInvoiceAllocation::class, 'delivery_note_invoice_allocation_id');
    }

    public function deliveryNoteLine(): BelongsTo
    {
        return $this->belongsTo(DeliveryNoteLine::class);
    }

    public function invoiceLine(): BelongsTo
    {
        return $this->belongsTo(InvoiceLine::class);
    }
}
