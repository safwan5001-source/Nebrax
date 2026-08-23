<?php

namespace App\Services;

use App\Models\FuelStationDevice;
use Carbon\CarbonImmutable;
use RuntimeException;

/** Test double لقارئ RFID؛ يثبت حدث التعرف فقط ولا يستبدل محرك تفويض Cycle 7. */
class FakeRfidDriver implements FuelStationDeviceAdapter
{
    public function adapterKey(): string
    {
        return 'fake.rfid';
    }

    public function supportedDeviceTypes(): array
    {
        return [FuelStationDevice::TYPE_RFID_READER, FuelStationDevice::TYPE_STATION_GATEWAY];
    }

    public function normalize(FuelStationDeviceIdentity $source, array $payload): FuelStationNormalizedEvent
    {
        if (($payload['type'] ?? null) !== 'vehicle_identified') {
            throw new RuntimeException('حدث قارئ RFID التجريبي غير مدعوم.');
        }

        return new FuelStationNormalizedEvent(
            eventId: $this->eventId($payload),
            eventType: FuelStationEventType::VEHICLE_IDENTIFIED,
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
            throw new RuntimeException('معرف حدث RFID التجريبي مطلوب وبحد أقصى 128 حرفاً.');
        }

        return $value;
    }

    /** @param array<string, mixed> $payload */
    private function occurredAt(array $payload): CarbonImmutable
    {
        try {
            return CarbonImmutable::parse((string) ($payload['occurred_at'] ?? ''));
        } catch (\Throwable $exception) {
            throw new RuntimeException('وقت حدث RFID التجريبي غير صالح.', previous: $exception);
        }
    }

    /** @param array<string, mixed> $payload @return array<string, mixed> */
    private function body(array $payload): array
    {
        $body = $payload['payload'] ?? [];
        if (! is_array($body) || array_is_list($body)) {
            throw new RuntimeException('حمولة حدث RFID التجريبي يجب أن تكون كائناً منظماً.');
        }
        foreach ($body as $key => $value) {
            if (preg_match('/(credential|token|secret|password|raw)/i', (string) $key)) {
                throw new RuntimeException('حدث RFID التجريبي لا يقبل قيمة هوية أو اعتماد خاماً؛ مرر معرفاً مرجعياً آمناً فقط.');
            }
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
            throw new RuntimeException('تسلسل حدث RFID التجريبي يجب أن يكون عدداً صحيحاً غير سالب.');
        }

        return $payload['sequence'];
    }

    /** @param array<string, mixed> $payload */
    private function correlationId(array $payload): ?string
    {
        $value = trim((string) ($payload['correlation_id'] ?? ''));
        if (mb_strlen($value) > 128) {
            throw new RuntimeException('معرف ارتباط حدث RFID التجريبي طويل جداً.');
        }

        return $value === '' ? null : $value;
    }
}
