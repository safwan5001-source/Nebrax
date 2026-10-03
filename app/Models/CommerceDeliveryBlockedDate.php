<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use App\Tenancy\TenantScope;
use DateTimeImmutable;
use RuntimeException;

/**
 * FLOWERS-H7a / ADR-19 — تاريخ تقويمي (بمنطقة سياسة القناة) لا تُنفِّذ فيه القناة تسليماً/استلاماً، لكل
 * الطرق (`all`) أو طريقة بعينها. التاريخ نصّ `Y-m-d` (لا cast) فتبقى المقارنة نصيةً متطابقة عبر المحرّكات.
 */
class CommerceDeliveryBlockedDate extends BaseModel implements CompanyWide
{
    public const METHOD_ALL = 'all';

    public const MAX_PER_CHANNEL = 400;

    protected $fillable = ['tenant_id', 'sales_channel_id', 'date', 'method', 'reason'];

    protected $attributes = ['method' => self::METHOD_ALL];

    protected static function booted(): void
    {
        static::saving(function (self $blocked) {
            $parsed = DateTimeImmutable::createFromFormat('!Y-m-d', (string) $blocked->date);
            if ($parsed === false || $parsed->format('Y-m-d') !== $blocked->date) {
                throw new RuntimeException('التاريخ المحجوب غير صالح.');
            }
            if (! in_array($blocked->method, [self::METHOD_ALL, ...CommerceDeliverySlot::METHODS], true)) {
                throw new RuntimeException('طريقة التسليم غير صالحة.');
            }
            if ($blocked->reason !== null && mb_strlen((string) $blocked->reason) > 120) {
                throw new RuntimeException('سبب الحجب أطول من المسموح.');
            }

            $tenantId = $blocked->tenant_id ?? app(TenantContext::class)->id();
            if ($tenantId === null) {
                return;
            }

            $channel = SalesChannel::withoutGlobalScope(TenantScope::class)->select(['id', 'tenant_id'])->find($blocked->sales_channel_id);
            if ($channel === null || $channel->tenant_id !== $tenantId) {
                throw new RuntimeException('قناة البيع غير موجودة لهذا المستأجر.');
            }
        });
    }
}
