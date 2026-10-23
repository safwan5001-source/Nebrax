<?php

namespace App\Services;

use App\Contracts\GatewayAdapter;
use App\Support\PaymentOrchestrationException;

/**
 * يحلّ محوّل المزوّد من مفتاحه. المحوّلات الحقيقية تُضاف إلى `ADAPTERS` مع شرائحها (Moyasar: H2-01a؛ ما بعده H2-04)؛ لا مزوّد بلا محوّل.
 *
 * `FakePaymentGatewayAdapter` للاختبار والتطوير المحلي فقط: لا يُحلّ في أي بيئة غير `local`/`testing`، ولا يُقبل
 * اتصال بمزوّد `fake` من واجهة الإدارة (خارج `PaymentGateway::PROVIDERS`).
 */
final class PaymentGatewayAdapterRegistry
{
    /** @var array<string, class-string<GatewayAdapter>> */
    private const ADAPTERS = [
        MoyasarAdapter::PROVIDER => MoyasarAdapter::class,
    ];

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
        if ($provider === FakePaymentGatewayAdapter::PROVIDER) {
            return app()->environment(['local', 'testing']) ? FakePaymentGatewayAdapter::class : null;
        }

        return self::ADAPTERS[$provider] ?? null;
    }
}
