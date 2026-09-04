<?php

namespace App\Models;

use App\Tenancy\BranchContext;
use App\Tenancy\BranchScoped;
use App\Tenancy\ResolvesBranchReferences;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * مرساة idempotency لمرتجع POS (R4). لا تمثّل قيداً ولا حركة مخزون.
 * ينشئها PosReturnService فقط بعد ReturnService::create()/post() الناجحين.
 */
class PosReturnAttempt extends BaseModel
{
    use BranchScoped;
    use ResolvesBranchReferences;

    public $timestamps = false;

    private static bool $writingAllowed = false;

    protected $fillable = [
        'tenant_id', 'branch_id', 'idempotency_key', 'request_checksum',
        'return_id', 'pos_session_id', 'created_by', 'created_at',
    ];

    protected static function booted(): void
    {
        static::creating(function (self $attempt): void {
            if (! self::$writingAllowed) {
                throw new LogicException('مرساة إتمام مرتجع نقطة البيع لا تضاف إلا من خدمة المجال.');
            }

            $tenant = app(TenantContext::class);
            $branch = app(BranchContext::class);
            if (! $tenant->has() || ! $branch->has()) {
                throw new LogicException('مرساة إتمام مرتجع نقطة البيع تتطلب سياق مستأجر وفرع موثوقين.');
            }

            $return = ReturnDocument::query()->findOrFail($attempt->return_id);
            if ($return->tenant_id !== $tenant->id() || $return->branch_id !== $branch->id()) {
                throw new LogicException('مرساة إتمام مرتجع نقطة البيع لا تطابق نطاق المستند.');
            }

            $attempt->tenant_id = $tenant->id();
            $attempt->branch_id = $branch->id();
        });
        static::updating(fn () => throw new LogicException('مرساة إتمام مرتجع نقطة البيع لا تعدل.'));
        static::deleting(fn () => throw new LogicException('مرساة إتمام مرتجع نقطة البيع لا تحذف.'));
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

    public function return(): BelongsTo
    {
        return $this->referenceBelongsTo(ReturnDocument::class, 'return_id');
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
