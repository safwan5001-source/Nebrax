<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use DomainException;
use LogicException;

/**
 * مِرساة ترحيل طلب متجر مدفوع (PAY-H4-03): الطلب ↔ الفاتورة ↔ سند القبض ↔ محاولة الدفع. ثابتة (append-only)، تنشئها `CommerceOrderPostingService` وحدها
 * بعد أن تولّد الخدمات المحاسبية الفاتورة والسند. لا تكتب قيداً بنفسها. القيود الفريدة في القاعدة تمنع الترحيل المكرر.
 */
class CommerceOrderPosting extends BaseModel implements CompanyWide
{
    public const UPDATED_AT = null;

    protected $fillable = ['commerce_order_id', 'invoice_id', 'payment_id', 'payment_attempt_id', 'accounting_date', 'amount_minor'];

    protected function casts(): array
    {
        return ['amount_minor' => 'integer', 'accounting_date' => 'date'];
    }

    protected static function booted(): void
    {
        static::creating(function (self $posting): void {
            $context = app(TenantContext::class);
            if (! $context->has()) {
                throw new DomainException('Tenant context is required for commerce order postings.');
            }
            $posting->tenant_id = (string) $context->id();
            if ((int) $posting->amount_minor <= 0) {
                throw new DomainException('Commerce order posting amount is invalid.');
            }
            // كل المراجع تُحلّ بنطاق المستأجر: لا ربط عبر مستأجرين.
            foreach ([[CommerceOrder::class, 'commerce_order_id'], [Invoice::class, 'invoice_id'], [Payment::class, 'payment_id'], [PaymentAttempt::class, 'payment_attempt_id']] as [$model, $column]) {
                if (! $model::query()->whereKey($posting->{$column})->exists()) {
                    throw new DomainException("Commerce order posting {$column} must belong to the active tenant.");
                }
            }
        });

        static::updating(fn () => throw new LogicException('Commerce order postings are append-only.'));
        static::deleting(fn () => throw new LogicException('Commerce order postings are append-only.'));
    }
}
