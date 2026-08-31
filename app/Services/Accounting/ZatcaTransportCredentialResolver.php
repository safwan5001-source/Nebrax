<?php

namespace App\Services\Accounting;

use App\Models\ZatcaCredential;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use RuntimeException;

/** يحل CSID وSecret لبيئة النقل النشطة من دون fallback أو كشفهما للمستدعي الخارجي. */
final class ZatcaTransportCredentialResolver
{
    public function __construct(private readonly TenantContext $tenantContext) {}

    public function resolve(): ZatcaTransportCredential
    {
        $tenantId = $this->tenantContext->id();
        if ($tenantId === null) {
            throw new RuntimeException('لا يمكن حل بيانات نقل ZATCA خارج سياق مستأجر نشط.');
        }

        $environment = (string) Settings::get('zatca', 'active_environment');
        if (! in_array($environment, ZatcaCredentialService::ENVIRONMENTS, true)) {
            throw new RuntimeException('بيئة نقل ZATCA النشطة غير صالحة.');
        }

        $credential = ZatcaCredential::query()
            ->where('tenant_id', $tenantId)
            ->where('environment', $environment)
            ->where('status', 'configured')
            ->first();

        if (! $credential) {
            throw new RuntimeException("بيانات اعتماد ZATCA لبيئة {$environment} غير مهيأة.");
        }
        if ($credential->stage !== 'production') {
            throw new RuntimeException('واجهات Reporting وClearance تتطلب Production CSID.');
        }
        if ($credential->expires_at === null || ! $credential->expires_at->isFuture()) {
            throw new RuntimeException("شهادة ZATCA لبيئة {$environment} منتهية أو بلا تاريخ صلاحية.");
        }

        $payload = is_array($credential->credentials) ? $credential->credentials : [];
        $csid = $payload['binary_security_token'] ?? null;
        $secret = $payload['secret'] ?? null;
        if (! is_string($csid) || trim($csid) === '') {
            throw new RuntimeException("Production CSID لبيئة {$environment} مفقود.");
        }
        if (! is_string($secret) || trim($secret) === '') {
            throw new RuntimeException("Secret الخاص ببيئة {$environment} مفقود.");
        }

        return new ZatcaTransportCredential($environment, trim($csid), trim($secret));
    }
}
