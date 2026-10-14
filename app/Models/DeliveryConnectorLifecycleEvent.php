<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use DomainException;
use LogicException;

/**
 * سجل تدقيق إلحاقي لدورة حياة نقطة الاستقبال الموقّعة: إنشاء، تدوير سر، تعطيل (INT-AUDIT-1 / DP-F).
 *
 * يُكتب من `DeliveryConnectorAccountService` داخل معاملة العملية نفسها حصراً. لا يحمل سراً ولا بادئة سر
 * ولا رمزاً ولا بيانات طلب: رمز الحدث وأرقام الإصدار ومعرّفات فقط. المعرّفات بلا مفاتيح أجنبية ليبقى الأثر
 * بعد حذف الحساب أو المستخدم. إسناد المشغّل له سجله الخاص (`DeliveryConnectorOperatorEvent`) ولا يتكرر هنا.
 * لا يُعدَّل ولا يُحذف عبر النموذج؛ والإقفال على مستوى قاعدة البيانات (trigger) غير مفروض.
 */
class DeliveryConnectorLifecycleEvent extends BaseModel implements CompanyWide
{
    public const UPDATED_AT = null;

    public const CREATED = 'ingress.created';

    public const SECRET_ROTATED = 'secret.rotated';

    public const DISABLED = 'ingress.disabled';

    public const CODES = [
        self::CREATED,
        self::SECRET_ROTATED,
        self::DISABLED,
    ];

    protected $fillable = [
        'tenant_id',
        'delivery_connector_account_id',
        'platform_key',
        'external_store_id',
        'event_code',
        'actor_user_id',
        'branch_id',
        'secret_version_from',
        'secret_version_to',
    ];

    protected function casts(): array
    {
        return [
            'secret_version_from' => 'integer',
            'secret_version_to' => 'integer',
        ];
    }

    protected static function booted(): void
    {
        static::saving(function (self $event): void {
            $context = app(TenantContext::class);
            if (! $context->has()) {
                throw new DomainException('Tenant context is required for delivery connector audit events.');
            }
            $tenantId = (string) $context->id();
            if ($event->tenant_id !== null && (string) $event->tenant_id !== $tenantId) {
                throw new DomainException('Delivery connector audit tenant cannot be forged.');
            }
            $event->tenant_id = $tenantId;

            if (! in_array($event->event_code, self::CODES, true)) {
                throw new DomainException('Unknown delivery connector audit event code.');
            }
            if (empty($event->actor_user_id)) {
                throw new DomainException('Delivery connector audit events require an actor.');
            }
        });
        static::updating(fn () => throw new LogicException('سجل دورة حياة موصّل التوصيل إلحاقي ولا يُعدَّل.'));
        static::deleting(fn () => throw new LogicException('سجل دورة حياة موصّل التوصيل إلحاقي ولا يُحذف.'));
    }
}
