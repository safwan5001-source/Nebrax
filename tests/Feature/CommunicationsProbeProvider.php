<?php

namespace Tests\Feature;

use App\Contracts\CommunicationProvider;
use App\Support\Communications\DispatchResult;
use App\Support\Communications\MessageIntent;
use App\Support\Communications\ProviderCapabilities;
use Closure;

/**
 * AWJ-COMMS-03-A — مزوّد اختبار يلتقط ما يصله ويفحص حالة القاعدة لحظة الإرسال (عبر `$onSend`). يعيش في `tests/` فقط:
 * لا شبكة ولا SDK ولا بيانات اعتماد. يخزّن النيّات كما وصلت ليتحقق الاختبار من الحمولة المفكوكة ومفتاح التكرار الثابت.
 */
final class CommunicationsProbeProvider implements CommunicationProvider
{
    /** @var list<MessageIntent> */
    public array $received = [];

    /**
     * @param  Closure(MessageIntent): DispatchResult  $onSend
     */
    public function __construct(
        private readonly string $key,
        private readonly ProviderCapabilities $capabilities,
        private readonly Closure $onSend,
    ) {
    }

    public function key(): string
    {
        return $this->key;
    }

    public function capabilities(): ProviderCapabilities
    {
        return $this->capabilities;
    }

    public function send(MessageIntent $intent): DispatchResult
    {
        $this->received[] = $intent;

        return ($this->onSend)($intent);
    }
}
