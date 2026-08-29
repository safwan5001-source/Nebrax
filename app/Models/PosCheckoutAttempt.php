<?php

namespace App\Models;

use App\Tenancy\BranchContext;
use App\Tenancy\BranchScoped;
use App\Tenancy\ResolvesBranchReferences;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * مرساة idempotency لإتمام بيع POS. لا تمثّل قيداً ولا دفعة.
 * ينشئها PosService فقط بعد InvoiceService::create()/post() الناجحين.
 */
class PosCheckoutAttempt extends BaseModel
{
    use BranchScoped;
    use ResolvesBranchReferences;

    public $timestamps = false;

    private static bool $writingAllowed = false;

    protected $fillable = [
        'tenant_id', 'branch_id', 'idempotency_key', 'request_checksum',
        'invoice_id', 'cart_id', 'pos_session_id', 'created_by', 'created_at',
    ];

    protected static function booted(): void
    {
        static::creating(function (self $attempt): void {
            if (! self::$writingAllowed) {
                throw new LogicException('مرساة إتمام بيع نقطة البيع لا تضاف إلا من خدمة المجال.');
            }

            $tenant = app(TenantContext::class);
            $branch = app(BranchContext::class);
            if (! $tenant->has() || ! $branch->has()) {
                throw new LogicException('مرساة إتمام بيع نقطة البيع تتطلب سياق مستأجر وفرع موثوقين.');
            }

            $invoice = Invoice::query()->findOrFail($attempt->invoice_id);
            if ($invoice->tenant_id !== $tenant->id() || $invoice->branch_id !== $branch->id()) {
                throw new LogicException('مرساة إتمام بيع نقطة البيع لا تطابق نطاق الفاتورة.');
            }

            $attempt->tenant_id = $tenant->id();
            $attempt->branch_id = $branch->id();
        });
        static::updating(fn () => throw new LogicException('مرساة إتمام بيع نقطة البيع لا تعدل.'));
        static::deleting(fn () => throw new LogicException('مرساة إتمام بيع نقطة البيع لا تحذف.'));
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

    public function session(): BelongsTo
    {
        return $this->referenceBelongsTo(PosSession::class, 'pos_session_id');
    }

    public function creator(): BelongsTo
    {
        return $this->referenceBelongsTo(User::class, 'created_by');
    }
}
