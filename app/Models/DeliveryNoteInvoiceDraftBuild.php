<?php

namespace App\Models;

use App\Tenancy\BranchContext;
use App\Tenancy\BranchScoped;
use App\Tenancy\ResolvesBranchReferences;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

/**
 * مرساة idempotency لبناء مسودة فاتورة من سندات تسليم. لا تمثل قيداً ولا دفعة.
 * ينشئها DeliveryNoteSalesInvoiceDraftBuilder فقط بعد InvoiceService::create().
 */
class DeliveryNoteInvoiceDraftBuild extends BaseModel
{
    use BranchScoped;
    use ResolvesBranchReferences;

    public $timestamps = false;

    private static bool $writingAllowed = false;

    protected $fillable = [
        'tenant_id', 'branch_id', 'idempotency_key', 'request_checksum', 'invoice_id', 'created_by', 'created_at',
    ];

    protected static function booted(): void
    {
        static::creating(function (self $build): void {
            if (! self::$writingAllowed) {
                throw new LogicException('مرساة بناء فاتورة سندات التسليم لا تضاف إلا من خدمة المجال.');
            }

            $tenant = app(TenantContext::class);
            $branch = app(BranchContext::class);
            if (! $tenant->has() || ! $branch->has()) {
                throw new LogicException('بناء فاتورة سندات التسليم يتطلب سياق مستأجر وفرع موثوقين.');
            }

            $invoice = Invoice::query()->findOrFail($build->invoice_id);
            $actor = $build->created_by === null ? null : User::query()->find($build->created_by);
            if (! $invoice->isDraft()
                || $invoice->tenant_id !== $tenant->id()
                || $invoice->branch_id !== $branch->id()
                || $actor === null) {
                throw new LogicException('مرساة بناء فاتورة سندات التسليم لا تطابق نطاق المسودة أو الفاعل.');
            }

            $build->tenant_id = $tenant->id();
            $build->branch_id = $branch->id();
        });
        static::updating(fn () => throw new LogicException('مرساة بناء فاتورة سندات التسليم لا تعدل.'));
        static::deleting(fn () => throw new LogicException('مرساة بناء فاتورة سندات التسليم لا تحذف.'));
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

    public function invoice(): BelongsTo
    {
        return $this->referenceBelongsTo(Invoice::class);
    }

    public function allocations(): HasMany
    {
        return $this->hasMany(DeliveryNoteInvoiceAllocation::class);
    }

    public function creator(): BelongsTo
    {
        return $this->referenceBelongsTo(User::class, 'created_by');
    }
}
