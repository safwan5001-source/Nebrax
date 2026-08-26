<?php

namespace App\Models;

use App\Tenancy\BranchContext;
use App\Tenancy\BranchScoped;
use App\Tenancy\ResolvesBranchReferences;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

/** تخصيص MVP كامل وغير قابل للتحرير بين سند تسليم مؤكد ومسودة فاتورة واحدة. */
class DeliveryNoteInvoiceAllocation extends BaseModel
{
    use BranchScoped;
    use ResolvesBranchReferences;

    public $timestamps = false;

    private static bool $writingAllowed = false;

    protected $fillable = [
        'tenant_id', 'branch_id', 'delivery_note_invoice_draft_build_id', 'delivery_note_id', 'invoice_id',
        'delivery_note_number_snapshot', 'delivery_note_status_snapshot', 'created_by', 'created_at',
    ];

    protected static function booted(): void
    {
        static::creating(function (self $allocation): void {
            if (! self::$writingAllowed) {
                throw new LogicException('تخصيص سند التسليم لا يضاف إلا من خدمة بناء مسودة الفاتورة.');
            }

            $tenant = app(TenantContext::class);
            $branch = app(BranchContext::class);
            if (! $tenant->has() || ! $branch->has()) {
                throw new LogicException('تخصيص سند التسليم يتطلب سياق مستأجر وفرع موثوقين.');
            }

            $build = DeliveryNoteInvoiceDraftBuild::query()->findOrFail($allocation->delivery_note_invoice_draft_build_id);
            $note = DeliveryNote::query()->findOrFail($allocation->delivery_note_id);
            $invoice = Invoice::query()->findOrFail($allocation->invoice_id);
            $actor = $allocation->created_by === null ? null : User::query()->find($allocation->created_by);
            if (! $invoice->isDraft()
                || ! $note->isConfirmed()
                || $build->invoice_id !== $invoice->id
                || $build->tenant_id !== $tenant->id()
                || $build->branch_id !== $branch->id()
                || $note->tenant_id !== $tenant->id()
                || $note->branch_id !== $branch->id()
                || $invoice->tenant_id !== $tenant->id()
                || $invoice->branch_id !== $branch->id()
                || $actor === null) {
                throw new LogicException('تخصيص سند التسليم لا يطابق نطاق البناء أو حالة المصدر أو المسودة.');
            }

            $allocation->tenant_id = $tenant->id();
            $allocation->branch_id = $branch->id();
        });
        static::updating(fn () => throw new LogicException('تخصيص سند التسليم لا يعدل.'));
        static::deleting(fn () => throw new LogicException('تخصيص سند التسليم لا يحذف.'));
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

    public function build(): BelongsTo
    {
        return $this->belongsTo(DeliveryNoteInvoiceDraftBuild::class, 'delivery_note_invoice_draft_build_id');
    }

    public function deliveryNote(): BelongsTo
    {
        return $this->referenceBelongsTo(DeliveryNote::class);
    }

    public function invoice(): BelongsTo
    {
        return $this->referenceBelongsTo(Invoice::class);
    }

    public function lineLinks(): HasMany
    {
        return $this->hasMany(DeliveryNoteLineInvoiceLink::class);
    }
}
