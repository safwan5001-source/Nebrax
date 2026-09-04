<?php

namespace App\Models;

use App\Tenancy\BranchContext;
use App\Tenancy\BranchScoped;
use App\Tenancy\ResolvesBranchReferences;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * مرساة idempotency لاستبدال POS (R4). لا تمثّل قيداً ولا مستنداً منفرداً —
 * تحمي العملية الذرية الكاملة (مرتجع + بيع بديل + تسوية فائض) كوحدة واحدة.
 * ينشئها PosExchangeService فقط بعد نجاح create() الكامل.
 */
class PosExchangeAttempt extends BaseModel
{
    use BranchScoped;
    use ResolvesBranchReferences;

    public $timestamps = false;

    private static bool $writingAllowed = false;

    protected $fillable = [
        'tenant_id', 'branch_id', 'idempotency_key', 'request_checksum',
        'exchange_id', 'pos_session_id', 'created_by', 'created_at',
    ];

    protected static function booted(): void
    {
        static::creating(function (self $attempt): void {
            if (! self::$writingAllowed) {
                throw new LogicException('مرساة إتمام استبدال نقطة البيع لا تضاف إلا من خدمة المجال.');
            }

            $tenant = app(TenantContext::class);
            $branch = app(BranchContext::class);
            if (! $tenant->has() || ! $branch->has()) {
                throw new LogicException('مرساة إتمام استبدال نقطة البيع تتطلب سياق مستأجر وفرع موثوقين.');
            }

            $exchange = PosExchange::query()->findOrFail($attempt->exchange_id);
            if ($exchange->tenant_id !== $tenant->id() || $exchange->branch_id !== $branch->id()) {
                throw new LogicException('مرساة إتمام استبدال نقطة البيع لا تطابق نطاق المستند.');
            }

            $attempt->tenant_id = $tenant->id();
            $attempt->branch_id = $branch->id();
        });
        static::updating(fn () => throw new LogicException('مرساة إتمام استبدال نقطة البيع لا تعدل.'));
        static::deleting(fn () => throw new LogicException('مرساة إتمام استبدال نقطة البيع لا تحذف.'));
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

    public function exchange(): BelongsTo
    {
        return $this->referenceBelongsTo(PosExchange::class, 'exchange_id');
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
