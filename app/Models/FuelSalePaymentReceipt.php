<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** ربط تدقيقي idempotent بين FuelSale وسند قبض Nebrax الرسمي. */
class FuelSalePaymentReceipt extends BaseModel
{
    use BranchScoped;
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'branch_id', 'fuel_sale_id', 'payment_id', 'idempotency_key', 'recorded_at',
    ];

    protected $casts = ['recorded_at' => 'datetime'];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('ربط سند قبض بيع الوقود سجل تدقيق لا يعدّل.'));
        static::deleting(fn () => throw new LogicException('ربط سند قبض بيع الوقود لا يحذف.'));
    }

    public function sale(): BelongsTo { return $this->referenceBelongsTo(FuelSale::class, 'fuel_sale_id'); }
    public function payment(): BelongsTo { return $this->referenceBelongsTo(Payment::class); }
}
