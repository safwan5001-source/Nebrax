<?php

namespace App\Services;

use App\Contracts\TerminalAdapter;
use App\Support\PosTerminalException;

/**
 * يحلّ محوّل جهاز الدفع من مفتاح المزوّد. المحوّلات الحقيقية تُضاف إلى `ADAPTERS` مع H6-03؛ لا مزوّد بلا محوّل.
 * `fake` للاختبار/التطوير المحلي فقط: لا يُحلّ في أي بيئة غير `local`/`testing`، فلا يُنشأ جهاز منه في الإنتاج.
 */
final class PosTerminalAdapterRegistry
{
    /** @var array<string, class-string<TerminalAdapter>> */
    private const ADAPTERS = [];

    public function has(string $provider): bool
    {
        return $this->classFor($provider) !== null;
    }

    public function for(string $provider): TerminalAdapter
    {
        $class = $this->classFor($provider);
        if ($class === null) {
            throw new PosTerminalException('adapter_unavailable', 'لا يوجد محوّل مفعّل لهذا المزوّد.');
        }

        return app($class);
    }

    /** @return class-string<TerminalAdapter>|null */
    private function classFor(string $provider): ?string
    {
        if ($provider === FakePosTerminalAdapter::PROVIDER) {
            return app()->environment(['local', 'testing']) ? FakePosTerminalAdapter::class : null;
        }

        return self::ADAPTERS[$provider] ?? null;
    }
}
