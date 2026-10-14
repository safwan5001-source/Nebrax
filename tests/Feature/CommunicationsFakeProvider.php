<?php

namespace Tests\Feature;

use App\Contracts\CommunicationProvider;
use App\Support\Communications\DispatchResult;
use App\Support\Communications\MessageIntent;
use App\Support\Communications\ProviderCapabilities;

/**
 * AWJ-COMMS-FOUNDATION-01 — مزوّد اختبار وحيد قابل للضبط. يعيش في `tests/` فقط: لا HTTP ولا SDK ولا بيانات اعتماد
 * ولا Laravel. يطبّق العقد كما يجب أن يطبّقه أي محوّل حقيقي: لا يرمي لأخطاء المزوّد، ويعيد `unsupported` لطلب خارج
 * قدراته، ويسجّل `describe()` وحده (لا متغيرات ولا عنوان كامل)، ويحترم منع التكرار المحصور بالمستأجر إن أعلن دعمه.
 */
final class CommunicationsFakeProvider implements CommunicationProvider
{
    /** @var list<string> */
    private array $attempts = [];

    /** @var array<string, DispatchResult> */
    private array $byIdempotencyHash = [];

    private int $deliveries = 0;

    public function __construct(
        private readonly string $key,
        private readonly ProviderCapabilities $capabilities,
        private ?DispatchResult $scripted = null,
    ) {
    }

    public function willReturn(DispatchResult $result): self
    {
        $this->scripted = $result;

        return $this;
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
        if (! $this->capabilities->supports($intent->channel(), $intent->classification)) {
            return DispatchResult::unsupported();
        }

        $hash = $intent->idempotencyHash();
        if ($this->capabilities->providerIdempotency && isset($this->byIdempotencyHash[$hash])) {
            return $this->byIdempotencyHash[$hash];
        }

        $this->attempts[] = $intent->describe();
        $result = $this->scripted ?? DispatchResult::accepted('fake-'.($this->deliveries + 1));

        if ($result->isAccepted()) {
            $this->deliveries++;
        }
        $this->byIdempotencyHash[$hash] = $result;

        return $result;
    }

    /** @return list<string> */
    public function attempts(): array
    {
        return $this->attempts;
    }

    /** عدد الرسائل «المقبولة» فعلاً (الإعادة المنفية بمفتاح التكرار لا تُحسب). */
    public function deliveries(): int
    {
        return $this->deliveries;
    }
}
