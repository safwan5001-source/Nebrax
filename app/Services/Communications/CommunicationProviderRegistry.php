<?php

namespace App\Services\Communications;

use App\Contracts\CommunicationProvider;
use App\Support\Communications\CommunicationChannel;
use App\Support\Communications\MessageClassification;
use InvalidArgumentException;

/**
 * AWJ-COMMS-03-A — سجل المزوّدين المتاحين للموزّع. **فارغ افتراضياً**: لا يُسجَّل مزوّد في الحاوية ولا في الإنتاج،
 * فالموزّع بلا مزوّد لا يطالب بأي رسالة ولا يرسل شيئاً. التسجيل صريح في الشيفرة (اختبارات اليوم، وشريحة
 * مزوّد حقيقي لاحقاً بقرار مستقل). الاختيار حتمي: أول مزوّد مسجَّل يعلن دعم (القناة، التصنيف).
 */
final class CommunicationProviderRegistry
{
    /** @var array<string, CommunicationProvider> */
    private array $providers = [];

    public function register(CommunicationProvider $provider): self
    {
        $key = $provider->key();
        if ($key === '' || strlen($key) > 64) {
            throw new InvalidArgumentException('A communication provider key must be 1..64 characters.');
        }

        if (isset($this->providers[$key])) {
            throw new InvalidArgumentException('A communication provider with this key is already registered.');
        }

        $this->providers[$key] = $provider;

        return $this;
    }

    public function isEmpty(): bool
    {
        return $this->providers === [];
    }

    public function byKey(string $key): ?CommunicationProvider
    {
        return $this->providers[$key] ?? null;
    }

    public function resolve(CommunicationChannel $channel, MessageClassification $classification): ?CommunicationProvider
    {
        foreach ($this->providers as $provider) {
            if ($provider->capabilities()->supports($channel, $classification)) {
                return $provider;
            }
        }

        return null;
    }

    /**
     * أزواج (قناة، تصنيف) المدعومة فعلاً، بلا OTP: الموزّع لا يرسل OTP (حمولته NULL ولا جسر OTP في هذه الشريحة).
     *
     * @return list<array{0: CommunicationChannel, 1: MessageClassification}>
     */
    public function supportedPairs(): array
    {
        $pairs = [];
        foreach ($this->providers as $provider) {
            foreach ($provider->capabilities()->channels as $channel) {
                foreach ($provider->capabilities()->classifications as $classification) {
                    if ($classification !== MessageClassification::Otp && $provider->capabilities()->supports($channel, $classification)) {
                        $pairs[$channel->value.'|'.$classification->value] = [$channel, $classification];
                    }
                }
            }
        }

        return array_values($pairs);
    }
}
