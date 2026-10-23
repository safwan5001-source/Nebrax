<?php

namespace App\Models;

use App\Support\PaymentGatewayException;
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
 *
 * PAY-H1-01: حقول دورة الحياة (`status`، `credential_version`، `webhook_key`، السر السابق…)
 * خارج `$fillable` عمداً — تُكتب عبر `PaymentGatewayService` وحده. `is_active` مفتاح تشغيل قديم
 * يبقى للتوافق؛ الاستخدام الفعلي = `isUsable()` (يتطلب الحالتين).
 */
class PaymentGateway extends BaseModel implements CompanyWide
{
    public const PROVIDER_STRIPE = 'stripe';

    public const PROVIDER_TAP = 'tap';

    public const PROVIDER_PAYTABS = 'paytabs';

    public const PROVIDER_CHECKOUT = 'checkout';

    /** Moyasar — المزوّد الأول (ADR-0005، Sandbox فقط حتى قرار G-LIVE). */
    public const PROVIDER_MOYASAR = 'moyasar';

    public const PROVIDER_CUSTOM = 'custom';

    public const STATUS_DRAFT = 'draft';

    public const STATUS_ACTIVE = 'active';

    public const STATUS_SUSPENDED = 'suspended';

    public const STATUS_REVOKED = 'revoked';

    public const STATUSES = [
        self::STATUS_DRAFT,
        self::STATUS_ACTIVE,
        self::STATUS_SUSPENDED,
        self::STATUS_REVOKED,
    ];

    public const MODE_BYOG = 'byog';

    public const ENVIRONMENT_SANDBOX = 'sandbox';

    public const ENVIRONMENT_LIVE = 'live';

    public const PROVIDERS = [
        self::PROVIDER_STRIPE,
        self::PROVIDER_TAP,
        self::PROVIDER_PAYTABS,
        self::PROVIDER_CHECKOUT,
        self::PROVIDER_MOYASAR,
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
        'previous_webhook_secret',
        'webhook_key',
    ];

    protected $attributes = [
        'environment' => self::ENVIRONMENT_SANDBOX,
        'is_active' => true,
        'status' => self::STATUS_DRAFT,
        'connection_mode' => self::MODE_BYOG,
        'credential_version' => 1,
    ];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
            'secret_key' => 'encrypted',
            'webhook_secret' => 'encrypted',
            'extra_credentials' => 'encrypted:array',
            'previous_webhook_secret' => 'encrypted',
            'previous_secret_expires_at' => 'datetime',
            'capabilities' => 'array',
            'credential_version' => 'integer',
            'verified_at' => 'datetime',
            'activated_at' => 'datetime',
            'deactivated_at' => 'datetime',
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

            if (blank($gateway->webhook_key)) {
                $gateway->webhook_key = bin2hex(random_bytes(32));
            }

            if ($gateway->payment_method_id) {
                if (! PaymentMethod::query()->whereKey($gateway->payment_method_id)->exists()) {
                    throw new DomainException('Payment method must belong to the active tenant.');
                }
            }
        });

        // حذف بوابة لها سند أو تسوية يمحو ربطاً مالياً (`payments.payment_gateway_id` يصير NULL).
        // الحارس هنا يغطي كل مسار حذف عبر Eloquent لا الخدمة وحدها. الحذف الجماعي/SQL الخام
        // وحذف المستأجر (CASCADE) خارج نطاقه عمداً.
        static::deleting(function (self $gateway): void {
            if ($gateway->hasFinancialReferences()) {
                throw new PaymentGatewayException(
                    'gateway.has_references',
                    'لا يمكن حذف بوابة مرتبطة بسندات أو تسويات. أوقفها أو ألغِ اعتمادها بدلاً من ذلك.'
                );
            }
        });
    }

    /** سندات أو تسويات أو محاولات دفع تشير إلى البوابة (لكل الفروع؛ نطاق المستأجر وحده). */
    public function hasFinancialReferences(): bool
    {
        return Payment::query()->where('payment_gateway_id', $this->getKey())->exists()
            || PaymentGatewaySettlement::query()->where('payment_gateway_id', $this->getKey())->exists()
            || PaymentAttempt::query()->where('payment_gateway_id', $this->getKey())->exists()
            || PaymentMethod::query()->where('pos_clearing_gateway_id', $this->getKey())->exists();
    }

    /**
     * مزوّد حقيقي تُستعمل أسراره لاستدعاءات شبكية فيلزم التحقق منها (`verified_at`) قبل أي محاولة دفع؛ تدوير الأسرار يصفّر التحقق.
     * `custom` ربط محاسبي بلا مزوّد، و`fake` محوّل اختبار/تطوير محلي لا يحمل أسراراً.
     */
    public function requiresVerification(): bool
    {
        return ! in_array($this->provider, [self::PROVIDER_CUSTOM, 'fake'], true);
    }

    /**
     * هل لمحاولات الدفع على هذا الاتصال ما قد يُلتقط لدى المزوّد ويلزم رصده بأسراره الحالية؟ الجارية، وكل محاولة غير ملتقطة لها مرجع مزوّد
     * ما دامت صفحة دفعها المستضافة قائمة (لا انتهاء معلوم أو لم يحن بعد): التفويض/الالتقاط المتأخر (D-15 وتعارض الحالة) يُرصد بالمطابقة.
     * يمنع إلغاء الاعتماد (يمحو الأسرار) وتدوير أسرار المزوّد (قد يغيّر الحساب فيستحيل الوصول إلى مرجع قائم).
     */
    public function hasReconcilableAttempts(): bool
    {
        return PaymentAttempt::query()
            ->where('payment_gateway_id', $this->getKey())
            ->where(function ($query) {
                $query->whereIn('capture_status', PaymentAttempt::ACTIVE_STATUSES)
                    ->orWhere(function ($closed) {
                        $closed->where('capture_status', '!=', PaymentAttempt::STATUS_CAPTURED)
                            ->whereNotNull('provider_payment_id')
                            ->where(fn ($expiry) => $expiry->whereNull('expires_at')->orWhere('expires_at', '>', now()));
                    });
            })
            ->exists();
    }

    /** مفعّلة تشغيلياً: حالة active **و**مفتاح التشغيل القديم مفعّل. */
    public function isUsable(): bool
    {
        return $this->status === self::STATUS_ACTIVE && (bool) $this->is_active;
    }

    /**
     * الأسرار المقبولة للتحقق من توقيع webhook وارد الآن: الحالي، ثم السابق ما دامت نافذة السماح قائمة.
     * يستهلكه المستقبِل لاحقاً؛ لا يُستدعى من مورد API.
     *
     * @return list<string>
     */
    public function webhookSecretsForVerification(): array
    {
        $secrets = [];
        if (filled($this->webhook_secret)) {
            $secrets[] = (string) $this->webhook_secret;
        }
        if (
            filled($this->previous_webhook_secret)
            && $this->previous_secret_expires_at !== null
            && $this->previous_secret_expires_at->isFuture()
        ) {
            $secrets[] = (string) $this->previous_webhook_secret;
        }

        return $secrets;
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
