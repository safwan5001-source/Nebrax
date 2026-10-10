<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * ربط تشغيلي موثوق: متجر مزوّد → مستأجر + ملف منصة + فرع صريح أو بلا توجيه.
 *
 * `CompanyWide` كـ`WebhookEndpoint`: إعداد مؤسسة، والفرع هنا وجهة إسقاط لا
 * نطاق عزل للصف. لا يستخدم `BelongsToBranch` حتى لا يُختم `X-Branch-Id` على
 * الربط. السر مخفي ومشفَّر. ليس حالة اتصال مزوّد.
 */
class DeliveryConnectorAccount extends BaseModel implements CompanyWide
{
    public const STATUS_CONFIGURED = 'configured';

    public const STATUS_DISABLED = 'disabled';

    public const STATUSES = [
        self::STATUS_CONFIGURED,
        self::STATUS_DISABLED,
    ];

    protected $fillable = [
        'tenant_id',
        'delivery_platform_profile_id',
        'platform_key',
        'external_store_id',
        'branch_id',
        'configured_by',
        'secret',
        'secret_prefix',
        'secret_version',
        'status',
        'disabled_at',
    ];

    protected $hidden = [
        'secret',
    ];

    protected function casts(): array
    {
        return [
            'secret' => 'encrypted',
            'secret_version' => 'integer',
            'disabled_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::saving(function (self $account): void {
            $context = app(TenantContext::class);
            if (! $context->has()) {
                throw new DomainException('Tenant context is required for delivery connector configuration.');
            }

            $tenantId = (string) $context->id();
            if ($account->tenant_id !== null && (string) $account->tenant_id !== $tenantId) {
                throw new DomainException('Delivery connector tenant cannot be forged.');
            }
            $account->tenant_id = $tenantId;

            if (! in_array($account->status, self::STATUSES, true)) {
                throw new DomainException('Delivery connector status is operational only.');
            }

            if ($account->exists && $account->isDirty(['platform_key', 'external_store_id', 'delivery_platform_profile_id', 'branch_id'])) {
                throw new DomainException('Delivery connector mapping is immutable.');
            }
        });
    }

    public function profile(): BelongsTo
    {
        return $this->belongsTo(DeliveryPlatformProfile::class, 'delivery_platform_profile_id');
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function isConfigured(): bool
    {
        return $this->status === self::STATUS_CONFIGURED;
    }

    /**
     * فرع الوجهة صريح. المستخدم المقيَّد لا يرى ربط فرع آخر ولا الربط بلا توجيه.
     */
    public function visibleTo(User $user): bool
    {
        $allowed = $user->allowedBranchIds();
        if ($allowed === null) {
            return true;
        }

        return $this->branch_id !== null && in_array((string) $this->branch_id, $allowed, true);
    }
}
