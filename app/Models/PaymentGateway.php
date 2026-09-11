<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * إعداد مزوّد بوابة دفع للمستأجر — طبقة تكامل، ليست طريقة دفع.
 *
 * PaymentMethod يبقى البيان التشغيلي الظاهر للأعمال.
 * PaymentGateway يخزّن هوية المزوّد وبيانات الاعتماد فقط.
 *
 * الأسرار تُشفَّر at-rest عبر cast `encrypted` (نفس نمط WebhookEndpoint)
 * وتُخفى من التسلسل. لا قيود محاسبية ولا استدعاء مزوّد في هذا الأساس.
 */
class PaymentGateway extends BaseModel implements CompanyWide
{
    public const PROVIDER_STRIPE = 'stripe';

    public const PROVIDER_TAP = 'tap';

    public const PROVIDER_PAYTABS = 'paytabs';

    public const PROVIDER_CHECKOUT = 'checkout';

    public const PROVIDER_CUSTOM = 'custom';

    public const ENVIRONMENT_SANDBOX = 'sandbox';

    public const ENVIRONMENT_LIVE = 'live';

    public const PROVIDERS = [
        self::PROVIDER_STRIPE,
        self::PROVIDER_TAP,
        self::PROVIDER_PAYTABS,
        self::PROVIDER_CHECKOUT,
        self::PROVIDER_CUSTOM,
    ];

    public const ENVIRONMENTS = [
        self::ENVIRONMENT_SANDBOX,
        self::ENVIRONMENT_LIVE,
    ];

    protected $fillable = [
        'tenant_id',
        'provider',
        'name',
        'name_en',
        'environment',
        'is_active',
        'merchant_reference',
        'publishable_key',
        'secret_key',
        'webhook_secret',
        'extra_credentials',
        'payment_method_id',
    ];

    protected $hidden = [
        'secret_key',
        'webhook_secret',
        'extra_credentials',
    ];

    protected $attributes = [
        'environment' => self::ENVIRONMENT_SANDBOX,
        'is_active' => true,
    ];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
            'secret_key' => 'encrypted',
            'webhook_secret' => 'encrypted',
            'extra_credentials' => 'encrypted:array',
        ];
    }

    protected static function booted(): void
    {
        static::saving(function (self $gateway): void {
            $context = app(TenantContext::class);
            if (! $context->has()) {
                throw new DomainException('Tenant context is required for payment gateway configuration.');
            }

            $tenantId = (string) $context->id();

            if ($gateway->tenant_id !== null && (string) $gateway->tenant_id !== $tenantId) {
                throw new DomainException('Payment gateway tenant cannot be forged.');
            }

            $gateway->tenant_id = $tenantId;

            if ($gateway->payment_method_id) {
                if (! PaymentMethod::query()->whereKey($gateway->payment_method_id)->exists()) {
                    throw new DomainException('Payment method must belong to the active tenant.');
                }
            }
        });
    }

    public function paymentMethod(): BelongsTo
    {
        return $this->belongsTo(PaymentMethod::class);
    }

    public function hasSecretKey(): bool
    {
        return filled($this->secret_key);
    }

    public function hasWebhookSecret(): bool
    {
        return filled($this->webhook_secret);
    }

    public function hasExtraCredentials(): bool
    {
        return is_array($this->extra_credentials) && $this->extra_credentials !== [];
    }
}
