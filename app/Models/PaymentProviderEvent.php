<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use DomainException;
use LogicException;

/**
 * حدث webhook متحقَّق التوقيع من مزوّد دفع (PAY-H1-04). **صندوق وارد لا مصدر حالة**: لا تُطبَّق حالة من جسمه؛ يطلق استعلام المزوّد
 * (`PaymentOrchestrator::sync`) وحده. الجسم مشفَّر (≤ 64KB) ويُقصّ بعد 180 يوماً (D-20) ويبقى الصف. هوية الحدث وبصمة جسمه
 * وجسمه لا تتغيّر؛ يتغيّر فقط ربطه بالمحاولة وحالة معالجته. لا حذف.
 */
class PaymentProviderEvent extends BaseModel implements CompanyWide
{
    public const MAX_BODY_BYTES = 65536;

    public const STATUS_RECEIVED = 'received';

    public const STATUS_PROCESSED = 'processed';

    public const STATUS_UNMATCHED = 'unmatched';

    public $timestamps = false;

    protected $dateFormat = 'Y-m-d H:i:s.u';

    protected $fillable = [
        'payment_gateway_id', 'provider', 'provider_event_id', 'event_type', 'provider_payment_id', 'body_hash', 'body',
    ];

    protected $hidden = ['body'];

    protected function casts(): array
    {
        return [
            'body' => 'encrypted',
            'received_at' => 'immutable_datetime',
            'processed_at' => 'immutable_datetime',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (self $event): void {
            $context = app(TenantContext::class);
            if (! $context->has()) {
                throw new DomainException('Tenant context is required for provider events.');
            }
            $event->tenant_id = (string) $context->id();
            if (! PaymentGateway::query()->whereKey($event->payment_gateway_id)->exists()) {
                throw new DomainException('Provider event gateway must belong to the active tenant.');
            }
            $event->received_at ??= now('UTC');
        });

        static::updating(function (self $event): void {
            foreach (['tenant_id', 'payment_gateway_id', 'provider', 'provider_event_id', 'body_hash', 'received_at'] as $field) {
                if ($event->isDirty($field)) {
                    throw new LogicException("Provider event field [{$field}] is immutable.");
                }
            }
            if ($event->isDirty('body') && $event->body !== null) {
                throw new LogicException('Provider event body can only be cleared by retention, never rewritten.');
            }
        });

        static::deleting(fn () => throw new LogicException('Provider events are never deleted.'));
    }
}
