<?php

namespace App\Services\Payments;

use App\Contracts\Payments\GatewayAdapter;
use App\Support\Payments\PaymentOrchestrationException;

/**
 * يحلّ محوّل المزوّد من مفتاحه. المحوّلات الحقيقية تُضاف إلى `ADAPTERS` مع شرائحها (H2-01 وما بعدها)؛ لا مزوّد بلا محوّل.
 *
 * `FakeGatewayAdapter` للاختبار والتطوير المحلي فقط: لا يُحلّ في أي بيئة غير `local`/`testing`، ولا يُقبل
 * اتصال بمزوّد `fake` من واجهة الإدارة (خارج `PaymentGateway::PROVIDERS`).
 */
final class GatewayAdapterRegistry
{
    /** @var array<string, class-string<GatewayAdapter>> */
    private const ADAPTERS = [];

    public function has(string $provider): bool
    {
        return $this->classFor($provider) !== null;
    }

    public function for(string $provider): GatewayAdapter
    {
        $class = $this->classFor($provider);
        if ($class === null) {
            throw new PaymentOrchestrationException('adapter_unavailable', 'لا يوجد محوّل مفعّل لهذا المزوّد.');
        }

        return app($class);
    }

    /** @return class-string<GatewayAdapter>|null */
    private function classFor(string $provider): ?string
    {
        if ($provider === FakeGatewayAdapter::PROVIDER) {
            return app()->environment(['local', 'testing']) ? FakeGatewayAdapter::class : null;
        }

        return self::ADAPTERS[$provider] ?? null;
    }
}
