<?php

namespace App\Services;

use App\Models\FuelStationDevice;
use Carbon\CarbonImmutable;
use RuntimeException;

/** Test double لقراءات ATG والإنذارات؛ ATG دليل تشغيلي لا رصيد دفتر. */
class FakeAtgDriver implements FuelStationDeviceAdapter
{
    public function adapterKey(): string
    {
        return 'fake.atg';
    }

    public function supportedDeviceTypes(): array
    {
        return [FuelStationDevice::TYPE_ATG, FuelStationDevice::TYPE_STATION_GATEWAY];
    }

    public function normalize(FuelStationDeviceIdentity $source, array $payload): FuelStationNormalizedEvent
    {
        $type = match ($payload['type'] ?? null) {
            'reading' => FuelStationEventType::ATG_READING_RECORDED,
            'alarm_raised' => FuelStationEventType::TANK_ALARM_RAISED,
            'alarm_cleared' => FuelStationEventType::TANK_ALARM_CLEARED,
            default => throw new RuntimeException('حدث ATG تجريبي غير مدعوم.'),
        };

        return new FuelStationNormalizedEvent(
            eventId: $this->eventId($payload),
            eventType: $type,
            occurredAt: $this->occurredAt($payload),
            payload: $this->body($payload),
            sequence: $this->sequence($payload),
            correlationId: $this->correlationId($payload),
        );
    }

    /** @param array<string, mixed> $payload */
    private function eventId(array $payload): string
    {
        $value = trim((string) ($payload['event_id'] ?? ''));
        if ($value === '' || mb_strlen($value) > 128) {
            throw new RuntimeException('معرف حدث ATG التجريبي مطلوب وبحد أقصى 128 حرفاً.');
        }

        return $value;
    }

    /** @param array<string, mixed> $payload */
    private function occurredAt(array $payload): CarbonImmutable
    {
        try {
            return CarbonImmutable::parse((string) ($payload['occurred_at'] ?? ''));
        } catch (\Throwable $exception) {
            throw new RuntimeException('وقت حدث ATG التجريبي غير صالح.', previous: $exception);
        }
    }

    /** @param array<string, mixed> $payload @return array<string, mixed> */
    private function body(array $payload): array
    {
        $body = $payload['payload'] ?? [];
        if (! is_array($body) || array_is_list($body)) {
            throw new RuntimeException('حمولة حدث ATG التجريبي يجب أن تكون كائناً منظماً.');
        }

        return $body;
    }

    /** @param array<string, mixed> $payload */
    private function sequence(array $payload): ?int
    {
        if (! array_key_exists('sequence', $payload) || $payload['sequence'] === null) {
            return null;
        }
        if (! is_int($payload['sequence']) || $payload['sequence'] < 0) {
            throw new RuntimeException('تسلسل حدث ATG التجريبي يجب أن يكون عدداً صحيحاً غير سالب.');
        }

        return $payload['sequence'];
    }

    /** @param array<string, mixed> $payload */
    private function correlationId(array $payload): ?string
    {
        $value = trim((string) ($payload['correlation_id'] ?? ''));
        if (mb_strlen($value) > 128) {
            throw new RuntimeException('معرف ارتباط حدث ATG التجريبي طويل جداً.');
        }

        return $value === '' ? null : $value;
    }
}
