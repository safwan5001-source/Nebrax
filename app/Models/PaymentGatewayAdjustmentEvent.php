<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * سجل تدقيق ثابت لتعديلات المزوّد (PAY-H3-02c): الفاعل والحالتان والسبب لكل انتقال. لا يكتب مالاً ولا يُعدَّل ولا يُحذف.
 */
class PaymentGatewayAdjustmentEvent extends BaseModel implements CompanyWide
{
    public const UPDATED_AT = null;

    protected $fillable = ['adjustment_id', 'action', 'from_status', 'to_status', 'actor_id', 'reason', 'meta'];

    protected function casts(): array
    {
        return ['meta' => 'array'];
    }

    protected static function booted(): void
    {
        static::creating(function (self $event): void {
            $context = app(TenantContext::class);
            if (! $context->has()) {
                throw new DomainException('Tenant context is required for gateway adjustment events.');
            }
            $event->tenant_id = (string) $context->id();
            if (! PaymentGatewayAdjustment::query()->whereKey($event->adjustment_id)->exists()) {
                throw new DomainException('Adjustment event must reference an adjustment of the active tenant.');
            }
        });
        static::updating(fn () => throw new LogicException('Gateway adjustment events are append-only.'));
        static::deleting(fn () => throw new LogicException('Gateway adjustment events are append-only.'));
    }

    public function adjustment(): BelongsTo
    {
        return $this->belongsTo(PaymentGatewayAdjustment::class, 'adjustment_id');
    }
}
